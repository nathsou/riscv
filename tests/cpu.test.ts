import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { assemble } from '../src/asm/assembler.ts';
import { Machine } from '../src/sim/machine.ts';
import { SingleCycleEngine } from '../src/hw/cpu/single.ts';
import { checkDeep } from '../src/hw/netlist.ts';

const dir = new URL('../src/content/examples/', import.meta.url);

function state(m: Machine) {
  let memHash = 0;
  for (const [no, p] of [...m.mem.pages].sort((a, b) => a[0] - b[0])) for (let i = 0; i < p.length; i++) memHash = (Math.imul(memHash, 31) + p[i] + no) | 0;
  return { x: [...m.x], pc: m.pc, out: m.consoleOut, status: m.status, instret: m.instret, memHash, mcause: m.mcause };
}

type Stepper = { step(): void };

for (const f of readdirSync(dir).filter(f => f.endsWith('.s')).sort()) {
  test(`single-cycle datapath ≡ ISA on ${f}`, () => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const r = assemble(src);
    assert.ok(r.ok);
    const a = new Machine(), b = new Machine();
    a.loadProgram(r.image); b.loadProgram(r.image);
    a.provideInput('6\n7\n'); b.provideInput('6\n7\n');
    const eng = new SingleCycleEngine(b);
    const steppers: [Machine, Stepper][] = [[a, a], [b, eng]];
    for (let i = 0; i < 4000; i++) {
      for (const [m, s] of steppers) if (m.status === 'ready') { s.step(); m.sleepMs = 0; }
      if (i % 97 === 0 || a.status !== 'ready') assert.deepEqual(state(b), state(a), `diverged after ${i} steps (pc ${a.pc.toString(16)})`);
      if (a.status !== 'ready' && b.status !== 'ready') break;
    }
    assert.deepEqual(state(b), state(a));
  });
}

test('every block of the datapath agrees with its gate-level structure (3 levels deep)', () => {
  const r = assemble(readFileSync(new URL('03-fib.s', dir), 'utf8'));
  const m = new Machine();
  m.loadProgram(r.image);
  const eng = new SingleCycleEngine(m);
  for (let i = 0; i < 60; i++) {
    eng.step();
    const s = eng.structure;
    for (const name of ['alu', 'bcomp', 'immgen', 'control', 'nextpc', 'aMux', 'wbMux']) {
      const node = s.node(name)!;
      const errs = checkDeep(node.inst, 3);
      assert.deepEqual(errs, [], `${name} at step ${i}`);
    }
  }
});
