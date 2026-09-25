/** Combinational building blocks, each with a gate-level structure. */
import type { Def, Structure } from '../netlist.ts';
import { mask } from '../netlist.ts';
import { AND, OR, XOR, NOT, SPLIT, JOIN, CONST, FANOUT, NOR, CONCAT } from './gates.ts';

const cache = new Map<string, Def>();
export function memo(key: string, f: () => Def): Def {
  let d = cache.get(key);
  if (!d) { d = f(); cache.set(key, d); }
  return d;
}

const clog2 = (n: number) => Math.max(1, Math.ceil(Math.log2(n)));

// ------------------------------------------------------------------ multiplexers
export const MUX2: Def = {
  type: 'Mux2', name: '2:1 multiplexer (1 bit)', shape: 'mux',
  inputs: [{ name: 'd0', width: 1, kind: 'ctrl' }, { name: 'd1', width: 1, kind: 'ctrl' }, { name: 's', width: 1, side: 'b', kind: 'ctrl' }],
  outputs: [{ name: 'y', width: 1, kind: 'ctrl' }],
  behave: ([a, b, s]) => [s ? b : a],
  build(b) {
    const s = b.in('s');
    const [ns] = b.add(NOT, [s], { name: 'inv' });
    const [t0] = b.add(AND(), [b.in('d0'), ns], { name: 'and0' });
    const [t1] = b.add(AND(), [b.in('d1'), s], { name: 'and1' });
    const [y] = b.add(OR(), [t0, t1], { name: 'or' });
    b.out('y', y);
  },
  liveIn: ([, , s]) => [!s, !!s, true],
  label: i => `${i.inVals[2]}`,
  doc: 'Selects d0 when s = 0 and d1 when s = 1: y = (d0 · ¬s) + (d1 · s).',
  level: 'gates',
};

export const MUXW2 = (w: number) => memo('muxw2_' + w, () => ({
  type: `Mux2x${w}`, name: `2:1 multiplexer (${w} bits)`, shape: 'mux',
  inputs: [{ name: 'd0', width: w }, { name: 'd1', width: w }, { name: 's', width: 1, side: 'b', kind: 'ctrl' }],
  outputs: [{ name: 'y', width: w }],
  behave: ([a, b, s]) => [s ? b : a],
  build(b) {
    const a = b.add(SPLIT(w), [b.in('d0')], { name: 'split0' });
    const c = b.add(SPLIT(w), [b.in('d1')], { name: 'split1' });
    const bits = a.map((_, i) => b.add(MUX2, [a[i], c[i], b.in('s')], { name: `bit${i}` })[0]);
    b.out('y', b.add(JOIN(w), bits, { name: 'join' })[0]);
  },
  liveIn: ([, , s]) => [!s, !!s, true],
  label: i => `${i.inVals[2]}`,
  doc: `${w} one-bit multiplexers side by side, all sharing the select line.`,
  level: 'bit slices',
}));

/** n-way multiplexer built as a binary tree of 2:1 multiplexers. */
export const MUXN = (w: number, n: number, names?: string[]) => memo(`muxn_${w}_${n}_${names?.join(',') ?? ''}`, () => {
  const sw = clog2(n);
  return {
    type: `Mux${n}x${w}`, name: `${n}:1 multiplexer (${w} bits)`, shape: 'mux',
    inputs: [...Array.from({ length: n }, (_, i) => ({ name: names?.[i] ?? `d${i}`, width: w })), { name: 's', width: sw, side: 'b' as const, kind: 'ctrl' as const }],
    outputs: [{ name: 'y', width: w }],
    behave: ins => [ins[n] < n ? ins[ins[n]] : 0],
    build(b) {
      const sel = b.add(SPLIT(sw), [b.in('s')], { name: 'sel' });
      let level = Array.from({ length: n }, (_, i) => b.in(i));
      for (let k = 0; k < sw; k++) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          const a = level[i];
          const c = level[i + 1] ?? b.add(CONST(w, 0), [], { name: `zero${k}_${i}` })[0];
          next.push(b.add(MUXW2(w), [a, c, sel[k]], { name: `m${k}_${i / 2}` })[0]);
        }
        level = next;
      }
      b.out('y', level[0]);
    },
    liveIn: ins => ins.map((_, i) => i === n || i === ins[n]),
    label: i => names?.[i.inVals[n]] ?? `${i.inVals[n]}`,
    doc: `Selects one of ${n} inputs using a ${sw}-bit select: a tree of 2:1 multiplexers, one level per select bit.`,
    level: 'mux tree',
  };
});

/** n → 2^n one-hot decoder (output is a bus, bit i = (sel == i)). */
export const DECODER = (nb: number) => memo('dec' + nb, () => ({
  type: `Decoder${nb}`, name: `${nb}→${1 << nb} decoder`,
  inputs: [{ name: 'sel', width: nb }],
  outputs: [{ name: 'y', width: 1 << nb, kind: 'ctrl' as const }],
  behave: ([s]) => [(1 << s) >>> 0],
  build(b) {
    const bits = b.add(SPLIT(nb), [b.in('sel')], { name: 'split' });
    const inv = bits.map((x, i) => b.add(NOT, [x], { name: `inv${i}` })[0]);
    const outs = Array.from({ length: 1 << nb }, (_, v) =>
      b.add(AND(nb), bits.map((x, i) => (v >> i) & 1 ? x : inv[i]), { name: `and${v}` })[0]);
    b.out('y', b.add(JOIN(1 << nb), outs, { name: 'join' })[0]);
  },
  doc: `Turns a ${nb}-bit number into ${1 << nb} one-hot lines: each output is an AND of the select bits or their complements.`,
  level: 'gates',
}));

// ------------------------------------------------------------------ adders
export const HALF_ADDER: Def = {
  type: 'HalfAdder', name: 'Half adder',
  inputs: [{ name: 'a', width: 1, kind: 'ctrl' }, { name: 'b', width: 1, kind: 'ctrl' }],
  outputs: [{ name: 's', width: 1, kind: 'ctrl' }, { name: 'c', width: 1, kind: 'ctrl' }],
  behave: ([a, b]) => [a ^ b, a & b],
  build(b) {
    b.out('s', b.add(XOR(), [b.in('a'), b.in('b')], { name: 'xor' })[0]);
    b.out('c', b.add(AND(), [b.in('a'), b.in('b')], { name: 'and' })[0]);
  },
  doc: 'Adds two bits: sum = a ⊕ b, carry = a · b.',
  level: 'gates',
};

export const FULL_ADDER: Def = {
  type: 'FullAdder', name: 'Full adder', shape: 'adder',
  inputs: [
    { name: 'a', width: 1, side: 't', kind: 'ctrl', pos: 0.3 }, { name: 'b', width: 1, side: 't', kind: 'ctrl', pos: 0.7 },
    { name: 'cin', width: 1, side: 'r', kind: 'ctrl' },
  ],
  outputs: [{ name: 's', width: 1, side: 'b', kind: 'ctrl' }, { name: 'cout', width: 1, side: 'l', kind: 'ctrl' }],
  behave: ([a, b, c]) => [a ^ b ^ c, (a & b) | (c & (a ^ b))],
  build(b) {
    const [p] = b.add(XOR(), [b.in('a'), b.in('b')], { name: 'xor1', netNames: ['p = a⊕b'] });
    const [s] = b.add(XOR(), [p, b.in('cin')], { name: 'xor2', netNames: ['sum'] });
    const [g] = b.add(AND(), [b.in('a'), b.in('b')], { name: 'and1', netNames: ['g = a·b'] });
    const [t] = b.add(AND(), [p, b.in('cin')], { name: 'and2', netNames: ['p·cin'] });
    const [co] = b.add(OR(), [g, t], { name: 'or', netNames: ['cout'] });
    b.out('s', s);
    b.out('cout', co);
  },
  size: [54, 46],
  label: i => `${i.inVals[0]}+${i.inVals[1]}+${i.inVals[2]}`,
  doc: 'Adds three bits. sum = a ⊕ b ⊕ cin; carry-out = a·b + cin·(a ⊕ b). The carry is "generated" when a·b and "propagated" when a ⊕ b.',
  level: 'gates',
};

/** Ripple-carry adder: w full adders chained through their carries. */
export const RIPPLE_ADDER = (w: number) => memo('ripple' + w, () => ({
  type: `RippleAdder${w}`, name: `${w}-bit ripple-carry adder`, shape: 'adder',
  inputs: [{ name: 'a', width: w }, { name: 'b', width: w }, { name: 'cin', width: 1, side: 'b' as const, kind: 'ctrl' as const }],
  outputs: [{ name: 'sum', width: w }, { name: 'cout', width: 1, kind: 'ctrl' as const }],
  behave: ([a, b, c]) => {
    const s = a + b + c;
    return [s % 2 ** w >>> 0, s >= 2 ** w ? 1 : 0];
  },
  build(b) {
    const as = b.add(SPLIT(w), [b.in('a')], { name: 'splitA' });
    const bs = b.add(SPLIT(w), [b.in('b')], { name: 'splitB' });
    let carry = b.in('cin');
    const sums = [];
    for (let i = 0; i < w; i++) {
      const [s, co] = b.add(FULL_ADDER, [as[i], bs[i], carry], { name: `fa${i}`, netNames: [`s${i}`, `c${i + 1}`] });
      sums.push(s);
      carry = co;
    }
    b.out('sum', b.add(JOIN(w), sums, { name: 'join' })[0]);
    b.out('cout', carry);
  },
  layout: rippleLayout,
  doc: `Adds two ${w}-bit numbers with a chain of full adders. Simple and small, but slow: the carry must ripple through all ${w} stages, so the delay grows linearly with the width.`,
  level: 'full adders',
}));

/**
 * Wide ripple adders: rows of 8 full adders (LSB top right), the carry
 * snaking from the end of one row to the start of the next. Bit buses are
 * shown as labelled net stubs instead of 32-way fan-out bars.
 */
export function rippleLayout(s: Structure): void {
  const fas = s.nodes.filter(n => /^fa\d+$/.test(n.inst.name));
  const w = fas.length;
  if (w <= 8) return bitSliceRowLayout(s);
  const idx = (n: typeof fas[0]) => Number(n.inst.name.slice(2));
  const per = 8, rows = Math.ceil(w / per);
  const sw = 54, sh = 46, gx = 34, rowH = sh + 92, x0 = 60, y0 = 44;
  for (const n of fas) {
    const i = idx(n), r = Math.floor(i / per), c = i % per;
    n.x = x0 + (per - 1 - c) * (sw + gx);
    n.y = y0 + r * rowH;
    n.w = sw; n.h = sh;
  }
  for (const n of s.nodes) {
    if (fas.includes(n)) continue;
    n.w = 0; n.h = 0; n.x = -999;
    if (n.inst.name.startsWith('split')) n.outs.forEach((o, i) => { o.name = `${n.inst.name.slice(5).toLowerCase()}${i}`; o.tunnel = true; });
    if (n.inst.name === 'join') n.ins.forEach(o => { o.tunnel = true; });
  }
  const right = x0 + per * (sw + gx) - gx;
  const byIdx = new Map(fas.map(n => [idx(n), n]));
  for (let r = 0; r + 1 < rows; r++) {
    const fa = byIdx.get(r * per + per - 1)!;
    const net = fa.outs[1];
    const yb = fa.y + sh + 46;
    (net.viaTo ??= {})[`fa${r * per + per}`] = [[fa.x - 16, fa.y + sh / 2], [fa.x - 16, yb], [right + 18, yb]];
  }
  s.w = right + 60;
  s.h = y0 + rows * rowH - 30;
  // carry-in enters at the bottom and runs up the right-hand side to bit 0
  const cin = s.inputs[2];
  (cin.viaTo ??= {}).fa0 = [[s.w / 2, s.h - 12], [right + 30, s.h - 12]];
  s.laidOut = true;
}

/** Lay out bit-sliced structures as a row: bit w-1 on the left, bit 0 on the right. */
export function bitSliceRowLayout(s: Structure): void {
  const slices = s.nodes.filter(n => /\d+$/.test(n.inst.name) && !/^(split|join)/.test(n.inst.name));
  const others = s.nodes.filter(n => !slices.includes(n));
  const idx = (n: typeof slices[0]) => Number(/(\d+)$/.exec(n.inst.name)![1]);
  const max = Math.max(...slices.map(idx));
  const gap = 26;
  const sw = Math.max(...slices.map(n => n.w));
  slices.forEach(n => {
    n.x = 30 + (max - idx(n)) * (sw + gap);
    n.y = 90;
  });
  const width = 60 + (max + 1) * (sw + gap);
  for (const n of others) {
    if (n.inst.name.startsWith('split')) {
      n.w = width - 60; n.h = 8;
      n.x = 30; n.y = n.inst.name.endsWith('B') || n.inst.name.endsWith('1') ? 46 : 22;
    } else if (n.inst.name.startsWith('join')) {
      n.w = width - 60; n.h = 8;
      n.x = 30; n.y = 90 + Math.max(...slices.map(x => x.h)) + 40;
    } else { n.x = width - 20; n.y = 40; }
  }
  s.w = width + 20;
  s.h = 90 + Math.max(...slices.map(x => x.h)) + 70;
  s.laidOut = true;
}

// ---- carry-lookahead adder (two-level: 4-bit groups + lookahead unit)
export const PG4: Def = {
  type: 'PG4', name: 'Propagate / generate (4 bits)',
  inputs: [{ name: 'a', width: 4 }, { name: 'b', width: 4 }],
  outputs: [{ name: 'p', width: 4, kind: 'ctrl' }, { name: 'g', width: 4, kind: 'ctrl' }, { name: 'P', width: 1, kind: 'ctrl' }, { name: 'G', width: 1, kind: 'ctrl' }],
  behave: ([a, b]) => {
    const p = (a ^ b) & 15, g = a & b & 15;
    const bit = (x: number, i: number) => (x >> i) & 1;
    const P = bit(p, 0) & bit(p, 1) & bit(p, 2) & bit(p, 3);
    const G = bit(g, 3) | (bit(p, 3) & bit(g, 2)) | (bit(p, 3) & bit(p, 2) & bit(g, 1)) | (bit(p, 3) & bit(p, 2) & bit(p, 1) & bit(g, 0));
    return [p, g, P, G];
  },
  build(b) {
    const a = b.add(SPLIT(4), [b.in('a')], { name: 'splitA' });
    const c = b.add(SPLIT(4), [b.in('b')], { name: 'splitB' });
    const p = a.map((_, i) => b.add(XOR(), [a[i], c[i]], { name: `p${i}` })[0]);
    const g = a.map((_, i) => b.add(AND(), [a[i], c[i]], { name: `g${i}` })[0]);
    b.out('p', b.add(JOIN(4), p, { name: 'joinP' })[0]);
    b.out('g', b.add(JOIN(4), g, { name: 'joinG' })[0]);
    b.out('P', b.add(AND(4), p, { name: 'P' })[0]);
    const t2 = b.add(AND(2), [p[3], g[2]], { name: 't2' })[0];
    const t1 = b.add(AND(3), [p[3], p[2], g[1]], { name: 't1' })[0];
    const t0 = b.add(AND(4), [p[3], p[2], p[1], g[0]], { name: 't0' })[0];
    b.out('G', b.add(OR(4), [g[3], t2, t1, t0], { name: 'G' })[0]);
  },
  doc: 'For each bit: p = a ⊕ b (a carry would propagate), g = a · b (a carry is generated). The group signals P and G summarise all four bits at once.',
  level: 'gates',
};

export const SUM4: Def = {
  type: 'Sum4', name: 'Lookahead carries + sum (4 bits)',
  inputs: [{ name: 'p', width: 4, kind: 'ctrl' }, { name: 'g', width: 4, kind: 'ctrl' }, { name: 'cin', width: 1, kind: 'ctrl' }],
  outputs: [{ name: 's', width: 4 }],
  behave: ([p, g, c0]) => {
    let c = c0, s = 0;
    for (let i = 0; i < 4; i++) { s |= (((p >> i) & 1) ^ c) << i; c = ((g >> i) & 1) | (((p >> i) & 1) & c); }
    return [s];
  },
  build(b) {
    const p = b.add(SPLIT(4), [b.in('p')], { name: 'splitP' });
    const g = b.add(SPLIT(4), [b.in('g')], { name: 'splitG' });
    const c0 = b.in('cin');
    // c1 = g0 + p0c0 ; c2 = g1 + p1g0 + p1p0c0 ; c3 = g2 + p2g1 + p2p1g0 + p2p1p0c0
    const c1 = b.add(OR(2), [g[0], b.add(AND(2), [p[0], c0], { name: 'c1a' })[0]], { name: 'c1' })[0];
    const c2 = b.add(OR(3), [g[1], b.add(AND(2), [p[1], g[0]], { name: 'c2a' })[0], b.add(AND(3), [p[1], p[0], c0], { name: 'c2b' })[0]], { name: 'c2' })[0];
    const c3 = b.add(OR(4), [g[2], b.add(AND(2), [p[2], g[1]], { name: 'c3a' })[0], b.add(AND(3), [p[2], p[1], g[0]], { name: 'c3b' })[0], b.add(AND(4), [p[2], p[1], p[0], c0], { name: 'c3c' })[0]], { name: 'c3' })[0];
    const cs = [c0, c1, c2, c3];
    const s = p.map((_, i) => b.add(XOR(), [p[i], cs[i]], { name: `s${i}` })[0]);
    b.out('s', b.add(JOIN(4), s, { name: 'join' })[0]);
  },
  doc: 'Computes every carry directly from p, g and the group carry-in (two gate levels), instead of waiting for a ripple. Then sum = p ⊕ carry.',
  level: 'gates',
};

/** Lookahead carry unit for 8 groups: C[i+1] = G[i] + P[i]·C[i], fully expanded. */
export const LCU8: Def = {
  type: 'LCU8', name: 'Lookahead carry unit (8 groups)',
  inputs: [{ name: 'P', width: 8, kind: 'ctrl' }, { name: 'G', width: 8, kind: 'ctrl' }, { name: 'cin', width: 1, kind: 'ctrl' }],
  outputs: [{ name: 'C', width: 8, kind: 'ctrl' }, { name: 'cout', width: 1, kind: 'ctrl' }],
  behave: ([P, G, c0]) => {
    let c = c0, C = 0;
    for (let i = 0; i < 8; i++) { C |= c << i; c = ((G >> i) & 1) | (((P >> i) & 1) & c); }
    return [C, c];
  },
  build(b) {
    const P = b.add(SPLIT(8), [b.in('P')], { name: 'splitP' });
    const G = b.add(SPLIT(8), [b.in('G')], { name: 'splitG' });
    const c0 = b.in('cin');
    const carries = [c0];
    for (let k = 1; k <= 8; k++) {
      // C[k] = G[k-1] + P[k-1]G[k-2] + … + P[k-1]…P[0]·c0
      const terms = [G[k - 1]];
      for (let j = k - 2; j >= -1; j--) {
        const lits = [];
        for (let m = k - 1; m > j; m--) lits.push(P[m]);
        lits.push(j >= 0 ? G[j] : c0);
        terms.push(b.add(AND(lits.length), lits, { name: `t${k}_${j + 1}` })[0]);
      }
      carries.push(b.add(OR(terms.length), terms, { name: `C${k}` })[0]);
    }
    b.out('C', b.add(JOIN(8), carries.slice(0, 8), { name: 'join' })[0]);
    b.out('cout', carries[8]);
  },
  doc: 'Computes the carry into every 4-bit group in just two gate levels, using the groups’ propagate (P) and generate (G) signals.',
  level: 'gates',
};

export const CLA_ADDER32: Def = {
  type: 'CLAAdder32', name: '32-bit carry-lookahead adder', shape: 'adder',
  inputs: [{ name: 'a', width: 32 }, { name: 'b', width: 32 }, { name: 'cin', width: 1, side: 'b', kind: 'ctrl' }],
  outputs: [{ name: 'sum', width: 32 }, { name: 'cout', width: 1, kind: 'ctrl' }],
  behave: ([a, b, c]) => { const s = a + b + c; return [s % 2 ** 32 >>> 0, s >= 2 ** 32 ? 1 : 0]; },
  build(b) {
    const P: ReturnType<typeof b.add>[number][] = [], G: typeof P = [], ps: typeof P = [], gs: typeof P = [];
    for (let i = 0; i < 8; i++) {
      const a4 = b.add(SLICE4(i), [b.in('a')], { name: `a${i}` })[0];
      const b4 = b.add(SLICE4(i), [b.in('b')], { name: `b${i}` })[0];
      const [p, g, Pi, Gi] = b.add(PG4, [a4, b4], { name: `pg${i}` });
      ps.push(p); gs.push(g); P.push(Pi); G.push(Gi);
    }
    const Pb = b.add(JOIN(8), P, { name: 'joinP' })[0];
    const Gb = b.add(JOIN(8), G, { name: 'joinG' })[0];
    const [C, cout] = b.add(LCU8, [Pb, Gb, b.in('cin')], { name: 'lcu' });
    const Cs = b.add(SPLIT(8), [C], { name: 'splitC' });
    const sums = ps.map((p, i) => b.add(SUM4, [p, gs[i], Cs[i]], { name: `sum${i}` })[0]);
    b.out('sum', b.add(CONCAT([4, 4, 4, 4, 4, 4, 4, 4]), sums, { name: 'concat' })[0]);
    b.out('cout', cout);
  },
  doc: 'A faster adder: 4-bit groups compute propagate/generate in parallel, a lookahead unit computes all group carries at once, then each group finishes its sum. The critical path no longer grows with every bit.',
  level: '4-bit groups',
};

function SLICE4(i: number): Def {
  return memo(`s4_${i}`, () => ({
    type: `Nibble${i}`, name: `bits [${4 * i + 3}:${4 * i}]`, wiring: true, shape: 'wire',
    inputs: [{ name: 'in', width: 32, quiet: true }], outputs: [{ name: 'out', width: 4, quiet: true }],
    behave: ([v]) => [(v >>> (4 * i)) & 15], size: [24, 14],
  }));
}

/** Which adder the datapath uses (the "CLA" toggle in the visualiser). */
export const ADDER_CHOICE = { cla: false };
export function ADDER32(): Def { return ADDER_CHOICE.cla ? CLA_ADDER32 : RIPPLE_ADDER(32); }

// ------------------------------------------------------------------ bitwise & misc
export const BITWISE = (op: 'and' | 'or' | 'xor', w: number) => memo(`bw_${op}_${w}`, () => ({
  type: `${op.toUpperCase()}x${w}`, name: `${w} × ${op.toUpperCase()}`,
  inputs: [{ name: 'a', width: w }, { name: 'b', width: w }],
  outputs: [{ name: 'y', width: w }],
  behave: ([a, b]) => [(op === 'and' ? a & b : op === 'or' ? a | b : a ^ b) >>> 0],
  build(b) {
    const as = b.add(SPLIT(w), [b.in('a')], { name: 'splitA' });
    const bs = b.add(SPLIT(w), [b.in('b')], { name: 'splitB' });
    const G = op === 'and' ? AND() : op === 'or' ? OR() : XOR();
    const ys = as.map((_, i) => b.add(G, [as[i], bs[i]], { name: `${op}${i}` })[0]);
    b.out('y', b.add(JOIN(w), ys, { name: 'join' })[0]);
  },
  doc: `${w} independent ${op.toUpperCase()} gates, one per bit.`,
  level: 'gates',
}));

/** Conditionally invert a bus: y = a ⊕ (s replicated). */
export const COND_INVERT = (w: number) => memo('cinv' + w, () => ({
  type: `CondInvert${w}`, name: `Conditional inverter (${w} bits)`,
  inputs: [{ name: 'a', width: w }, { name: 's', width: 1, side: 'b' as const, kind: 'ctrl' as const }],
  outputs: [{ name: 'y', width: w }],
  behave: ([a, s]) => [(s ? ~a & mask(w) : a) >>> 0],
  build(b) {
    const fan = b.add(FANOUT(w), [b.in('s')], { name: 'fan' })[0];
    b.out('y', b.add(BITWISE('xor', w), [b.in('a'), fan], { name: 'xors' })[0]);
  },
  doc: 'XOR with a control bit: passes the value through when s = 0 and inverts every bit when s = 1.',
  level: 'bitwise',
}));

/** 1 if all bits are zero: an OR tree followed by an inverter. */
export const ZERO_DETECT = (w: number) => memo('zd' + w, () => ({
  type: `ZeroDetect${w}`, name: `Zero detector (${w} bits)`,
  inputs: [{ name: 'a', width: w }],
  outputs: [{ name: 'z', width: 1, kind: 'ctrl' as const }],
  behave: ([a]) => [a === 0 ? 1 : 0],
  build(b) {
    let level = b.add(SPLIT(w), [b.in('a')], { name: 'split' });
    let k = 0;
    while (level.length > 4) {
      const next = [];
      for (let i = 0; i < level.length; i += 4) next.push(b.add(OR(Math.min(4, level.length - i)), level.slice(i, i + 4), { name: `or${k}_${i / 4}` })[0]);
      level = next;
      k++;
    }
    b.out('z', b.add(NOR(level.length), level, { name: 'nor' })[0]);
  },
  doc: 'A tree of OR gates collects "is any bit 1?", and a final NOR turns it into "all bits are 0".',
  level: 'gates',
}));
