/* Banco Ladder — interfaz: editor de código, editor visual (arrastrar y soltar), simulación y proyectos */
(function () {
  'use strict';
  const C = window.LadderCore, Store = window.LadderStorage, EXAMPLES = window.LadderExamples;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* ---------- estado ---------- */
  let project = null;          // proyecto abierto
  let code = '';               // texto del editor
  let model = null, prog = null;
  let st = C.newState();
  let running = true, mode = 'edit', latch = false;
  let hist = [], hi = -1;
  let sel = null;              // elemento seleccionado en el diagrama
  let zones = [], nodes = [];  // zonas de soltar y elementos dibujados
  let drag = null, pending = null, pressed = null;
  let lastSig = '', inputsSig = '', ttData = null;
  const canSave = Store.available();

  /* ---------- utilidades ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) { toast('No se pudo copiar. Seleccioná el texto y usá Ctrl+C.'); }
  }
  const safeName = s => (s || 'proyecto').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'proyecto';
  const hasParseErrors = () => model && model.errors.length > 0;

  /* ---------- proyectos ---------- */
  const NEW_TEMPLATE = '# Nuevo proyecto\nentrada I1 pulsador "Marcha"\nsalida Q1 lampara "Salida"\n\nI1 -> Q1\n';

  function openProject(p) {
    project = p; Store.setCurrent(p.id);
    $('projName').value = p.name;
    hist = []; hi = -1; sel = null; closePop();
    st = C.newState();
    setCode(p.code, { push: true, save: false });
    markSaved();
  }
  function newProject(name, src) {
    if (!canSave) { project = { id: 'tmp', name, code: src }; openProject(project); return; }
    openProject(Store.create(name, src));
  }
  let saveTimer = null;
  function scheduleSave() {
    if (!canSave || !project) return;
    $('saveState').textContent = 'Guardando…'; $('saveState').classList.remove('bad');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const ok = Store.save(project.id, { code, name: project.name });
      if (ok) markSaved(); else { $('saveState').textContent = 'No se pudo guardar'; $('saveState').classList.add('bad'); }
    }, 500);
  }
  function markSaved() {
    const s = $('saveState');
    if (!canSave) { s.textContent = 'Este navegador no permite guardar: usá "Guardar archivo"'; s.classList.add('bad'); return; }
    s.textContent = 'Guardado'; s.classList.remove('bad');
  }
  function relTime(t) {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return 'hace un momento';
    if (d < 3600) return `hace ${Math.round(d / 60)} min`;
    if (d < 86400) return `hace ${Math.round(d / 3600)} h`;
    return new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function renderProjects() {
    const list = Store.list();
    $('projList').innerHTML = list.length ? list.map(p => `
      <div class="proj${project && p.id === project.id ? ' cur' : ''}" data-id="${p.id}">
        <b>${esc(p.name)}</b><small>${project && p.id === project.id ? 'Abierto · ' : ''}Modificado ${relTime(p.updated)}</small>
        <div class="tools" data-tools>
          ${project && p.id === project.id ? '' : '<button class="btn sm primary" data-act="open">Abrir</button>'}
          <button class="btn sm" data-act="dup">Duplicar</button>
          <button class="btn sm" data-act="file">Guardar archivo</button>
          <button class="btn sm" data-act="del">Borrar</button>
        </div>
      </div>`).join('') : '<p class="empty">Todavía no hay proyectos guardados.</p>';
  }
  $('projList').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.closest('.proj').dataset.id, p = Store.get(id); if (!p) return;
    const act = b.dataset.act;
    if (act === 'open') { openProject(p); closeDrawer(); }
    if (act === 'dup') { Store.duplicate(id); if (project) Store.setCurrent(project.id); renderProjects(); toast('Proyecto duplicado'); }
    if (act === 'file') download(safeName(p.name) + '.ladder', Store.toFile(p), 'application/json');
    if (act === 'del') {
      b.closest('[data-tools]').innerHTML = `<span>¿Borrar "${esc(p.name)}"? No se puede deshacer.</span>
        <button class="btn sm danger" data-act="delyes">Sí, borrar</button><button class="btn sm" data-act="delno">No</button>`;
    }
    if (act === 'delno') renderProjects();
    if (act === 'delyes') {
      Store.remove(id);
      if (project && project.id === id) {
        const rest = Store.list();
        if (rest.length) openProject(rest[0]); else newProject('Mi proyecto', NEW_TEMPLATE);
      }
      renderProjects(); toast('Proyecto borrado');
    }
  });
  function openDrawer() { renderProjects(); $('drawer').hidden = false; $('drawerClose').focus(); }
  function closeDrawer() { $('drawer').hidden = true; }
  $('btnProjects').onclick = openDrawer;
  $('drawerClose').onclick = closeDrawer;
  $('drawer').addEventListener('click', e => { if (e.target.id === 'drawer') closeDrawer(); });
  $('btnNew').onclick = () => { newProject('Proyecto ' + (Store.list().length + 1), NEW_TEMPLATE); toast('Proyecto nuevo creado'); };
  $('projName').addEventListener('input', () => { if (project) { project.name = $('projName').value.trim() || 'Proyecto sin nombre'; scheduleSave(); } });
  $('btnExport').onclick = () => download(safeName(project.name) + '.ladder', Store.toFile({ name: project.name, code }), 'application/json');
  $('btnImport').onclick = () => $('fileInput').click();
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { const p = Store.fromFile(String(rd.result), f.name); newProject(p.name, p.code); toast(`Abierto "${p.name}"`); }
      catch (err) { toast(err.message); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });
  // ejemplos: se abren como proyecto nuevo, sin pisar el actual
  (function fillExamples() {
    const groups = {};
    EXAMPLES.forEach(x => { (groups[x.group] = groups[x.group] || []).push(x); });
    $('exSelect').innerHTML = '<option value="">Abrir ejemplo…</option>' + Object.entries(groups).map(([g, xs]) =>
      `<optgroup label="${esc(g)}">${xs.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('');
  })();
  $('exSelect').addEventListener('change', e => {
    const ex = EXAMPLES.find(x => x.id === e.target.value); e.target.value = '';
    if (!ex) return;
    newProject(ex.name, ex.code); toast(`Ejemplo abierto como proyecto nuevo: ${ex.name}`);
  });

  /* ---------- código: editor con resaltado ---------- */
  const ta = $('code');
  const KW = new Set(['entrada', 'salida', 'input', 'output']);
  const TY = new Set(['pulsador', 'interruptor', 'sensor', 'llave', 'selector', 'lampara', 'lámpara', 'luz', 'motor', 'bomba', 'valvula', 'válvula']);
  const OPS = new Set(['TON', 'TOF', 'TP', 'CTU', 'AND', 'OR', 'NOT']);
  function hlLine(line) {
    let codePart = line, cm = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (!q && (line[i] === '#' || (line[i] === '/' && line[i + 1] === '/'))) { codePart = line.slice(0, i); cm = line.slice(i); break; }
    }
    let out = '', afterArrow = false;
    const re = /("[^"]*"?)|(->)|(\d+(?:[.,]\d+)?(?:ms|min|s)?\b)|([A-Za-z_áéíóú][A-Za-z0-9_áéíóú]*)|(\s+)|([\s\S])/g;
    let m;
    while ((m = re.exec(codePart))) {
      if (m[1]) out += `<span class="t-st">${esc(m[1])}</span>`;
      else if (m[2]) { out += '<span class="t-ar">-&gt;</span>'; afterArrow = true; }
      else if (m[3]) out += `<span class="t-num">${esc(m[3])}</span>`;
      else if (m[4]) {
        const w = m[4], lw = w.toLowerCase(), up = w.toUpperCase();
        let cls = '';
        if (KW.has(lw)) cls = 't-kw';
        else if (TY.has(lw)) cls = 't-ty';
        else if (OPS.has(up) || (afterArrow && ['S', 'R', 'T'].includes(up) && /^\s+[A-Za-z_]/.test(codePart.slice(re.lastIndex)))) cls = 't-op';
        else if (/^I\d/i.test(w)) cls = 't-in';
        else if (/^Q\d/i.test(w)) cls = 't-out';
        else cls = 't-mk';
        out += `<span class="${cls}">${esc(w)}</span>`;
      } else if (m[5]) out += m[5];
      else out += `<span class="t-op">${esc(m[6])}</span>`;
    }
    if (cm) out += `<span class="t-cm">${esc(cm)}</span>`;
    return out;
  }
  function paintEditor(errLines, warnLines) {
    const lines = code.split('\n');
    $('hl').innerHTML = lines.map(hlLine).join('\n') + '\n';
    $('gutter').innerHTML = lines.map((_, i) => {
      const n = i + 1, cls = errLines.has(n) ? 'err' : warnLines.has(n) ? 'wrn' : '';
      return `<span${cls ? ` class="${cls}"` : ''}>${n}</span>`;
    }).join('');
    syncScroll();
  }
  function syncScroll() {
    $('hl').style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    $('gutter').style.transform = `translateY(${-ta.scrollTop}px)`;
  }
  ta.addEventListener('scroll', syncScroll);
  let typeTimer = null, histTimer = null;
  ta.addEventListener('input', () => {
    code = ta.value;
    clearTimeout(typeTimer); typeTimer = setTimeout(() => refresh(), 160);
    clearTimeout(histTimer); histTimer = setTimeout(() => pushHist(code), 700);
    scheduleSave();
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });
  function gotoLine(n) {
    const lines = code.split('\n');
    let pos = 0; for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
    ta.scrollTop = Math.max(0, (n - 4) * 21);
  }
  $('status').addEventListener('click', e => { const b = e.target.closest('button[data-line]'); if (b) gotoLine(+b.dataset.line); });

  function setCode(text, opt) {
    opt = opt || {};
    code = text; ta.value = text;
    refresh();
    if (opt.push) pushHist(text);
    if (opt.save !== false) scheduleSave();
  }
  function pushHist(text) {
    if (hist[hi] === text) return;
    hist = hist.slice(0, hi + 1); hist.push(text);
    if (hist.length > 150) hist.shift();
    hi = hist.length - 1; paintUndo();
  }
  function undo() { if (hi > 0) { hi--; setCode(hist[hi]); paintUndo(); } }
  function redo() { if (hi < hist.length - 1) { hi++; setCode(hist[hi]); paintUndo(); } }
  function paintUndo() { $('btnUndo').disabled = hi <= 0; $('btnRedo').disabled = hi >= hist.length - 1; }
  $('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
  $('btnCopy').onclick = () => copyText(code, 'Código copiado');

  /* ---------- compilar y mostrar estado ---------- */
  function refresh() {
    model = C.parseProgram(code);
    prog = C.compile(model);
    const errs = [...model.errors, ...prog.errors].sort((a, b) => a.line - b.line);
    const warns = prog.warns.slice().sort((a, b) => a.line - b.line);
    paintEditor(new Set(errs.map(e => e.line)), new Set(warns.map(w => w.line)));
    const msg = (cls, x) => `<div class="msg ${cls}"><button data-line="${x.line}">L${x.line}</button><span>${esc(x.msg)}</span></div>`;
    $('status').innerHTML = (errs.length || warns.length)
      ? errs.map(e => msg('err', e)).join('') + warns.map(w => msg('wrn', w)).join('')
      : `<div class="ok-line">Sin errores · ${prog.rungs.length} red${prog.rungs.length === 1 ? '' : 'es'} · ${prog.inputs.length} entrada${prog.inputs.length === 1 ? '' : 's'} · ${prog.outputs.length} salida${prog.outputs.length === 1 ? '' : 's'}</div>`;
    // limpiar estado de nombres que ya no existen
    st.prev = {};
    Object.keys(st.tm).forEach(n => { if (!prog.timers[n]) delete st.tm[n]; });
    Object.keys(st.ct).forEach(n => { if (!prog.counters[n]) delete st.ct[n]; });
    if (running) C.scan(prog, st, 0);
    ttData = C.truthTable(prog);
    sel = null;
    buildInputs(true);
    renderLive(true);
  }

  /* ---------- diagrama ---------- */
  const CW = 84, RH = 62, X0 = 46, RAIL = 24, TITLE = 24;
  const val = n => C.value(prog, st, n);
  const isInput = n => prog.inputs.some(i => i.name === n);
  function sz(e) {
    if (!e) return { w: 2, h: 1 };
    if (e.t === 'c') return { w: 1, h: 1 };
    const s = e.items.map(sz);
    return e.t === 's' ? { w: s.reduce((a, b) => a + b.w, 0), h: Math.max(...s.map(b => b.h)) }
                       : { w: Math.max(...s.map(b => b.w)), h: s.reduce((a, b) => a + b.h, 0) };
  }
  const W = (x1, y1, x2, y2, on) => `<line class="w${on ? ' on' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

  function drawExpr(e, x, y, pin, o, ri, live) {
    if (e.t === 'c') {
      const v = live ? val(e.v) : false, cond = e.n ? !v : v, out = pin && cond, m = x + CW / 2;
      const idx = nodes.push({ ref: e, ri }) - 1;
      const isSel = sel && sel.type === 'node' && sel.ref === e;
      const inp = isInput(e.v);
      o.push(`<g class="el${inp ? ' inp' : ''}${isSel ? ' sel' : ''}" data-node="${idx}"><title>${e.n ? 'Contacto NC' : 'Contacto NA'} ${esc(e.v)}${aliasOf(e.v) ? ' · ' + esc(aliasOf(e.v)) : ''}</title>`,
        `<rect class="hit" x="${x + 4}" y="${y - 30}" width="${CW - 8}" height="46" rx="5"/>`,
        W(x, y, m - 9, y, pin), W(m + 9, y, x + CW, y, out),
        `<line class="pl${cond ? ' on' : ''}" x1="${m - 9}" y1="${y - 13}" x2="${m - 9}" y2="${y + 13}"/>`,
        `<line class="pl${cond ? ' on' : ''}" x1="${m + 9}" y1="${y - 13}" x2="${m + 9}" y2="${y + 13}"/>`,
        e.n ? `<line class="pl${cond ? ' on' : ''}" x1="${m - 15}" y1="${y + 11}" x2="${m + 15}" y2="${y - 11}"/>` : '',
        `<text class="lbl${v ? ' on' : ''}" x="${m}" y="${y - 19}" text-anchor="middle">${esc(e.v)}</text></g>`);
      if (live !== 'export') {
        zones.push({ kind: 'before', ri, ref: e }); o.push(`<rect class="z z-c" data-z="${zones.length - 1}" x="${x}" y="${y - 30}" width="${CW / 2}" height="44"/>`);
        zones.push({ kind: 'after', ri, ref: e }); o.push(`<rect class="z z-c" data-z="${zones.length - 1}" x="${x + CW / 2}" y="${y - 30}" width="${CW / 2}" height="44"/>`);
        zones.push({ kind: 'below', ri, ref: e }); o.push(`<rect class="z z-c" data-z="${zones.length - 1}" x="${x + 4}" y="${y + 14}" width="${CW - 8}" height="17"/>`);
      }
      return out;
    }
    if (e.t === 's') {
      let p = pin, cx = x;
      for (const it of e.items) { p = drawExpr(it, cx, y, p, o, ri, live); cx += sz(it).w * CW; }
      return p;
    }
    const Wd = sz(e).w; let cy = y, any = false, last = y;
    for (const it of e.items) {
      const s = sz(it), r = drawExpr(it, x, cy, pin, o, ri, live);
      if (s.w < Wd) o.push(W(x + s.w * CW, cy, x + Wd * CW, cy, r));
      any = any || r; last = cy; cy += s.h * RH;
    }
    o.push(W(x, y, x, last, pin), W(x + Wd * CW, y, x + Wd * CW, last, any));
    return any;
  }
  function aliasOf(n) { const d = model.decls.find(x => x.name === n); return d ? d.alias : ''; }

  function drawCoil(c, cc, y, pw, o, ri, ci, live) {
    const isSel = sel && sel.type === 'coil' && sel.ri === ri && sel.ci === ci;
    let on, sub = '';
    if (['TON', 'TOF', 'TP'].includes(c.k)) {
      const t = live ? st.tm[c.name] : null; on = !!(t && t.q);
      const acc = t ? t.acc : 0;
      sub = live === 'export' ? C.fmtTime(c.pt) : `${(acc / 1000).toFixed(1)} / ${+(c.pt / 1000).toFixed(2)} s`;
    } else if (c.k === 'CTU') {
      const k = live ? st.ct[c.name] : null; on = !!(k && k.q);
      sub = live === 'export' ? `PV ${c.pv}` : `${k ? k.cv : 0} / ${c.pv}`;
    } else {
      on = live ? val(c.name) : false;
      sub = aliasOf(c.name);
    }
    o.push(`<g class="el${isSel ? ' sel' : ''}" data-coil="${ri}:${ci}"><title>Bobina ${esc(C.coilText(c))}</title>`,
      `<rect class="hit" x="${cc - 34}" y="${y - 30}" width="68" height="60" rx="5"/>`);
    if (['TON', 'TOF', 'TP', 'CTU'].includes(c.k)) {
      o.push(`<rect class="box${on ? ' on' : ''}" x="${cc - 26}" y="${y - 14}" width="52" height="28" rx="3"/>`,
        `<text class="kt" x="${cc}" y="${y + 4}">${c.k}</text>`);
    } else {
      o.push(`<circle class="cbg${on ? ' on' : ''}" cx="${cc}" cy="${y}" r="13"/>`,
        `<path class="pl${pw ? ' on' : ''}" d="M${cc - 6} ${y - 15} Q${cc - 19} ${y} ${cc - 6} ${y + 15}"/>`,
        `<path class="pl${pw ? ' on' : ''}" d="M${cc + 6} ${y - 15} Q${cc + 19} ${y} ${cc + 6} ${y + 15}"/>`);
      if (c.k === 'NEG') o.push(`<line class="pl${pw ? ' on' : ''}" x1="${cc - 7}" y1="${y + 9}" x2="${cc + 7}" y2="${y - 9}"/>`);
      if (['S', 'R', 'T'].includes(c.k)) o.push(`<text class="kt" x="${cc}" y="${y + 4}">${c.k}</text>`);
    }
    o.push(`<text class="lbl${on ? ' on' : ''}" x="${cc}" y="${y - 20}" text-anchor="middle">${esc(c.name)}</text>`);
    if (sub) o.push(`<text class="sub" x="${cc}" y="${y + 29}" text-anchor="middle">${esc(sub.length > 22 ? sub.slice(0, 21) + '…' : sub)}</text>`);
    o.push('</g>');
    return on;
  }

  function diagramSVG(live) {
    const editing = mode === 'edit' && live !== 'export';
    zones = []; nodes = [];
    const rs = prog.rungs;
    const maxW = Math.max(2, ...rs.map(r => sz(r.e).w));
    const busX = X0 + maxW * CW + 18, cc = busX + 50, rr = cc + 64;
    const o = []; let y = 6;
    rs.forEach((r, ri) => {
      const top = y, s = sz(r.e), h = Math.max(s.h, r.coils.length || 1);
      const y0 = top + TITLE + RH / 2 - 4;
      const isSel = sel && sel.type === 'rung' && sel.ri === ri;
      o.push(`<g class="ttl-g${isSel ? ' sel' : ''}" data-rung="${ri}"><rect class="hit" x="${RAIL + 4}" y="${top}" width="${Math.max(160, (r.label || '').length * 6.5 + 70)}" height="20" rx="4"/>`,
        `<text class="ttl" x="${X0 - 12}" y="${top + 14}">Red ${ri + 1}${r.label ? ' · ' + esc(r.label) : ''}</text></g>`);
      const pw = live ? C.evalExpr(prog, st, r.e) : false;
      o.push(W(RAIL, y0, X0, y0, !!live));
      let endX = X0;
      if (r.e) { drawExpr(r.e, X0, y0, !!live, o, ri, live); endX = X0 + s.w * CW; }
      else if (editing) {
        zones.push({ kind: 'empty', ri });
        o.push(`<rect class="zone-box" x="${X0 + 4}" y="${y0 - 22}" width="${2 * CW - 8}" height="44" rx="6"/>`,
          `<text class="zt" x="${X0 + CW}" y="${y0 + 4}" text-anchor="middle">Soltá un contacto</text>`,
          `<rect class="z z-c" data-z="${zones.length - 1}" x="${X0}" y="${y0 - 26}" width="${2 * CW}" height="52"/>`);
        endX = X0 + 2 * CW;
      }
      o.push(W(endX, y0, busX, y0, pw));
      if (!r.coils.length && editing) {
        o.push(`<rect class="zone-box" x="${cc - 30}" y="${y0 - 20}" width="60" height="40" rx="6"/>`, `<text class="zt" x="${cc}" y="${y0 + 4}" text-anchor="middle">bobina</text>`);
      }
      r.coils.forEach((c, ci) => {
        const cy = y0 + ci * RH;
        if (ci > 0) o.push(W(busX, y0 + (ci - 1) * RH, busX, cy, pw));
        o.push(W(busX, cy, cc - (['TON', 'TOF', 'TP', 'CTU'].includes(c.k) ? 26 : 15), cy, pw));
        drawCoil(c, cc, cy, pw, o, ri, ci, live);
        o.push(W(cc + (['TON', 'TOF', 'TP', 'CTU'].includes(c.k) ? 26 : 15), cy, rr, cy, false));
      });
      if (editing) {
        zones.push({ kind: 'coil', ri });
        o.push(`<rect class="z z-k" data-z="${zones.length - 1}" x="${busX + 6}" y="${top + TITLE - 4}" width="${rr - busX - 10}" height="${h * RH}"/>`);
      }
      y = top + TITLE + h * RH + 8;
    });
    if (editing) {
      zones.push({ kind: 'newrung' });
      o.push(`<rect class="zone-box" x="${X0 - 10}" y="${y + 6}" width="${rr - X0 - 4}" height="42" rx="6"/>`,
        `<text class="zt" x="${(X0 + rr) / 2}" y="${y + 31}" text-anchor="middle">${rs.length ? 'Soltá acá para crear una red nueva' : 'Arrastrá un contacto o una bobina acá para empezar'}</text>`,
        `<rect class="z z-c z-k" data-z="${zones.length - 1}" x="${X0 - 10}" y="${y + 2}" width="${rr - X0 - 4}" height="50"/>`);
      y += 56;
    }
    const H = Math.max(y + 6, 80), Wd = rr + 18;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Diagrama Ladder">
      <line class="rail" x1="${RAIL}" y1="2" x2="${RAIL}" y2="${H - 2}"/><line class="rail off" x1="${rr}" y1="2" x2="${rr}" y2="${H - 2}"/>${o.join('')}</svg>`;
  }

  function renderDiagram() {
    const d = $('dia');
    d.className = 'dia ' + mode + (drag && drag.started ? (drag.accepts === 'c' ? ' drag-c' : ' drag-k') : '');
    d.innerHTML = diagramSVG(true);
  }

  /* ---------- paneles de E/S ---------- */
  const motorSVG = '<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M17 17 L17 5 A12 12 0 0 1 27 11 Z M17 17 L27 23 A12 12 0 0 1 17 29 Z M17 17 L7 23 A12 12 0 0 1 7 11 Z" fill="currentColor" opacity=".85"/></svg>';
  function buildInputs(force) {
    const sig = JSON.stringify([prog.inputs, latch]);
    if (!force && sig === inputsSig) return;
    if (sig === inputsSig && force) { updateInputs(); return; }
    inputsSig = sig;
    $('inputs').innerHTML = prog.inputs.length ? prog.inputs.map(i => `
      <div class="row"><span class="tag">${esc(i.name)}</span>
        <span class="nm">${esc(i.alias || (i.declared ? '' : 'Entrada detectada'))}
          <select class="kind" data-kind="${esc(i.name)}" aria-label="Tipo de ${esc(i.name)}">
            <option value="push"${i.kind === 'push' ? ' selected' : ''}>pulsador</option>
            <option value="toggle"${i.kind === 'toggle' ? ' selected' : ''}>interruptor / sensor</option></select></span>
        ${i.kind === 'push'
          ? `<button class="push" data-push="${esc(i.name)}" id="in-${esc(i.name)}">${latch ? 'Apretar' : 'Mantener'}</button>`
          : `<button class="sw" role="switch" aria-checked="false" data-tog="${esc(i.name)}" id="in-${esc(i.name)}" aria-label="${esc(i.name)}"></button>`}
      </div>`).join('') : '<p class="empty">Sin entradas todavía. Usá un contacto con un nombre como I1.</p>';
    updateInputs();
  }
  function updateInputs() {
    prog.inputs.forEach(i => {
      const b = document.getElementById('in-' + i.name); if (!b) return;
      const on = !!st.vars[i.name];
      if (i.kind === 'push') { b.classList.toggle('on', on); b.textContent = on ? (latch ? 'Apretado' : 'Pulsado') : (latch ? 'Apretar' : 'Mantener'); }
      else b.setAttribute('aria-checked', on);
    });
  }
  function renderOutputs() {
    $('outputs').innerHTML = prog.outputs.length ? prog.outputs.map(q => {
      const on = val(q.name);
      const ind = q.kind === 'motor' ? `<span class="motor${on ? ' on' : ''}">${motorSVG}</span>` : `<span class="lamp${on ? ' on' : ''}"></span>`;
      return `<div class="row"><span class="tag">${esc(q.name)}</span><span class="nm">${esc(q.alias || 'Salida')}<small>${on ? 'activada' : 'desactivada'}</small></span>${ind}</div>`;
    }).join('') : '<p class="empty">Sin salidas. Las bobinas con nombre Q (Q1, Q2…) aparecen acá.</p>';
    $('markers').innerHTML = prog.markers.length ? '<span class="empty">Marcas internas:</span> ' + prog.markers.map(n => `<span class="chip${val(n) ? ' on' : ''}">${esc(n)}</span>`).join('') : '';
    const tms = Object.entries(prog.timers), cts = Object.entries(prog.counters);
    $('timersCard').hidden = !tms.length && !cts.length;
    $('timers').innerHTML = tms.map(([n, t]) => {
      const s = st.tm[n] || { acc: 0, q: false };
      return `<div class="row tm${s.q ? ' on' : ''}"><span class="tag">${esc(n)}</span><span class="nm">${t.k} · ${C.fmtTime(t.pt)}<div class="bar"><i style="width:${Math.min(100, s.acc / t.pt * 100)}%"></i></div></span><span class="val">${(s.acc / 1000).toFixed(1)} s · ${s.q ? '1' : '0'}</span></div>`;
    }).join('') + cts.map(([n, c]) => {
      const s = st.ct[n] || { cv: 0, q: false };
      return `<div class="row tm${s.q ? ' on' : ''}"><span class="tag">${esc(n)}</span><span class="nm">CTU · preset ${c.pv}<div class="bar"><i style="width:${Math.min(100, s.cv / c.pv * 100)}%"></i></div></span><span class="val">${s.cv} · ${s.q ? '1' : '0'}</span></div>`;
    }).join('');
    $('ttCard').hidden = !ttData;
    if (ttData) {
      const cur = ttData.ins.map(n => !!st.vars[n]);
      $('tt').innerHTML = `<table class="tt"><thead><tr>${ttData.ins.map(n => `<th>${esc(n)}</th>`).join('')}${ttData.outs.map(n => `<th class="o">${esc(n)}</th>`).join('')}</tr></thead><tbody>${
        ttData.rows.map(r => `<tr class="${r.ins.every((v, k) => v === cur[k]) ? 'cur' : ''}">${r.ins.map(v => `<td class="${v ? 'one' : ''}">${+v}</td>`).join('')}${r.outs.map(v => `<td class="o ${v ? 'one' : ''}">${+v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
  }
  function renderLive(force) {
    if (!prog || (drag && drag.started)) return;
    const sig = JSON.stringify([st.vars, st.tm, st.ct, sel ? [sel.type, sel.ri, sel.ci] : 0, mode]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    renderDiagram(); renderOutputs(); updateInputs();
  }

  function setInput(n, on) {
    st.vars[n] = on;
    if (running) C.scan(prog, st, 0);
    renderLive(true);
  }
  $('inputs').addEventListener('click', e => {
    const t = e.target.closest('[data-tog]');
    if (t) setInput(t.dataset.tog, !st.vars[t.dataset.tog]);
    const p = e.target.closest('[data-push]');
    if (p && latch) setInput(p.dataset.push, !st.vars[p.dataset.push]);
  });
  $('inputs').addEventListener('pointerdown', e => {
    const p = e.target.closest('[data-push]'); if (!p || latch) return;
    e.preventDefault(); pressed = p.dataset.push; setInput(pressed, true);
  });
  $('inputs').addEventListener('keydown', e => {
    const p = e.target.closest('[data-push]'); if (!p || latch || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pressed = p.dataset.push; setInput(pressed, true); }
  });
  $('inputs').addEventListener('keyup', e => {
    if (pressed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); const n = pressed; pressed = null; setInput(n, false); }
  });
  $('inputs').addEventListener('change', e => {
    const s = e.target.closest('[data-kind]'); if (!s) return;
    if (hasParseErrors()) { toast('Corregí los errores del código antes de cambiar el tipo.'); refresh(); return; }
    const n = s.dataset.kind, kind = s.value;
    const d = model.decls.find(x => x.name === n);
    if (d) { d.kind = kind; d.word = kind === 'push' ? 'pulsador' : (d.word === 'sensor' ? 'sensor' : 'interruptor'); }
    else model.decls.push({ io: 'in', name: n, kind, word: kind === 'push' ? 'pulsador' : 'interruptor', alias: '' });
    st.vars[n] = false;
    commitModel();
  });
  $('latch').addEventListener('change', e => {
    latch = e.target.checked;
    if (!latch) prog.inputs.filter(i => i.kind === 'push').forEach(i => { st.vars[i.name] = false; });
    if (running) C.scan(prog, st, 0);
    buildInputs(true); renderLive(true);
  });

  /* ---------- PLC: RUN / STOP / paso / reinicio ---------- */
  function setRunning(r) {
    running = r;
    $('btnRun').setAttribute('aria-pressed', r); $('runText').textContent = r ? 'RUN' : 'STOP';
    $('btnStep').disabled = r;
    if (r) { lastTick = performance.now(); C.scan(prog, st, 0); renderLive(true); }
  }
  $('btnRun').onclick = () => setRunning(!running);
  $('btnStep').onclick = () => { C.scan(prog, st, 100); renderLive(true); };
  $('btnReset').onclick = () => { st = C.newState(); if (running) C.scan(prog, st, 0); renderLive(true); toast('Todo en cero'); };
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now(), dt = Math.min(200, now - lastTick); lastTick = now;
    if (running && prog) { C.scan(prog, st, dt); renderLive(false); }
  }, 50);

  /* ---------- modo y paleta ---------- */
  const PAL = [
    { type: 'NA', label: 'Contacto NA', cls: 'c' }, { type: 'NC', label: 'Contacto NC', cls: 'c' },
    { type: 'N', label: 'Bobina', cls: 'k' }, { type: 'NEG', label: 'Bobina negada', cls: 'k' },
    { type: 'S', label: 'Set', cls: 'k' }, { type: 'R', label: 'Reset', cls: 'k' }, { type: 'T', label: 'Impulsos', cls: 'k' },
    { type: 'TON', label: 'TON', cls: 'k' }, { type: 'TOF', label: 'TOF', cls: 'k' }, { type: 'TP', label: 'TP', cls: 'k' }, { type: 'CTU', label: 'Contador', cls: 'k' }
  ];
  function palIcon(t) {
    const wires = '<path d="M0 11h9M21 11h9"/>';
    if (t === 'NA' || t === 'NC') return `<svg viewBox="0 0 30 22"><path d="M0 11h11M19 11h11M11 3v16M19 3v16"/>${t === 'NC' ? '<path d="M8 18l14-14"/>' : ''}</svg>`;
    if (['TON', 'TOF', 'TP', 'CTU'].includes(t)) return `<svg viewBox="0 0 30 22"><rect x="2" y="4" width="26" height="14" rx="2"/><text x="15" y="14.5" text-anchor="middle">${t === 'CTU' ? 'CTU' : t}</text></svg>`;
    return `<svg viewBox="0 0 30 22">${wires}<path d="M12 4Q6 11 12 18M18 4Q24 11 18 18"/>${t === 'NEG' ? '<path d="M11 16l8-10"/>' : ''}${['S', 'R', 'T'].includes(t) ? `<text x="15" y="14.5" text-anchor="middle">${t}</text>` : ''}</svg>`;
  }
  $('palette').innerHTML = PAL.map(p => `<span class="pal" data-pal="${p.type}" role="button" tabindex="0" title="Arrastrá al diagrama">${palIcon(p.type)}${p.label}</span>`).join('');
  function setMode(m) {
    mode = m; sel = null; closePop();
    $('modeEdit').setAttribute('aria-pressed', m === 'edit'); $('modeOperate').setAttribute('aria-pressed', m === 'operate');
    $('palette').hidden = m !== 'edit';
    $('diaHint').textContent = m === 'edit'
      ? 'Arrastrá un componente: a la izquierda o derecha de un contacto queda en serie, debajo queda en paralelo. Las bobinas van en la zona de la derecha. Tocá un elemento para editarlo o borrarlo.'
      : 'Modo operar: tocá los contactos de entrada del diagrama para accionarlos.';
    renderLive(true);
  }
  $('modeEdit').onclick = () => setMode('edit');
  $('modeOperate').onclick = () => setMode('operate');

  /* ---------- arrastrar y soltar ---------- */
  const isContactSrc = src => (src.kind === 'pal' && (src.type === 'NA' || src.type === 'NC')) || src.kind === 'node';
  function startDrag(ev) {
    drag = pending; pending = null; drag.started = true;
    drag.accepts = isContactSrc(drag.src) ? 'c' : 'k';
    const g = $('ghost');
    let label;
    if (drag.src.kind === 'pal') { const p = PAL.find(x => x.type === drag.src.type); label = palIcon(p.type) + p.label; }
    else if (drag.src.kind === 'node') { const r = drag.src.ref; label = palIcon(r.n ? 'NC' : 'NA') + esc(r.v); }
    else { const c = model.rungs[drag.src.ri].coils[drag.src.ci]; label = palIcon(['TON', 'TOF', 'TP', 'CTU'].includes(c.k) ? c.k : c.k === 'NEG' ? 'NEG' : ['S', 'R', 'T'].includes(c.k) ? c.k : 'N') + esc(c.name); }
    g.innerHTML = label; g.hidden = false;
    closePop();
    $('dia').classList.add(drag.accepts === 'c' ? 'drag-c' : 'drag-k');
    moveDrag(ev);
  }
  function moveDrag(ev) {
    const g = $('ghost'); g.style.left = ev.clientX + 'px'; g.style.top = ev.clientY + 'px';
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const z = el && el.closest ? el.closest('[data-z]') : null;
    document.querySelectorAll('#dia .z.hot').forEach(x => x.classList.remove('hot'));
    drag.zone = null;
    if (z && z.classList.contains(drag.accepts === 'c' ? 'z-c' : 'z-k')) { z.classList.add('hot'); drag.zone = zones[+z.dataset.z]; }
  }
  function endDrag(apply) {
    const d = drag; drag = null;
    $('ghost').hidden = true;
    $('dia').classList.remove('drag-c', 'drag-k');
    if (apply && d.zone) applyDrop(d.src, d.zone); else renderLive(true);
  }
  function nextName(prefix, start) {
    const used = new Set([...prog.inputs.map(i => i.name), ...prog.outputs.map(o => o.name), ...prog.markers, ...Object.keys(prog.timers), ...Object.keys(prog.counters)]);
    let n = start || 1; while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  function newCoilFor(type) {
    const lastQ = prog.outputs.length ? prog.outputs[prog.outputs.length - 1].name : 'Q1';
    switch (type) {
      case 'N': case 'NEG': return { k: type, name: nextName('Q') };
      case 'S': case 'T': return { k: type, name: nextName('Q') };
      case 'R': return { k: 'R', name: lastQ };
      case 'CTU': return { k: 'CTU', name: nextName('CT'), pv: 5 };
      default: return { k: type, name: nextName('T'), pt: 5000 };
    }
  }
  function applyDrop(src, z) {
    if (hasParseErrors()) { toast(`Corregí el error de la línea ${model.errors[0].line} para editar el diagrama.`); renderLive(true); return; }
    let focus = null;
    if (isContactSrc(src)) {
      let node;
      if (src.kind === 'pal') node = C.contact(nextName('I'), src.type === 'NC');
      else {
        if (z.ref === src.ref) { renderLive(true); return; }
        node = src.ref; C.removeNode(model.rungs[src.ri], node);
      }
      let ri = z.ri;
      if (z.kind === 'before' || z.kind === 'after') C.insertSeries(model.rungs[z.ri], z.ref, node, z.kind === 'after');
      else if (z.kind === 'below') C.insertParallel(model.rungs[z.ri], z.ref, node);
      else if (z.kind === 'empty') model.rungs[z.ri].e = node;
      else if (z.kind === 'newrung') { model.rungs.push({ label: null, e: node, coils: [] }); ri = model.rungs.length - 1; }
      if (src.kind === 'pal') focus = { type: 'node', ri, name: node.v };
    } else {
      let coil;
      if (src.kind === 'pal') coil = newCoilFor(src.type);
      else { if (z.kind === 'coil' && z.ri === src.ri) { renderLive(true); return; } coil = model.rungs[src.ri].coils.splice(src.ci, 1)[0]; }
      let ri = z.ri;
      if (z.kind === 'coil') model.rungs[z.ri].coils.push(coil);
      else { model.rungs.push({ label: null, e: null, coils: [coil] }); ri = model.rungs.length - 1; }
      if (src.kind === 'pal') focus = { type: 'coil', ri, ci: model.rungs[ri].coils.length - 1 };
    }
    commitModel();
    if (focus) openEditorFor(focus);
  }
  function commitModel() {
    setCode(C.serialize(model), { push: true });
  }
  function openEditorFor(f) {
    // Después de recompilar, ubicar el elemento nuevo y abrir su editor
    if (f.type === 'node') {
      const i = nodes.findIndex(n => n.ri === f.ri && n.ref.v === f.name);
      if (i >= 0) { sel = { type: 'node', ref: nodes[i].ref, ri: f.ri }; renderLive(true); openPop(sel); }
    } else { sel = { type: 'coil', ri: f.ri, ci: f.ci }; renderLive(true); openPop(sel); }
  }

  function targetFrom(el) {
    const n = el.closest('[data-node]'), k = el.closest('[data-coil]'), r = el.closest('[data-rung]');
    if (n) { const x = nodes[+n.dataset.node]; return x && { type: 'node', ref: x.ref, ri: x.ri }; }
    if (k) { const [ri, ci] = k.dataset.coil.split(':').map(Number); return { type: 'coil', ri, ci }; }
    if (r) return { type: 'rung', ri: +r.dataset.rung };
    return null;
  }
  $('dia').addEventListener('pointerdown', e => {
    const t = targetFrom(e.target);
    if (mode === 'operate') {
      if (t && t.type === 'node' && isInput(t.ref.v)) {
        e.preventDefault();
        const inp = prog.inputs.find(i => i.name === t.ref.v);
        if (inp.kind === 'push' && !latch) { pressed = inp.name; setInput(inp.name, true); }
        else setInput(inp.name, !st.vars[inp.name]);
      }
      return;
    }
    if (!t) { if (sel) { sel = null; closePop(); renderLive(true); } return; }
    pending = { x0: e.clientX, y0: e.clientY, target: t,
      src: t.type === 'node' ? { kind: 'node', ref: t.ref, ri: t.ri } : t.type === 'coil' ? { kind: 'coil', ri: t.ri, ci: t.ci } : null };
  });
  $('palette').addEventListener('pointerdown', e => {
    const p = e.target.closest('[data-pal]'); if (!p) return;
    e.preventDefault();
    pending = { x0: e.clientX, y0: e.clientY, src: { kind: 'pal', type: p.dataset.pal }, fromPalette: true };
  });
  $('palette').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toast('Arrastrá el componente con el mouse o el dedo hasta el diagrama.'); }
  });
  window.addEventListener('pointermove', e => {
    if (drag) { moveDrag(e); return; }
    if (!pending) return;
    if (Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) > 6) {
      if (!pending.src) { pending = null; return; }
      if (hasParseErrors()) { toast(`Corregí el error de la línea ${model.errors[0].line} para editar el diagrama.`); pending = null; return; }
      startDrag(e);
    }
  });
  window.addEventListener('pointerup', () => {
    if (pressed) { const n = pressed; pressed = null; setInput(n, false); }
    if (drag) { endDrag(true); return; }
    if (pending) {
      const p = pending; pending = null;
      if (p.fromPalette) toast('Arrastrá el componente hasta el diagrama.');
      else if (p.target) { sel = p.target; renderLive(true); openPop(sel); }
    }
  });
  window.addEventListener('pointercancel', () => { if (drag) endDrag(false); pending = null; if (pressed) { const n = pressed; pressed = null; setInput(n, false); } });

  /* ---------- editor de elementos (popover) ---------- */
  function closePop() { $('pop').hidden = true; }
  function anchorRect(t) {
    let q = null;
    if (t.type === 'node') { const i = nodes.findIndex(n => n.ref === t.ref); q = `[data-node="${i}"]`; }
    else if (t.type === 'coil') q = `[data-coil="${t.ri}:${t.ci}"]`;
    else q = `[data-rung="${t.ri}"]`;
    const el = document.querySelector('#dia ' + q);
    return el ? el.getBoundingClientRect() : null;
  }
  function openPop(t) {
    if (hasParseErrors()) { toast(`Corregí el error de la línea ${model.errors[0].line} para editar el diagrama.`); return; }
    const pop = $('pop'); let html = '';
    if (t.type === 'node') {
      html = `<h3>Contacto</h3>
        <span class="seg" role="group" aria-label="Tipo de contacto"><button id="popNA" aria-pressed="${!t.ref.n}">NA</button><button id="popNC" aria-pressed="${t.ref.n}">NC</button></span>
        <input type="text" id="popIn" value="${esc(t.ref.v)}" aria-label="Operando" autocomplete="off">
        <p class="hint">Entrada (I1), salida (Q1), marca (M1), temporizador (T1) o contador (CT1).</p>`;
    } else if (t.type === 'coil') {
      const c = model.rungs[t.ri].coils[t.ci];
      html = `<h3>Bobina</h3><input type="text" id="popIn" value="${esc(C.coilText(c))}" aria-label="Bobina" autocomplete="off">
        <p class="hint">Ejemplos: Q1 · /Q1 · S Q1 · R Q1 · T Q1 · TON T1 5s · TOF T1 5s · TP T1 1s · CTU CT1 6 · R CT1</p>`;
    } else {
      const r = model.rungs[t.ri];
      html = `<h3>Red ${t.ri + 1}</h3><input type="text" id="popIn" value="${esc(r.label || '')}" placeholder="Título de la red" aria-label="Título de la red" autocomplete="off">`;
    }
    html += `<div class="err" id="popErr"></div><div class="tools"><button class="btn sm danger" id="popDel">${t.type === 'rung' ? 'Borrar red' : 'Borrar'}</button>
      <span class="tools"><button class="btn sm" id="popCancel">Cancelar</button><button class="btn sm primary" id="popOk">Aplicar</button></span></div>`;
    pop.innerHTML = html; pop.hidden = false;
    const r = anchorRect(t) || { left: 40, bottom: 120, top: 100 };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(12, r.left), window.innerWidth - pw - 12);
    let top = r.bottom + 8; if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    const inp = $('popIn'); inp.focus(); inp.select();
    let nc = t.type === 'node' ? t.ref.n : false;
    if (t.type === 'node') {
      $('popNA').onclick = () => { nc = false; $('popNA').setAttribute('aria-pressed', true); $('popNC').setAttribute('aria-pressed', false); };
      $('popNC').onclick = () => { nc = true; $('popNC').setAttribute('aria-pressed', true); $('popNA').setAttribute('aria-pressed', false); };
    }
    const apply = () => {
      const v = inp.value.trim();
      try {
        if (t.type === 'node') {
          if (!C.ID_RE.test(v)) throw new Error('Usá letras, números y _ (por ejemplo I1, Q2, M1).');
          t.ref.v = v; t.ref.n = nc;
        } else if (t.type === 'coil') {
          model.rungs[t.ri].coils[t.ci] = C.parseCoil(v);
        } else model.rungs[t.ri].label = v || null;
      } catch (err) { $('popErr').textContent = err.message; return; }
      closePop(); sel = null; commitModel();
    };
    $('popOk').onclick = apply;
    $('popCancel').onclick = () => { closePop(); sel = null; renderLive(true); };
    $('popDel').onclick = () => { closePop(); deleteTarget(t); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') { closePop(); sel = null; renderLive(true); } };
  }
  function deleteTarget(t) {
    if (hasParseErrors()) return;
    if (t.type === 'node') C.removeNode(model.rungs[t.ri], t.ref);
    else if (t.type === 'coil') model.rungs[t.ri].coils.splice(t.ci, 1);
    else model.rungs.splice(t.ri, 1);
    sel = null; commitModel();
  }

  /* ---------- teclado global ---------- */
  document.addEventListener('keydown', e => {
    const inField = e.target.closest && e.target.closest('input, textarea, select');
    if (e.key === 'Escape') { if (drag) endDrag(false); closePop(); closeDrawer(); if (sel) { sel = null; renderLive(true); } }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && mode === 'edit') { e.preventDefault(); closePop(); deleteTarget(sel); }
  });

  /* ---------- exportar SVG ---------- */
  $('btnSvg').onclick = () => {
    const css = `.w{stroke:#8d968f;stroke-width:2.5;fill:none;stroke-linecap:round}.rail{stroke:#1b211e;stroke-width:4}.pl{stroke:#1b211e;stroke-width:3;fill:none}.box{fill:#fff;stroke:#1b211e;stroke-width:2}.cbg{fill:#fff}.lbl{font:600 13px 'IBM Plex Mono',Consolas,monospace;fill:#1b211e}.sub,.ttl{font:12px Barlow,Arial,sans-serif;fill:#59625b}.kt{font:600 11px 'IBM Plex Mono',Consolas,monospace;fill:#1b211e;text-anchor:middle}.hit{fill:none}`;
    const svg = diagramSVG('export').replace('role="img"', 'role="img" style="background:#fff"').replace(/<svg([^>]*)>/, `<svg$1><style>${css}</style>`);
    download(safeName(project.name) + '.svg', svg, 'image/svg+xml');
    renderLive(true);
  };

  /* ---------- inicio ---------- */
  setMode('edit');
  let first = null;
  if (canSave) {
    first = Store.get(Store.currentId()) || Store.list()[0] || null;
  }
  if (first) openProject(first);
  else {
    const ex = EXAMPLES.find(x => x.id === 'g1e4');
    newProject('Mi primer proyecto', ex.code);
  }
  setRunning(true);
})();
