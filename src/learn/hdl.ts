/**
 * A tiny hardware description language for the circuit sandbox:
 *
 *   in a, b, cin
 *   out s, cout
 *   s1, c1 = ha(a, b)      # library modules return several outputs
 *   s, c2  = ha(s1, cin)
 *   cout   = or(c1, c2)
 *
 * Signals are single bits. Gates: and, or, xor, nand, nor, xnor (two or
 * more inputs), not, and the modules ha (half adder), fa (full adder) and
 * mux (d0, d1, s). The result is a real netlist Def, drawn and simulated by
 * the same machinery as the CPU.
 */
import type { Def, Net } from '../hw/netlist.ts';
import { AND, OR, XOR, NAND, NOR, XNOR, NOT, CONST } from '../hw/lib/gates.ts';
import { HALF_ADDER, FULL_ADDER, MUX2 } from '../hw/lib/blocks.ts';

export interface HdlError { line: number; message: string }

interface Stmt { line: number; lhs: string[]; fn: string; args: string[] }

export interface HdlModule { inputs: string[]; outputs: string[]; stmts: Stmt[] }

const GATES: Record<string, (n: number) => Def> = { and: AND, or: OR, xor: XOR, nand: NAND, nor: NOR, xnor: XNOR };
const MODULES: Record<string, { def: Def; ins: number; outs: number }> = {
  not: { def: NOT, ins: 1, outs: 1 },
  ha: { def: HALF_ADDER, ins: 2, outs: 2 },
  fa: { def: FULL_ADDER, ins: 3, outs: 2 },
  mux: { def: MUX2, ins: 3, outs: 1 },
};
export const HDL_FUNCTIONS = [...Object.keys(GATES), ...Object.keys(MODULES)];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseHdl(src: string): { mod: HdlModule | null; errors: HdlError[] } {
  const errors: HdlError[] = [];
  const mod: HdlModule = { inputs: [], outputs: [], stmts: [] };
  const defined = new Set<string>();
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  src.split('\n').forEach((raw, line) => {
    const text = raw.replace(/#.*$/, '').trim();
    if (!text) return;
    const err = (message: string) => errors.push({ line, message });
    let m = /^(in|out)\s+(.+)$/.exec(text);
    if (m) {
      for (const n of list(m[2])) {
        if (!IDENT.test(n)) { err(`“${n}” is not a valid name`); continue; }
        if (mod.inputs.includes(n) || mod.outputs.includes(n)) { err(`“${n}” is declared twice`); continue; }
        (m[1] === 'in' ? mod.inputs : mod.outputs).push(n);
        if (m[1] === 'in') defined.add(n);
      }
      return;
    }
    m = /^(.+?)=\s*([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(text);
    if (!m) {
      const c = /^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*|[01])\s*$/.exec(text);
      if (c) { m = [text, c[1], 'buf', c[2]] as unknown as RegExpExecArray; }
      else { err('expected “name = gate(inputs)”, “in …” or “out …”'); return; }
    }
    const lhs = list(m[1]);
    const fn = m[2].toLowerCase();
    const args = list(m[3]);
    for (const n of lhs) {
      if (!IDENT.test(n)) { err(`“${n}” is not a valid name`); return; }
      if (mod.inputs.includes(n)) { err(`“${n}” is an input; it cannot be assigned`); return; }
      if (defined.has(n)) { err(`“${n}” is already defined`); return; }
    }
    for (const a of args) {
      if (a === '0' || a === '1') continue;
      if (!IDENT.test(a)) { err(`“${a}” is not a valid signal`); return; }
      if (!defined.has(a)) { err(mod.outputs.includes(a) || mod.stmts.some(s => s.lhs.includes(a)) ? `“${a}” is used before it is defined` : `unknown signal “${a}”`); return; }
    }
    if (fn === 'buf') {
      if (lhs.length !== 1) { err('assign one signal at a time'); return; }
    } else if (GATES[fn]) {
      if (lhs.length !== 1) { err(`${fn} has one output`); return; }
      if (args.length < 2) { err(`${fn} needs at least two inputs`); return; }
    } else if (MODULES[fn]) {
      const md = MODULES[fn];
      if (args.length !== md.ins) { err(`${fn} takes ${md.ins} input${md.ins > 1 ? 's' : ''}`); return; }
      if (lhs.length !== md.outs) { err(`${fn} has ${md.outs} output${md.outs > 1 ? 's' : ''}${fn === 'ha' || fn === 'fa' ? ' (sum, carry)' : ''}`); return; }
    } else {
      err(`unknown gate “${fn}”. Available: ${HDL_FUNCTIONS.join(', ')}`);
      return;
    }
    lhs.forEach(n => defined.add(n));
    mod.stmts.push({ line, lhs, fn, args });
  });
  if (!mod.inputs.length && !errors.length) errors.push({ line: 0, message: 'declare the inputs, e.g. “in a, b”' });
  if (!mod.outputs.length && !errors.length) errors.push({ line: 0, message: 'declare the outputs, e.g. “out y”' });
  for (const o of mod.outputs) if (!defined.has(o) && !errors.length) errors.push({ line: src.split('\n').length - 1, message: `output “${o}” is never assigned` });
  return { mod: errors.length ? null : mod, errors };
}

/** Evaluate the module directly (used as the Def's behaviour and for checks). */
export function evalHdl(mod: HdlModule, ins: number[]): number[] {
  const env = new Map<string, number>();
  mod.inputs.forEach((n, i) => env.set(n, ins[i] & 1));
  const val = (a: string) => (a === '0' ? 0 : a === '1' ? 1 : env.get(a) ?? 0);
  for (const s of mod.stmts) {
    const xs = s.args.map(val);
    let out: number[];
    if (s.fn === 'buf') out = [xs[0]];
    else if (GATES[s.fn]) out = GATES[s.fn](xs.length).behave(xs, null!);
    else out = MODULES[s.fn].def.behave(xs, null!);
    s.lhs.forEach((n, i) => env.set(n, out[i] & 1));
  }
  return mod.outputs.map(val);
}

let serial = 0;
/** Build a netlist Def for the module. */
export function hdlDef(mod: HdlModule, name = 'Your circuit'): Def {
  return {
    type: `Hdl${serial++}`, name,
    inputs: mod.inputs.map(n => ({ name: n, width: 1, kind: 'ctrl' as const })),
    outputs: mod.outputs.map(n => ({ name: n, width: 1, kind: 'ctrl' as const })),
    behave: ins => evalHdl(mod, ins),
    build(b) {
      const env = new Map<string, Net>();
      mod.inputs.forEach(n => env.set(n, b.in(n)));
      let k = 0;
      const konst = (v: number) => b.add(CONST(1, v), [], { name: `k${k++}` })[0];
      const net = (a: string) => (a === '0' ? konst(0) : a === '1' ? konst(1) : env.get(a)!);
      mod.stmts.forEach((s, i) => {
        const args = s.args.map(net);
        if (s.fn === 'buf') { env.set(s.lhs[0], args[0]); return; }
        const def = GATES[s.fn] ? GATES[s.fn](args.length) : MODULES[s.fn].def;
        const outs = b.add(def, args, { name: `${s.fn}${i}`, netNames: s.lhs });
        s.lhs.forEach((n, j) => env.set(n, outs[j]));
      });
      mod.outputs.forEach(n => b.out(n, env.get(n)!));
    },
    doc: 'Built from your description.',
  };
}

/** Compare against a target function on every input combination. */
export function checkAgainst(mod: HdlModule, target: (ins: number[]) => number[], outNames: string[]): { ok: boolean; counter?: { ins: number[]; want: number[]; got: number[] } } {
  const n = mod.inputs.length;
  for (let k = 0; k < 1 << n; k++) {
    const ins = mod.inputs.map((_, i) => (k >> (n - 1 - i)) & 1);
    const want = target(ins), got = evalHdl(mod, ins);
    if (outNames.some((_, i) => want[i] !== got[i])) return { ok: false, counter: { ins, want, got } };
  }
  return { ok: true };
}

/** Count gates by type (modules count as themselves). */
export function gateCount(mod: HdlModule): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of mod.stmts) if (s.fn !== 'buf') c[s.fn] = (c[s.fn] ?? 0) + 1;
  return c;
}
