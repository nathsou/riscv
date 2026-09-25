/** Shifter, ALU and branch comparator. */
import type { Def } from '../netlist.ts';
import { mask } from '../netlist.ts';
import { AND, OR, XOR, NOT, XNOR, SPLIT, SLICE, CONCAT, CONST } from './gates.ts';
import { memo, MUXW2, MUXN, ADDER32, COND_INVERT, BITWISE, ZERO_DETECT } from './blocks.ts';

const REVERSE32: Def = {
  type: 'Reverse32', name: 'Bit reversal', wiring: true, shape: 'wire',
  inputs: [{ name: 'in', width: 32, quiet: true }], outputs: [{ name: 'out', width: 32, quiet: true }],
  behave: ([v]) => { let r = 0; for (let i = 0; i < 32; i++) r |= ((v >>> i) & 1) << (31 - i); return [r >>> 0]; },
  size: [30, 16], doc: 'Wires only: bit i goes to bit 31 − i. Lets one left-shifter also shift right.',
};

const SHIFT_WIRE = (k: number) => memo('shw' + k, () => ({
  type: `ShiftWire${k}`, name: `≪ ${k}`, wiring: true, shape: 'wire' as const,
  inputs: [{ name: 'in', width: 32, quiet: true }, { name: 'fill', width: 1, kind: 'ctrl' as const, quiet: true }],
  outputs: [{ name: 'out', width: 32, quiet: true }],
  behave: ([v, f]) => [((v << k) | (f ? mask(k) : 0)) >>> 0],
  size: [30, 16] as [number, number],
  doc: `Wires only: every bit moves up ${k} places; the ${k} vacated bits take the fill value.`,
}));

export const SHIFTER: Def = {
  type: 'BarrelShifter32', name: '32-bit barrel shifter',
  inputs: [
    { name: 'a', width: 32 }, { name: 'shamt', width: 5 },
    { name: 'right', width: 1, side: 'b', kind: 'ctrl' }, { name: 'arith', width: 1, side: 'b', kind: 'ctrl' },
  ],
  outputs: [{ name: 'y', width: 32 }],
  behave: ([a, s, right, arith]) => [(right ? (arith ? (a | 0) >> s : a >>> s) : a << s) >>> 0],
  build(b) {
    const a = b.in('a'), right = b.in('right');
    const rev = b.add(REVERSE32, [a], { name: 'revIn' })[0];
    let x = b.add(MUXW2(32), [a, rev, right], { name: 'dirIn', netNames: ['x0'] })[0];
    const a31 = b.add(SLICE(32, 31, 31), [a], { name: 'sign' })[0];
    const fill = b.add(AND(3), [right, b.in('arith'), a31], { name: 'fill', netNames: ['fill'] })[0];
    const sh = b.add(SPLIT(5), [b.in('shamt')], { name: 'shamtBits' });
    for (let k = 0; k < 5; k++) {
      const shifted = b.add(SHIFT_WIRE(1 << k), [x, fill], { name: `wire${1 << k}` })[0];
      x = b.add(MUXW2(32), [x, shifted, sh[k]], { name: `stage${k}`, netNames: [`x${k + 1}`] })[0];
    }
    const revOut = b.add(REVERSE32, [x], { name: 'revOut' })[0];
    b.out('y', b.add(MUXW2(32), [x, revOut, right], { name: 'dirOut' })[0]);
  },
  doc: 'Shifts by any amount 0–31 in five fixed stages (1, 2, 4, 8, 16 places), each a row of 2:1 multiplexers controlled by one bit of the shift amount. Right shifts reverse the bits, shift left, and reverse back; arithmetic shifts fill with the sign bit.',
  level: 'mux stages',
};

/** ALU operation encoding: {alt, funct3}. */
export const ALU_OPS = { add: 0b0000, sub: 0b1000, sll: 0b0001, slt: 0b0010, sltu: 0b0011, xor: 0b0100, srl: 0b0101, sra: 0b1101, or: 0b0110, and: 0b0111 } as const;
export const ALU_OP_NAMES: Record<number, string> = Object.fromEntries(Object.entries(ALU_OPS).map(([k, v]) => [v, k]));

export function aluCompute(a: number, b: number, op: number): number {
  switch (op) {
    case ALU_OPS.add: return (a + b) >>> 0;
    case ALU_OPS.sub: return (a - b) >>> 0;
    case ALU_OPS.sll: return (a << (b & 31)) >>> 0;
    case ALU_OPS.slt: return (a | 0) < (b | 0) ? 1 : 0;
    case ALU_OPS.sltu: return (a >>> 0) < (b >>> 0) ? 1 : 0;
    case ALU_OPS.xor: return (a ^ b) >>> 0;
    case ALU_OPS.srl: return a >>> (b & 31);
    case ALU_OPS.sra: return ((a | 0) >> (b & 31)) >>> 0;
    case ALU_OPS.or: return (a | b) >>> 0;
    case ALU_OPS.and: return (a & b) >>> 0;
  }
  // Undefined encodings behave like the hardware's result mux: select by funct3.
  return aluCompute(a, b, op & 7);
}

const ALU_DECODE: Def = {
  type: 'ALUDecode', name: 'ALU control',
  inputs: [{ name: 'op', width: 4, kind: 'ctrl' }],
  outputs: [{ name: 'sub', width: 1, kind: 'ctrl' }, { name: 'right', width: 1, kind: 'ctrl' }, { name: 'arith', width: 1, kind: 'ctrl' }, { name: 'sel', width: 3, kind: 'ctrl' }],
  behave: ([op]) => {
    const f = op & 7, alt = (op >> 3) & 1;
    return [alt | ((~f >> 2) & 1 & (f >> 1) & 1), (f >> 2) & 1, alt, f];
  },
  build(b) {
    const [f0, f1, f2, alt] = b.add(SPLIT(4), [b.in('op')], { name: 'bits' });
    const nf2 = b.add(NOT, [f2], { name: 'nf2' })[0];
    const cmp = b.add(AND(), [nf2, f1], { name: 'isCmp', netNames: ['slt/sltu'] })[0];
    b.out('sub', b.add(OR(), [alt, cmp], { name: 'sub', netNames: ['sub'] })[0]);
    b.out('right', f2);
    b.out('arith', alt);
    b.out('sel', b.add(CONCAT([1, 1, 1]), [f0, f1, f2], { name: 'sel' })[0]);
  },
  doc: 'Decodes the 4-bit ALU operation: subtract for sub/slt/sltu, shift right when bit 2 is set, arithmetic when the alternate bit is set; the low three bits pick the result.',
  level: 'gates',
};

export const ALU: Def = {
  type: 'ALU', name: 'Arithmetic logic unit', shape: 'alu',
  inputs: [{ name: 'a', width: 32 }, { name: 'b', width: 32 }, { name: 'op', width: 4, side: 'b', kind: 'ctrl' }],
  outputs: [{ name: 'y', width: 32 }],
  behave: ([a, b, op]) => [aluCompute(a, b, op)],
  build(b) {
    const a = b.in('a'), bb = b.in('b');
    const [sub, right, arith, sel] = b.add(ALU_DECODE, [b.in('op')], { name: 'decode', netNames: ['sub', 'right', 'arith', 'sel'] });
    const binv = b.add(COND_INVERT(32), [bb, sub], { name: 'invB', netNames: ['b or ~b'] })[0];
    const [sum, cout] = b.add(ADDER32(), [a, binv, sub], { name: 'adder', netNames: ['sum', 'carry'] });
    const a31 = b.add(SLICE(32, 31, 31), [a], { name: 'a31' })[0];
    const b31 = b.add(SLICE(32, 31, 31), [binv], { name: 'b31' })[0];
    const s31 = b.add(SLICE(32, 31, 31), [sum], { name: 's31' })[0];
    const same = b.add(XNOR(), [a31, b31], { name: 'sameSign' })[0];
    const flip = b.add(XOR(), [s31, a31], { name: 'signFlip' })[0];
    const ovf = b.add(AND(), [same, flip], { name: 'overflow', netNames: ['overflow'] })[0];
    const lt = b.add(XOR(), [s31, ovf], { name: 'lt', netNames: ['a < b (signed)'] })[0];
    const ltu = b.add(NOT, [cout], { name: 'ltu', netNames: ['a < b (unsigned)'] })[0];
    const zero31 = b.add(CONST(31, 0), [], { name: 'zeros' })[0];
    const sltZ = b.add(CONCAT([1, 31]), [lt, zero31], { name: 'sltExt', netNames: ['slt'] })[0];
    const sltuZ = b.add(CONCAT([1, 31]), [ltu, zero31], { name: 'sltuExt', netNames: ['sltu'] })[0];
    const shamt = b.add(SLICE(32, 4, 0), [bb], { name: 'shamt', netNames: ['shamt'] })[0];
    const sh = b.add(SHIFTER, [a, shamt, right, arith], { name: 'shifter', netNames: ['shifted'] })[0];
    const x = b.add(BITWISE('xor', 32), [a, bb], { name: 'xor', netNames: ['a ^ b'] })[0];
    const o = b.add(BITWISE('or', 32), [a, bb], { name: 'or', netNames: ['a | b'] })[0];
    const n = b.add(BITWISE('and', 32), [a, bb], { name: 'and', netNames: ['a & b'] })[0];
    const y = b.add(MUXN(32, 8, ['add/sub', 'sll', 'slt', 'sltu', 'xor', 'srl/sra', 'or', 'and']), [sum, sh, sltZ, sltuZ, x, sh, o, n, sel], { name: 'result', netNames: ['y'] })[0];
    b.out('y', y);
  },
  label: i => ALU_OP_NAMES[i.inVals[2]] ?? null,
  doc: 'Computes every operation in parallel — sum/difference, shift, comparisons, and/or/xor — and a multiplexer picks the one the control unit asked for. Subtraction reuses the adder: a − b = a + ~b + 1.',
  level: 'components',
};

export const BRANCH_COMP: Def = {
  type: 'BranchComp', name: 'Branch comparator',
  inputs: [{ name: 'a', width: 32 }, { name: 'b', width: 32 }],
  outputs: [{ name: 'eq', width: 1, kind: 'ctrl' }, { name: 'lt', width: 1, kind: 'ctrl' }, { name: 'ltu', width: 1, kind: 'ctrl' }],
  behave: ([a, b]) => [a === b ? 1 : 0, (a | 0) < (b | 0) ? 1 : 0, (a >>> 0) < (b >>> 0) ? 1 : 0],
  build(b) {
    const a = b.in('a'), bb = b.in('b');
    const diff = b.add(BITWISE('xor', 32), [a, bb], { name: 'xor', netNames: ['a ^ b'] })[0];
    b.out('eq', b.add(ZERO_DETECT(32), [diff], { name: 'zero', netNames: ['eq'] })[0]);
    const one = b.add(CONST(1, 1), [], { name: 'one' })[0];
    const nb = b.add(COND_INVERT(32), [bb, one], { name: 'invB', netNames: ['~b'] })[0];
    const [sum, cout] = b.add(ADDER32(), [a, nb, one], { name: 'sub', netNames: ['a - b', 'carry'] });
    const a31 = b.add(SLICE(32, 31, 31), [a], { name: 'a31' })[0];
    const b31 = b.add(SLICE(32, 31, 31), [nb], { name: 'b31' })[0];
    const s31 = b.add(SLICE(32, 31, 31), [sum], { name: 's31' })[0];
    const ovf = b.add(AND(), [b.add(XNOR(), [a31, b31], { name: 'same' })[0], b.add(XOR(), [s31, a31], { name: 'flip' })[0]], { name: 'ovf', netNames: ['overflow'] })[0];
    b.out('lt', b.add(XOR(), [s31, ovf], { name: 'lt', netNames: ['lt'] })[0]);
    b.out('ltu', b.add(NOT, [cout], { name: 'ltu', netNames: ['ltu'] })[0]);
  },
  doc: 'Compares rs1 and rs2 for branches: equality via XOR + zero detection, signed/unsigned less-than via a subtraction (sign ⊕ overflow, and no-carry).',
  level: 'components',
};

