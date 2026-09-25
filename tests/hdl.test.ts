import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHdl, hdlDef, checkAgainst, evalHdl } from '../src/learn/hdl.ts';
import { checkEquivalence } from '../src/hw/netlist.ts';

test('HDL modules compile to netlists equivalent to their behaviour', () => {
  const { mod, errors } = parseHdl(`in a, b, cin\nout s, cout\ns1, c1 = ha(a, b)\ns, c2 = ha(s1, cin)\ncout = or(c1, c2)\n`);
  assert.deepEqual(errors, []);
  const def = hdlDef(mod!);
  for (let k = 0; k < 8; k++) {
    const ins = [k >> 2 & 1, k >> 1 & 1, k & 1];
    assert.ok(checkEquivalence(def, ins).ok);
    const sum = ins[0] + ins[1] + ins[2];
    assert.deepEqual(evalHdl(mod!, ins), [sum & 1, sum >> 1]);
  }
  assert.ok(checkAgainst(mod!, ([a, b, c]) => [a ^ b ^ c, (a + b + c) >> 1], ['s', 'cout']).ok);
});

test('HDL reports helpful errors', () => {
  const e = (src: string) => parseHdl(src).errors[0]?.message ?? '';
  assert.match(e('in a\nout y\ny = nand(a, q)\n'), /unknown signal “q”/);
  assert.match(e('in a\nout y\ny = frob(a, a)\n'), /unknown gate/);
  assert.match(e('in a\nout y\ny = and(a)\n'), /at least two/);
  assert.match(e('in a\nout y, z\ny = not(a)\n'), /never assigned/);
  assert.match(e('in a\nout y\ny = not(a)\ny = not(a)\n'), /already defined/);
  assert.match(e('in a, b\nout y\ns = ha(a, b)\ny = s\n'), /2 outputs/);
});

test('challenge solutions pass and starters do not', async () => {
  const { CHALLENGES } = await import('../src/learn/challenges.ts');
  for (const c of CHALLENGES) {
    if (!c.target) continue;
    const sol = parseHdl(c.solution!);
    assert.deepEqual(sol.errors, [], c.id);
    assert.ok(checkAgainst(sol.mod!, c.target, c.outputs).ok, `${c.id} solution`);
    if (c.allowed) for (const st of sol.mod!.stmts) assert.ok(st.fn === 'buf' || c.allowed.includes(st.fn), `${c.id} uses ${st.fn}`);
    const start = parseHdl(c.starter);
    assert.deepEqual(start.errors, [], `${c.id} starter compiles`);
    assert.ok(!checkAgainst(start.mod!, c.target, c.outputs).ok, `${c.id} starter should not already pass`);
  }
});
