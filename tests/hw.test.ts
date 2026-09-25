import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEquivalence, delays } from '../src/hw/netlist.ts';
import type { Def } from '../src/hw/netlist.ts';
import { MUX2, MUXW2, MUXN, DECODER, FULL_ADDER, RIPPLE_ADDER, CLA_ADDER32, PG4, SUM4, LCU8, BITWISE, COND_INVERT, ZERO_DETECT } from '../src/hw/lib/blocks.ts';
import { SHIFTER, ALU, BRANCH_COMP } from '../src/hw/lib/alu.ts';
import { CONTROL } from '../src/hw/lib/control.ts';
import { IMMGEN, NEXTPC, EXCEPTION, REGISTER, DFF, REGFILE } from '../src/hw/lib/state.ts';
import { INSTRUCTIONS } from '../src/isa/spec/index.ts';
import { rng } from './helpers.ts';

function randFor(def: Def, next: () => number): number[] {
  return def.inputs.map(p => {
    const r = next();
    const k = r % 8;
    const m = p.width >= 32 ? 0xffffffff : (1 << p.width) - 1;
    const v = k === 0 ? 0 : k === 1 ? m : k === 2 ? 0x80000000 : next();
    return (v & m) >>> 0;
  });
}

const DEFS: Def[] = [MUX2, MUXW2(8), MUXN(32, 5), MUXN(4, 8), DECODER(3), FULL_ADDER, RIPPLE_ADDER(8), RIPPLE_ADDER(32), CLA_ADDER32, PG4, SUM4, LCU8,
  BITWISE('xor', 32), COND_INVERT(32), ZERO_DETECT(32), SHIFTER, ALU, BRANCH_COMP, IMMGEN, NEXTPC, EXCEPTION];

for (const def of DEFS) {
  test(`gate-level ${def.type} == behavioural model`, () => {
    const next = rng(def.type.length * 7919);
    for (let i = 0; i < 300; i++) {
      const inp = randFor(def, next);
      if (def === ALU) inp[2] = [0, 8, 1, 2, 3, 4, 5, 13, 6, 7][next() % 10];
      if (def === IMMGEN) inp[1] = next() % 6;
      if (def === NEXTPC) inp[0] = next() % 7;
      const r = checkEquivalence(def, inp);
      assert.ok(r.ok, `${def.type}(${inp.map(x => x.toString(16))}) behave=${r.behave.map(x => x.toString(16))} gates=${r.structural.map(x => x.toString(16))}`);
    }
  });
}

test('control PLA (generated from the spec) matches the decoder for every instruction', () => {
  const next = rng(99);
  for (const s of INSTRUCTIONS) {
    for (let k = 0; k < 20; k++) {
      const w = ((next() & ~s.mask) | s.match) >>> 0;
      const r = checkEquivalence(CONTROL, [w]);
      assert.ok(r.ok, `${s.mnemonic}: ${r.behave} vs ${r.structural}`);
    }
  }
  for (let k = 0; k < 500; k++) {
    const r = checkEquivalence(CONTROL, [next()]);
    assert.ok(r.ok, 'random word');
  }
});

test('flip-flops and registers hold their state at gate level', () => {
  for (const v of [0, 1]) for (const d of [0, 1]) {
    const r = checkEquivalence(DFF, [d, 0], { state: () => v });
    assert.ok(r.ok);
    assert.equal(r.structural[0], v);
  }
  const r = checkEquivalence(REGISTER(8), [0x5a, 1], { state: () => 0xc3 });
  assert.ok(r.ok);
  assert.equal(r.structural[0], 0xc3);
  const regs = Int32Array.from({ length: 32 }, (_, i) => i * 0x01010101);
  const rf = checkEquivalence(REGFILE, [5, 31, 3, 0x1234, 1], { regs: () => regs });
  assert.ok(rf.ok);
  assert.equal(rf.structural[0], 5 * 0x01010101);
});

test('carry-lookahead is much faster than ripple-carry', () => {
  const ripple = Math.max(...delays(RIPPLE_ADDER(32)));
  const cla = Math.max(...delays(CLA_ADDER32));
  assert.ok(ripple >= 60, `ripple ${ripple}`);
  assert.ok(cla <= 12, `cla ${cla}`);
});

test('teaching circuits match their behaviour exhaustively', async () => {
  const { XOR_FROM_NAND, ADDSUB4 } = await import('../src/learn/defs.ts');
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) assert.ok(checkEquivalence(XOR_FROM_NAND, [a, b]).ok);
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let s = 0; s < 2; s++) {
    const r = checkEquivalence(ADDSUB4, [a, b, s]);
    assert.ok(r.ok, `${a} ${b} ${s}: ${r.behave} vs ${r.structural}`);
  }
});
