// Tests del núcleo de Banco Ladder. Ejecutar con: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/core.js');
const EXAMPLES = require('../js/examples.js');

function load(code) {
  const m = L.parseProgram(code);
  const prog = L.compile(m);
  return { m, prog, st: L.newState() };
}
// Aplica entradas y hace un scan (dt en ms)
function step(ctx, inputs, dt) {
  Object.assign(ctx.st.vars, inputs || {});
  L.scan(ctx.prog, ctx.st, dt || 0);
  return n => L.value(ctx.prog, ctx.st, n);
}

test('todos los ejemplos compilan sin errores y el texto ida y vuelta es estable', () => {
  for (const ex of EXAMPLES) {
    const m = L.parseProgram(ex.code);
    assert.deepEqual(m.errors, [], ex.name);
    assert.deepEqual(L.compile(m).errors, [], ex.name);
    const s1 = L.serialize(m);
    const m2 = L.parseProgram(s1);
    assert.deepEqual(m2.errors, [], ex.name + ' (reparseo)');
    assert.equal(L.serialize(m2), s1, ex.name + ' (serialización estable)');
    assert.deepEqual(m2.rungs.map(r => [r.e, r.coils, r.label]), m.rungs.map(r => [r.e, r.coils, r.label]), ex.name + ' (mismo modelo)');
  }
});

test('precedencia, Y implícito y De Morgan', () => {
  assert.deepEqual(L.parseExpr('A | B & C'), { t: 'p', items: [L.contact('A'), { t: 's', items: [L.contact('B'), L.contact('C')] }] });
  assert.deepEqual(L.parseExpr('A B'), { t: 's', items: [L.contact('A'), L.contact('B')] });
  assert.deepEqual(L.parseExpr('!(A | B)'), { t: 's', items: [L.contact('A', true), L.contact('B', true)] });
  assert.deepEqual(L.parseExpr('NOT (A AND B)'), { t: 'p', items: [L.contact('A', true), L.contact('B', true)] });
  assert.deepEqual(L.parseExpr('//A'.slice(1)), L.contact('A', true));
  assert.equal(L.exprText(L.parseExpr('(A | B) & C | D')), '(A | B) & C | D');
});

test('errores con línea y mensaje en español', () => {
  const m = L.parseProgram('I1 & -> Q1\nI1 Q1\n(I1 | I2 -> Q2\nI1 -> TON T1\nentrada I5 bocina');
  assert.deepEqual(m.errors.map(e => e.line), [1, 2, 3, 4, 5]);
  assert.match(m.errors[0].msg, /Falta una condición/);
  assert.match(m.errors[1].msg, /Falta "->"/);
  assert.match(m.errors[2].msg, /paréntesis/);
  assert.match(m.errors[3].msg, /tiempo/);
});

test('advertencia de doble bobina y entrada usada como bobina', () => {
  const { prog } = load('entrada I1 pulsador\nI1 -> Q1\nI2 -> Q1\nI2 -> I1');
  assert.ok(prog.warns.some(w => /Doble bobina/.test(w.msg)));
  assert.ok(prog.errors.some(e => /declarada como entrada/.test(e.msg)));
});

test('Ej. 4: marcha-parada con autorretención', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'g1e4').code);
  let v = step(ctx, { I1: true }); assert.equal(v('Q1'), true);
  v = step(ctx, { I1: false }); assert.equal(v('Q1'), true);
  v = step(ctx, { I2: true }); assert.equal(v('Q1'), false);
  v = step(ctx, { I2: false }); assert.equal(v('Q1'), false);
  v = step(ctx, { I3: true, I1: true }); assert.equal(v('Q1'), false);
});

test('Ej. 5: nunca Q1 y Q3 a la vez', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'g1e5').code);
  let v = step(ctx, { I1: true }); v = step(ctx, { I1: false });
  assert.equal(v('Q1'), true);
  v = step(ctx, { I3: true }); assert.equal(v('Q1'), false); assert.equal(v('Q3'), true);
  v = step(ctx, { I1: true, I3: true }); assert.ok(!(v('Q1') && v('Q3')));
});

test('Ej. 9: set/reset con prioridad del reset', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'g1e9').code);
  let v = step(ctx, { I1: true }); v = step(ctx, { I1: false }); assert.equal(v('Q2'), true);
  v = step(ctx, { I1: true, I3: true }); assert.equal(v('Q2'), false);
});

test('Ej. 11: relé de impulsos cambia solo con el flanco', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'g1e11').code);
  let v = step(ctx, { C1: true }); assert.equal(v('Q1'), true);
  v = step(ctx, {}); assert.equal(v('Q1'), true);
  v = step(ctx, { C1: false }); assert.equal(v('Q1'), true);
  v = step(ctx, { C3: true }); assert.equal(v('Q1'), false);
});

test('TON: estrella-triángulo cambia a los 5 s', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'ton').code);
  let v = step(ctx, { I1: true }); step(ctx, { I1: false });
  v = step(ctx, {}, 0); assert.equal(v('Q2'), true); assert.equal(v('Q3'), false);
  for (let t = 0; t < 49; t++) v = step(ctx, {}, 100);
  assert.equal(v('Q2'), true);
  v = step(ctx, {}, 100); v = step(ctx, {}, 0);
  assert.equal(v('Q2'), false); assert.equal(v('Q3'), true);
});

test('TOF: luz de escalera se apaga 8 s después de soltar', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'tof').code);
  let v = step(ctx, { I1: true }); assert.equal(v('Q1'), true);
  v = step(ctx, { I1: false }, 100);
  for (let t = 0; t < 78; t++) v = step(ctx, {}, 100);
  assert.equal(v('Q1'), true);
  v = step(ctx, {}, 100); v = step(ctx, {}, 100); assert.equal(v('Q1'), false);
});

test('TP: pulso de duración fija aunque se mantenga el pulsador', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'tp').code);
  let v = step(ctx, { I1: true }); assert.equal(v('Q1'), true);
  for (let t = 0; t < 21; t++) v = step(ctx, {}, 100);
  v = step(ctx, {}, 0); assert.equal(v('Q1'), false);
});

test('CTU: cuenta flancos y se resetea', () => {
  const ctx = load(EXAMPLES.find(e => e.id === 'ctu').code);
  let v;
  for (let k = 0; k < 5; k++) { step(ctx, { I1: true }); v = step(ctx, { I1: false }); }
  assert.equal(v('Q1'), false);
  step(ctx, { I1: true }); v = step(ctx, { I1: false }); assert.equal(v('Q1'), true);
  step(ctx, { I2: true }); v = step(ctx, { I2: false }); assert.equal(v('Q1'), false);
  assert.equal(ctx.st.ct.CT1.cv, 0);
});

test('tabla de verdad solo para programas sin memoria', () => {
  assert.ok(L.truthTable(load(EXAMPLES.find(e => e.id === 'g1e6').code).prog));
  assert.equal(L.truthTable(load(EXAMPLES.find(e => e.id === 'g1e4').code).prog), null);
  const tt = L.truthTable(load(EXAMPLES.find(e => e.id === 'g1e8').code).prog);
  // H=0 T=0 L=0 → toldo 1, riego 1
  assert.deepEqual(tt.rows[0].outs, [true, true]);
});

test('edición visual: serie, paralelo y borrado mantienen un modelo válido', () => {
  const m = L.parseProgram('I1 -> Q1');
  const r = m.rungs[0];
  const a = r.e, b = L.contact('I2'), c = L.contact('I3', true);
  L.insertSeries(r, a, b, true);
  assert.equal(L.exprText(r.e), 'I1 & I2');
  L.insertParallel(r, a, c);
  assert.equal(L.exprText(r.e), '(I1 | /I3) & I2');
  L.removeNode(r, a);
  assert.equal(L.exprText(r.e), '/I3 & I2');
  L.removeNode(r, b); L.removeNode(r, c);
  assert.equal(r.e, null);
  assert.equal(L.serialize(m), '-> Q1\n');
  assert.deepEqual(L.parseProgram(L.serialize(m)).errors, []);
});
