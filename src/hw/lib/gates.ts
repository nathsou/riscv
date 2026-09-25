/** Primitive logic gates and zero-delay wiring nodes. */
import type { Def, Port } from '../netlist.ts';
import { mask } from '../netlist.ts';

const bitIn = (names: string[]): Port[] => names.map(name => ({ name, width: 1, kind: 'ctrl' as const, quiet: true }));
const out1: Port[] = [{ name: 'y', width: 1, kind: 'ctrl', quiet: true }];

function gate(type: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor', n: number, fn: (xs: number[]) => number, doc: string): Def {
  return {
    type: n === 2 ? type.toUpperCase() : `${type.toUpperCase()}${n}`,
    name: `${type.toUpperCase()} gate`,
    inputs: bitIn(Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i))),
    outputs: out1,
    behave: xs => [fn(xs) & 1],
    delay: 1,
    shape: type,
    doc,
  };
}

const cache = new Map<string, Def>();
function memo(key: string, f: () => Def): Def {
  let d = cache.get(key);
  if (!d) { d = f(); cache.set(key, d); }
  return d;
}

export const AND = (n = 2) => memo('and' + n, () => gate('and', n, xs => xs.every(Boolean) ? 1 : 0, 'Output is 1 only when every input is 1.'));
export const OR = (n = 2) => memo('or' + n, () => gate('or', n, xs => xs.some(Boolean) ? 1 : 0, 'Output is 1 when any input is 1.'));
export const XOR = (n = 2) => memo('xor' + n, () => gate('xor', n, xs => xs.reduce((a, b) => a ^ b, 0), 'Output is 1 when an odd number of inputs are 1 (for two inputs: when they differ).'));
export const NAND = (n = 2) => memo('nand' + n, () => gate('nand', n, xs => xs.every(Boolean) ? 0 : 1, 'NOT-AND. Universal: any circuit can be built from NANDs alone.'));
export const NOR = (n = 2) => memo('nor' + n, () => gate('nor', n, xs => xs.some(Boolean) ? 0 : 1, 'NOT-OR. Output is 1 only when every input is 0.'));
export const XNOR = (n = 2) => memo('xnor' + n, () => gate('xnor', n, xs => xs.reduce((a, b) => a ^ b, 0) ^ 1, 'Equality: output is 1 when the inputs are the same.'));

export const NOT: Def = {
  type: 'NOT', name: 'Inverter', inputs: bitIn(['a']), outputs: out1,
  behave: ([a]) => [a ? 0 : 1], delay: 1, shape: 'not',
  doc: 'Flips a bit. In CMOS it is two transistors: a PMOS pull-up and an NMOS pull-down.',
};

export const BUF: Def = {
  type: 'BUF', name: 'Buffer', inputs: bitIn(['a']), outputs: out1,
  behave: ([a]) => [a], delay: 1, shape: 'buf', doc: 'Passes its input through (restores signal strength).',
};

// ------------------------------------------------------------------ wiring
/** Split a bus into its individual bits (LSB = output 0). */
export const SPLIT = (w: number) => memo('split' + w, () => ({
  type: `Split${w}`, name: 'Bus split', wiring: true, shape: 'split',
  inputs: [{ name: 'bus', width: w, quiet: true }],
  outputs: Array.from({ length: w }, (_, i) => ({ name: `b${i}`, width: 1, kind: 'ctrl' as const, quiet: true })),
  behave: ([v]) => Array.from({ length: w }, (_, i) => (v >>> i) & 1),
  doc: 'Wires only: fans a bus out into separate bits.',
}));

/** Join bits into a bus (input 0 = LSB). */
export const JOIN = (w: number) => memo('join' + w, () => ({
  type: `Join${w}`, name: 'Bus join', wiring: true, shape: 'join',
  inputs: Array.from({ length: w }, (_, i) => ({ name: `b${i}`, width: 1, kind: 'ctrl' as const, quiet: true })),
  outputs: [{ name: 'bus', width: w, quiet: true }],
  behave: bits => [bits.reduce((acc, b, i) => acc | ((b & 1) << i), 0) >>> 0],
  doc: 'Wires only: bundles bits into a bus.',
}));

/** Take bits [hi:lo] of a bus. */
export const SLICE = (w: number, hi: number, lo: number) => memo(`slice${w}:${hi}:${lo}`, () => ({
  type: `Slice${w}_${hi}_${lo}`, name: `[${hi}:${lo}]`, wiring: true, shape: 'wire',
  inputs: [{ name: 'in', width: w, quiet: true }],
  outputs: [{ name: 'out', width: hi - lo + 1, quiet: true }],
  behave: ([v]) => [((v >>> lo) & mask(hi - lo + 1)) >>> 0],
  size: [24, 14],
  doc: `Wires only: bits ${hi} down to ${lo}.`,
}));

/** Concatenate buses; inputs listed from LSB part upwards. */
export const CONCAT = (widths: number[]) => memo('concat' + widths.join(','), () => {
  const total = widths.reduce((a, b) => a + b, 0);
  return {
    type: `Concat${widths.join('_')}`, name: 'Concatenate', wiring: true, shape: 'join',
    inputs: widths.map((w, i) => ({ name: `p${i}`, width: w, quiet: true })),
    outputs: [{ name: 'out', width: total, quiet: true }],
    behave: parts => {
      let v = 0, sh = 0;
      parts.forEach((p, i) => { v |= (p & mask(widths[i])) << sh; sh += widths[i]; });
      return [v >>> 0];
    },
    doc: 'Wires only: places buses side by side.',
  };
});

export const CONST = (w: number, v: number) => memo(`const${w}:${v}`, () => ({
  type: `Const${w}_${v}`, name: 'Constant', wiring: true, shape: 'const',
  inputs: [], outputs: [{ name: 'k', width: w, quiet: true }],
  behave: () => [(v & mask(w)) >>> 0],
  label: () => w === 1 ? String(v) : `${v}`,
  doc: `A constant ${w === 1 ? (v ? 'logic 1 (tied to VDD)' : 'logic 0 (tied to ground)') : v}.`,
}));

/** Replicate a single bit w times (sign-extension wiring). */
export const FANOUT = (w: number) => memo('fanout' + w, () => ({
  type: `Fanout${w}`, name: 'Fan-out', wiring: true, shape: 'wire',
  inputs: [{ name: 'b', width: 1, quiet: true }],
  outputs: [{ name: 'out', width: w, quiet: true }],
  behave: ([b]) => [b ? mask(w) >>> 0 : 0],
  size: [24, 14],
  doc: `Wires only: one bit copied onto ${w} wires.`,
}));
