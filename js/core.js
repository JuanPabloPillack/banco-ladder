/*
 * Banco Ladder — núcleo
 * Lenguaje de texto → modelo (redes serie/paralelo) → programa compilado → simulación por scan.
 * Sin dependencias del navegador: se usa desde la página y desde los tests de Node.
 */
(function (root) {
  'use strict';

  const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const COIL_BIT = ['N', 'NEG', 'S', 'R', 'T'];
  const COIL_TIMER = ['TON', 'TOF', 'TP'];

  const INPUT_KINDS = { pulsador: 'push', interruptor: 'toggle', sensor: 'toggle', llave: 'toggle', selector: 'toggle' };
  const OUTPUT_KINDS = { lampara: 'lamp', 'lámpara': 'lamp', luz: 'lamp', valvula: 'lamp', 'válvula': 'lamp', motor: 'motor', bomba: 'motor' };

  /* ---------- nodos ---------- */
  const contact = (v, n) => ({ t: 'c', v, n: !!n });
  function group(t, items) {
    const out = [];
    items.forEach(it => { if (it.t === t) out.push(...it.items); else out.push(it); });
    return out.length === 1 ? out[0] : { t, items: out };
  }

  /* ---------- tiempo ---------- */
  function parseTime(s) {
    const m = String(s).match(/^(\d+(?:[.,]\d+)?)(ms|s|min|m)?$/i);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    const u = (m[2] || 's').toLowerCase();
    const ms = Math.round(v * (u === 'ms' ? 1 : u === 's' ? 1000 : 60000));
    return ms > 0 ? ms : null;
  }
  function fmtTime(ms) {
    if (ms % 60000 === 0) return ms / 60000 + 'min';
    if (ms >= 1000) return +(ms / 1000).toFixed(3) + 's';
    return ms + 'ms';
  }

  /* ---------- comentarios ---------- */
  function splitComment(line) {
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') q = !q;
      else if (!q && (ch === '#' || (ch === '/' && line[i + 1] === '/'))) {
        return { code: line.slice(0, i), comment: line.slice(i + (ch === '#' ? 1 : 2)).trim() };
      }
    }
    return { code: line, comment: null };
  }

  /* ---------- expresiones ---------- */
  function lex(str) {
    const toks = [];
    const re = /\s*(?:(\()|(\))|(!|\/)|(&|\*)|(\||\+)|([A-Za-z_][A-Za-z0-9_]*)|(\S))/y;
    let m;
    while (re.lastIndex < str.length && (m = re.exec(str))) {
      if (m[0].trim() === '' ) break;
      if (m[1]) toks.push({ k: '(' });
      else if (m[2]) toks.push({ k: ')' });
      else if (m[3]) toks.push({ k: 'not', s: m[3] });
      else if (m[4]) toks.push({ k: 'and', s: m[4] });
      else if (m[5]) toks.push({ k: 'or', s: m[5] });
      else if (m[6]) {
        const up = m[6].toUpperCase();
        if (up === 'AND') toks.push({ k: 'and', s: 'AND' });
        else if (up === 'OR') toks.push({ k: 'or', s: 'OR' });
        else if (up === 'NOT') toks.push({ k: 'not', s: 'NOT' });
        else toks.push({ k: 'id', s: m[6] });
      } else throw new Error(`Símbolo "${m[7]}" no reconocido. Usá & para Y, | para O y / para NO.`);
    }
    return toks;
  }

  function parseExpr(str) {
    const toks = lex(str);
    let i = 0;
    const peek = () => toks[i];
    const startsUnary = t => t && (t.k === 'id' || t.k === '(' || t.k === 'not');
    function unary() {
      const t = toks[i];
      if (!t) throw new Error('Falta una condición al final.');
      if (t.k === 'not') { i++; return { op: 'not', a: unary() }; }
      if (t.k === '(') {
        i++;
        const e = orExpr();
        if (!toks[i] || toks[i].k !== ')') throw new Error('Falta cerrar un paréntesis.');
        i++;
        return e;
      }
      if (t.k === 'id') { i++; return { op: 'id', v: t.s }; }
      if (t.k === ')') throw new Error('Sobra un ")" o falta una condición antes.');
      throw new Error(`Falta una condición antes de "${t.s}".`);
    }
    function andExpr() {
      const xs = [unary()];
      for (;;) {
        const t = peek();
        if (t && t.k === 'and') {
          i++;
          if (!startsUnary(peek())) throw new Error(`Falta una condición después de "${t.s}".`);
          xs.push(unary());
        } else if (startsUnary(t)) xs.push(unary());
        else break;
      }
      return xs.length === 1 ? xs[0] : { op: 'and', xs };
    }
    function orExpr() {
      const xs = [andExpr()];
      while (peek() && peek().k === 'or') {
        const t = toks[i++];
        if (!startsUnary(peek())) throw new Error(`Falta una condición después de "${t.s}".`);
        xs.push(andExpr());
      }
      return xs.length === 1 ? xs[0] : { op: 'or', xs };
    }
    if (!toks.length) return null;
    const ast = orExpr();
    if (i < toks.length) {
      const t = toks[i];
      throw new Error(t.k === ')' ? 'Sobra un ")".' : `No se esperaba "${t.s || t.k}" acá.`);
    }
    return toLadder(ast, false);
  }

  // Lleva las negaciones hasta los contactos (De Morgan), así todo se puede dibujar.
  function toLadder(a, neg) {
    if (a.op === 'id') return contact(a.v, neg);
    if (a.op === 'not') return toLadder(a.a, !neg);
    const kids = a.xs.map(x => toLadder(x, neg));
    const isAnd = a.op === 'and';
    return group(isAnd !== neg ? 's' : 'p', kids);
  }

  /* ---------- bobinas ---------- */
  function parseCoil(s) {
    const txt = s.trim();
    if (!txt) throw new Error('Falta la bobina después de "->". Ejemplo: I1 -> Q1');
    const parts = txt.split(/\s+/);
    const up = parts[0].toUpperCase();
    const needName = (nm, ej) => { if (!nm || !ID_RE.test(nm)) throw new Error(`Falta un nombre válido. Ejemplo: ${ej}`); return nm; };
    if (['S', 'R', 'T'].includes(up) && parts.length >= 2) {
      if (parts.length > 2) throw new Error(`Sobra texto en la bobina "${txt}".`);
      return { k: up, name: needName(parts[1], up + ' Q1') };
    }
    if (COIL_TIMER.includes(up)) {
      const name = needName(parts[1], up + ' T1 5s');
      if (!parts[2]) throw new Error(`Falta el tiempo del temporizador. Ejemplo: ${up} ${name} 5s`);
      const pt = parseTime(parts[2]);
      if (pt === null) throw new Error(`Tiempo "${parts[2]}" no válido. Usá ms, s o min, por ejemplo 500ms, 5s o 2min.`);
      if (parts.length > 3) throw new Error(`Sobra texto en la bobina "${txt}".`);
      return { k: up, name, pt };
    }
    if (up === 'CTU') {
      const name = needName(parts[1], 'CTU CT1 6');
      const pv = parseInt(parts[2], 10);
      if (!parts[2] || !(pv > 0) || String(pv) !== parts[2]) throw new Error(`Falta el valor del contador (entero mayor que 0). Ejemplo: CTU ${name} 6`);
      if (parts.length > 3) throw new Error(`Sobra texto en la bobina "${txt}".`);
      return { k: 'CTU', name, pv };
    }
    if (parts.length === 1) {
      const neg = txt.startsWith('/') || txt.startsWith('!');
      const name = neg ? txt.slice(1) : txt;
      if (!ID_RE.test(name)) throw new Error(`"${txt}" no es un nombre de bobina válido.`);
      return { k: neg ? 'NEG' : 'N', name };
    }
    throw new Error(`No entiendo la bobina "${txt}". Ejemplos: Q1, /Q1, S Q1, R Q1, T Q1, TON T1 5s, CTU CT1 6.`);
  }

  function coilText(c) {
    switch (c.k) {
      case 'N': return c.name;
      case 'NEG': return '/' + c.name;
      case 'S': case 'R': case 'T': return c.k + ' ' + c.name;
      case 'CTU': return `CTU ${c.name} ${c.pv}`;
      default: return `${c.k} ${c.name} ${fmtTime(c.pt)}`;
    }
  }

  /* ---------- programa ---------- */
  function parseDecl(io, rest, line, out) {
    const toks = [...rest.matchAll(/"([^"]*)"|(\S+)/g)];
    if (!toks.length || toks[0][1] !== undefined) {
      out.errors.push({ line, msg: `Falta el nombre. Ejemplo: ${io === 'in' ? 'entrada I1 pulsador "Marcha"' : 'salida Q1 motor "Motor"'}` });
      return;
    }
    const name = toks[0][2];
    if (!ID_RE.test(name)) { out.errors.push({ line, msg: `"${name}" no es un nombre válido.` }); return; }
    const d = { io, name, kind: io === 'in' ? 'toggle' : 'lamp', word: null, alias: '', line };
    const table = io === 'in' ? INPUT_KINDS : OUTPUT_KINDS;
    for (const t of toks.slice(1)) {
      if (t[1] !== undefined) { d.alias = t[1]; continue; }
      const w = t[2].toLowerCase();
      if (table[w]) { d.kind = table[w]; d.word = w; }
      else {
        out.errors.push({ line, msg: io === 'in'
          ? `Tipo de entrada "${t[2]}" no reconocido. Usá pulsador, interruptor o sensor.`
          : `Tipo de salida "${t[2]}" no reconocido. Usá lampara o motor.` });
        return;
      }
    }
    if (out.decls.some(x => x.name === name)) { out.errors.push({ line, msg: `${name} ya está declarada.` }); return; }
    out.decls.push(d);
  }

  function parseProgram(src) {
    const out = { header: [], decls: [], rungs: [], errors: [] };
    let pend = [], seenCode = false;
    const flushHeader = keepLast => {
      const take = keepLast ? pend.slice(0, -1) : pend;
      if (!seenCode) out.header.push(...take);
      pend = [];
    };
    String(src).replace(/\r/g, '').split('\n').forEach((raw, idx) => {
      const line = idx + 1;
      const { code, comment } = splitComment(raw);
      const t = code.trim();
      if (!t) {
        if (comment) pend.push(comment);
        else flushHeader(false);
        return;
      }
      const dm = t.match(/^(entrada|input|salida|output)(\s+.*)?$/i);
      if (dm) {
        flushHeader(false);
        seenCode = true;
        parseDecl(/^(entrada|input)$/i.test(dm[1]) ? 'in' : 'out', dm[2] || '', line, out);
        return;
      }
      const label = pend.length ? pend[pend.length - 1] : comment;
      flushHeader(true);
      seenCode = true;
      const at = t.indexOf('->');
      if (at < 0) { out.errors.push({ line, msg: 'Falta "->" para indicar la bobina. Formato: condición -> Q1' }); return; }
      const lhs = t.slice(0, at), rhs = t.slice(at + 2);
      try {
        const e = parseExpr(lhs);
        const coils = rhs.trim() ? rhs.split(',').map(parseCoil) : [];
        out.rungs.push({ label: label || null, e, coils, line });
      } catch (err) {
        out.errors.push({ line, msg: err.message });
      }
    });
    flushHeader(false);
    return out;
  }

  /* ---------- texto desde el modelo ---------- */
  function exprText(e, ctx) {
    if (!e) return '';
    if (e.t === 'c') return (e.n ? '/' : '') + e.v;
    if (e.t === 's') return e.items.map(x => exprText(x, 's')).join(' & ');
    const s = e.items.map(x => exprText(x, 'p')).join(' | ');
    return ctx === 's' ? '(' + s + ')' : s;
  }
  function declText(d) {
    const parts = [d.io === 'in' ? 'entrada' : 'salida', d.name];
    parts.push(d.word || (d.io === 'in' ? (d.kind === 'push' ? 'pulsador' : 'interruptor') : (d.kind === 'motor' ? 'motor' : 'lampara')));
    if (d.alias) parts.push('"' + d.alias.replace(/"/g, "'") + '"');
    return parts.join(' ');
  }
  function serialize(m) {
    const L = [];
    m.header.forEach(h => L.push('# ' + h));
    if (m.header.length) L.push('');
    m.decls.forEach(d => L.push(declText(d)));
    if (m.decls.length) L.push('');
    m.rungs.forEach((r, i) => {
      if (r.label) L.push('# ' + r.label);
      const lhs = exprText(r.e);
      L.push((lhs ? lhs + ' ' : '') + '-> ' + r.coils.map(coilText).join(', '));
      if (i < m.rungs.length - 1) L.push('');
    });
    return L.join('\n') + '\n';
  }

  /* ---------- compilación ---------- */
  function namesIn(e, acc) {
    if (!e) return acc;
    if (e.t === 'c') acc.push(e.v); else e.items.forEach(x => namesIn(x, acc));
    return acc;
  }

  function compile(m) {
    const errors = [], warns = [];
    const decl = Object.fromEntries(m.decls.map(d => [d.name, d]));
    const timers = {}, counters = {}, bitWrites = {};
    m.rungs.forEach((r, ri) => r.coils.forEach(c => {
      if (COIL_TIMER.includes(c.k)) {
        if (timers[c.name]) errors.push({ line: r.line, msg: `El temporizador ${c.name} ya está definido en la línea ${timers[c.name].line}.` });
        else timers[c.name] = { k: c.k, pt: c.pt, line: r.line };
      } else if (c.k === 'CTU') {
        if (counters[c.name]) errors.push({ line: r.line, msg: `El contador ${c.name} ya está definido en la línea ${counters[c.name].line}.` });
        else counters[c.name] = { pv: c.pv, line: r.line };
      }
    }));
    m.rungs.forEach((r, ri) => r.coils.forEach(c => {
      if (!COIL_BIT.includes(c.k)) return;
      if (c.k === 'R' && (counters[c.name] || timers[c.name])) return;
      if (timers[c.name] || counters[c.name]) {
        errors.push({ line: r.line, msg: `${c.name} es un ${timers[c.name] ? 'temporizador' : 'contador'}; no se puede usar como bobina común.` });
        return;
      }
      if (decl[c.name] && decl[c.name].io === 'in') {
        errors.push({ line: r.line, msg: `${c.name} está declarada como entrada; no se puede usar como bobina.` });
        return;
      }
      (bitWrites[c.name] = bitWrites[c.name] || []).push({ k: c.k, line: r.line, ri });
    }));
    Object.keys(timers).forEach(n => { if (counters[n]) errors.push({ line: counters[n].line, msg: `${n} no puede ser temporizador y contador a la vez.` }); });

    Object.entries(bitWrites).forEach(([n, ws]) => {
      const plain = ws.filter(w => w.k === 'N' || w.k === 'NEG');
      if (plain.length > 1) warns.push({ line: plain[1].line, msg: `Doble bobina: ${n} se escribe en las líneas ${plain.map(w => w.line).join(' y ')}. Gana la última.` });
      if (plain.length && ws.some(w => w.k === 'S' || w.k === 'R' || w.k === 'T')) warns.push({ line: plain[0].line, msg: `${n} mezcla bobina común con S/R/T. La bobina común pisa el valor guardado.` });
    });

    const reads = [];
    m.rungs.forEach(r => namesIn(r.e, []).forEach(n => { if (!reads.includes(n)) reads.push(n); }));
    const written = n => !!bitWrites[n] || !!timers[n] || !!counters[n];

    const inputs = [];
    m.decls.filter(d => d.io === 'in').forEach(d => inputs.push({ name: d.name, kind: d.kind, alias: d.alias, declared: true }));
    reads.forEach(n => {
      if (written(n) || decl[n] || inputs.some(x => x.name === n)) return;
      inputs.push({ name: n, kind: 'toggle', alias: '', declared: false });
    });
    const outputs = [];
    m.decls.filter(d => d.io === 'out').forEach(d => outputs.push({ name: d.name, kind: d.kind, alias: d.alias, declared: true }));
    Object.keys(bitWrites).forEach(n => {
      if (/^Q/i.test(n) && !outputs.some(x => x.name === n)) outputs.push({ name: n, kind: 'lamp', alias: '', declared: false });
    });
    const markers = Object.keys(bitWrites).filter(n => !outputs.some(x => x.name === n));

    m.decls.forEach(d => {
      if (d.io === 'out' && !bitWrites[d.name]) warns.push({ line: d.line, msg: `La salida ${d.name} está declarada pero ninguna bobina la activa.` });
      if (d.io === 'in' && !reads.includes(d.name)) warns.push({ line: d.line, msg: `La entrada ${d.name} está declarada pero no se usa.` });
    });
    m.rungs.forEach(r => { if (!r.coils.length) warns.push({ line: r.line, msg: 'Esta red no tiene bobina, así que no hace nada.' }); });

    // ¿Es combinacional? (sin memoria: se puede hacer tabla de verdad)
    let comb = !Object.keys(timers).length && !Object.keys(counters).length;
    m.rungs.forEach((r, ri) => r.coils.forEach(c => { if (!['N', 'NEG'].includes(c.k)) comb = false; }));
    if (comb) {
      m.rungs.forEach((r, ri) => namesIn(r.e, []).forEach(n => {
        if (bitWrites[n] && bitWrites[n].some(w => w.ri >= ri)) comb = false;
      }));
    }
    return { rungs: m.rungs, timers, counters, inputs, outputs, markers, errors, warns, comb };
  }

  /* ---------- simulación ---------- */
  function newState() { return { vars: {}, tm: {}, ct: {}, prev: {} }; }

  function value(prog, st, n) {
    if (prog.timers[n]) return !!(st.tm[n] && st.tm[n].q);
    if (prog.counters[n]) return !!(st.ct[n] && st.ct[n].q);
    return !!st.vars[n];
  }
  function evalExpr(prog, st, e) {
    if (!e) return true;
    if (e.t === 'c') return e.n ? !value(prog, st, e.v) : value(prog, st, e.v);
    return e.t === 's' ? e.items.every(x => evalExpr(prog, st, x)) : e.items.some(x => evalExpr(prog, st, x));
  }

  function scan(prog, st, dt) {
    dt = dt || 0;
    prog.rungs.forEach((r, ri) => {
      const x = evalExpr(prog, st, r.e);
      r.coils.forEach((c, ci) => {
        const key = ri + ':' + ci, prev = !!st.prev[key];
        switch (c.k) {
          case 'N': st.vars[c.name] = x; break;
          case 'NEG': st.vars[c.name] = !x; break;
          case 'S': if (x) st.vars[c.name] = true; break;
          case 'R':
            if (!x) break;
            if (prog.counters[c.name]) st.ct[c.name] = { cv: 0, q: false };
            else if (prog.timers[c.name]) st.tm[c.name] = { acc: 0, q: false };
            else st.vars[c.name] = false;
            break;
          case 'T': if (x && !prev) st.vars[c.name] = !st.vars[c.name]; break;
          case 'TON': {
            const t = st.tm[c.name] = st.tm[c.name] || { acc: 0, q: false };
            if (x) { t.acc = Math.min(c.pt, t.acc + dt); t.q = t.acc >= c.pt; } else { t.acc = 0; t.q = false; }
            break;
          }
          case 'TOF': {
            const t = st.tm[c.name] = st.tm[c.name] || { acc: 0, q: false };
            if (x) { t.q = true; t.acc = 0; }
            else if (t.q) { t.acc = Math.min(c.pt, t.acc + dt); if (t.acc >= c.pt) { t.q = false; t.acc = 0; } }
            break;
          }
          case 'TP': {
            const t = st.tm[c.name] = st.tm[c.name] || { acc: 0, q: false };
            if (x && !prev && !t.q) { t.q = true; t.acc = 0; }
            else if (t.q) { t.acc = Math.min(c.pt, t.acc + dt); if (t.acc >= c.pt) t.q = false; }
            break;
          }
          case 'CTU': {
            const k = st.ct[c.name] = st.ct[c.name] || { cv: 0, q: false };
            if (x && !prev) k.cv++;
            k.q = k.cv >= c.pv;
            break;
          }
        }
        st.prev[key] = x;
      });
    });
    return st;
  }

  function truthTable(prog) {
    if (!prog.comb || !prog.inputs.length || prog.inputs.length > 6) return null;
    const ins = prog.inputs.map(i => i.name);
    const outs = [...prog.outputs.map(o => o.name), ...prog.markers];
    const rows = [];
    for (let m = 0; m < (1 << ins.length); m++) {
      const st = newState();
      ins.forEach((n, k) => { st.vars[n] = !!((m >> (ins.length - 1 - k)) & 1); });
      scan(prog, st, 0);
      rows.push({ ins: ins.map(n => st.vars[n]), outs: outs.map(n => !!st.vars[n]) });
    }
    return { ins, outs, rows };
  }

  /* ---------- edición del modelo (para el editor visual) ---------- */
  function findParent(e, target) {
    if (!e || e.t === 'c') return null;
    for (let i = 0; i < e.items.length; i++) {
      if (e.items[i] === target) return { parent: e, i };
      const r = findParent(e.items[i], target);
      if (r) return r;
    }
    return null;
  }
  function replaceNode(rung, old, nu) {
    if (rung.e === old) { rung.e = nu; return; }
    const p = findParent(rung.e, old);
    if (p) p.parent.items[p.i] = nu;
  }
  function removeNode(rung, node) {
    if (rung.e === node) { rung.e = null; return; }
    const p = findParent(rung.e, node);
    if (!p) return;
    p.parent.items.splice(p.i, 1);
    if (p.parent.items.length === 1) replaceNode(rung, p.parent, p.parent.items[0]);
  }
  function insertSeries(rung, target, node, after) {
    const p = findParent(rung.e, target);
    if (p && p.parent.t === 's') p.parent.items.splice(p.i + (after ? 1 : 0), 0, node);
    else replaceNode(rung, target, { t: 's', items: after ? [target, node] : [node, target] });
  }
  function insertParallel(rung, target, node) {
    const p = findParent(rung.e, target);
    if (p && p.parent.t === 'p') p.parent.items.splice(p.i + 1, 0, node);
    else replaceNode(rung, target, { t: 'p', items: [target, node] });
  }

  const api = {
    parseProgram, parseExpr, parseCoil, parseTime, fmtTime, serialize, exprText, coilText, declText,
    compile, newState, scan, value, evalExpr, truthTable,
    findParent, removeNode, insertSeries, insertParallel, contact, ID_RE, INPUT_KINDS, OUTPUT_KINDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LadderCore = api;
})(typeof window !== 'undefined' ? window : this);
