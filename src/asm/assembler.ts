/**
 * Two-pass RISC-V assembler (GNU as syntax).
 *
 *   parse → layout (iterated until label addresses are stable, because the
 *   size of `li` can depend on symbol values) → emit (evaluate expressions,
 *   range-check, encode) → image + symbols + source map + listing.
 */
import { BY_MNEMONIC, INSTRUCTIONS } from '../isa/spec/index.ts';
import type { InsnSpec } from '../isa/spec/index.ts';
import { CSR_BY_NAME } from '../isa/csr.ts';
import { encodeImm, immRange } from '../isa/formats.ts';
import { DATA_BASE, TEXT_BASE } from '../sim/memmap.ts';
import type { ProgramImage } from '../sim/machine.ts';
import { AsmError } from './diagnostics.ts';
import type { Diagnostic, Range } from './diagnostics.ts';
import { evalExpr, hasReloc, refersToLabel, Unresolved } from './expr.ts';
import type { EvalCtx, Expr } from './expr.ts';
import { parse } from './parser.ts';
import type { Operand, Statement } from './parser.ts';
import { PSEUDO_NAMES } from './pseudo.ts';
import { disassemble } from './disasm.ts';

export type SectionName = 'text' | 'data' | 'rodata' | 'bss';
const SECTION_ORDER: SectionName[] = ['text', 'data', 'rodata', 'bss'];

type ImmSpec =
  | { k: 'expr'; e: Expr }
  | { k: 'target'; e: Expr }
  | { k: 'pcrelHi'; e: Expr }
  | { k: 'pcrelLo'; e: Expr }
  | { k: 'const'; v: number };

interface MInsn {
  spec: InsnSpec;
  rd: number;
  rs1: number;
  rs2: number;
  imm?: ImmSpec;
  csr?: number;
  range: Range;
}

type Item =
  | { k: 'insn'; stmt: Statement; idx: number; sec: SectionName; off: number; list: MInsn[] }
  | { k: 'data'; stmt: Statement; idx: number; sec: SectionName; off: number; width: 1 | 2 | 4 | 8; exprs: Expr[] }
  | { k: 'bytes'; stmt: Statement; idx: number; sec: SectionName; off: number; bytes: Uint8Array }
  | { k: 'fill'; stmt: Statement; idx: number; sec: SectionName; off: number; n: number; fill: number; nops: boolean };

export interface SymbolInfo {
  name: string;
  value: number;
  kind: 'label' | 'equ';
  line: number;
  section?: SectionName;
}

export interface ListingEntry {
  line: number;
  addr: number;
  words: number[];
  /** Disassembly of each emitted word (for instructions). */
  asm: string[];
  isData: boolean;
  size: number;
}

export interface AsmResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  image: ProgramImage;
  symbols: Map<string, SymbolInfo>;
  /** Address → 0-based source line. */
  addrToLine: Map<number, number>;
  /** 0-based source line → addresses of instructions emitted for it. */
  lineToAddrs: Map<number, number[]>;
  listing: ListingEntry[];
  sections: { name: SectionName; base: number; size: number }[];
  entry: number;
  textEnd: number;
}

const WIDTHS: Record<string, 1 | 2 | 4 | 8> = {
  '.byte': 1, '.half': 2, '.short': 2, '.2byte': 2, '.word': 4, '.long': 4, '.4byte': 4, '.dword': 8, '.8byte': 8, '.quad': 8,
};

const IGNORED = new Set([
  '.globl', '.global', '.local', '.type', '.size', '.option', '.file', '.ident', '.attribute',
  '.extern', '.weak', '.cfi_startproc', '.cfi_endproc', '.p2alignl', '.end', '.hidden', '.func', '.endfunc',
]);

const ALL_MNEMONICS = [...INSTRUCTIONS.map(i => i.mnemonic), ...PSEUDO_NAMES];

function suggest(name: string): string {
  let best = '', bestD = 3;
  for (const m of ALL_MNEMONICS) {
    const d = lev(name, m);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best ? ` — did you mean '${best}'?` : '';
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function sectionFor(name: string): SectionName | null {
  if (name.startsWith('.text')) return 'text';
  if (name.startsWith('.rodata') || name.startsWith('.srodata')) return 'rodata';
  if (name.startsWith('.bss') || name.startsWith('.sbss')) return 'bss';
  if (name.startsWith('.data') || name.startsWith('.sdata')) return 'data';
  return null;
}

// ---------------------------------------------------------------- operands
function err(msg: string, r: Range): never { throw new AsmError(msg, r); }

function wantReg(o: Operand | undefined, what: string, st: Statement): number {
  if (!o) err(`Missing operand: expected ${what}`, st.range);
  if (o.k !== 'reg') err(`Expected a register for ${what}, found '${describe(o)}'`, o.range);
  return o.r;
}

function wantExpr(o: Operand | undefined, what: string, st: Statement): Expr {
  if (!o) err(`Missing operand: expected ${what}`, st.range);
  if (o.k === 'expr') return o.e;
  if (o.k === 'reg') err(`Expected ${what}, found register '${o.name}'`, o.range);
  err(`Expected ${what}`, o.range);
}

function describe(o: Operand): string {
  switch (o.k) {
    case 'reg': return o.name;
    case 'str': return JSON.stringify(o.value);
    case 'mem': return 'memory operand';
    case 'expr': return 'expression';
  }
}

function count(st: Statement, n: number | number[]) {
  const ok = Array.isArray(n) ? n.includes(st.operands.length) : st.operands.length === n;
  if (!ok) {
    const want = Array.isArray(n) ? n.join(' or ') : String(n);
    err(`'${st.op}' takes ${want} operand${want === '1' ? '' : 's'}, got ${st.operands.length}`, st.range);
  }
}

function spec(m: string): InsnSpec { return BY_MNEMONIC.get(m)!; }

function mk(m: string, st: Statement, f: Partial<MInsn>): MInsn {
  return { spec: spec(m), rd: 0, rs1: 0, rs2: 0, range: st.range, ...f };
}

function csrOperand(o: Operand | undefined, st: Statement): number {
  if (!o) err('Missing CSR operand', st.range);
  if (o.k === 'expr' && o.e.k === 'sym') {
    const c = CSR_BY_NAME.get(o.e.name.toLowerCase());
    if (c) return c.addr;
  }
  if (o.k === 'expr' && o.e.k === 'num') return o.e.v & 0xfff;
  err(`Unknown CSR '${o.k === 'expr' && o.e.k === 'sym' ? o.e.name : describe(o)}'`, o.range);
}

/** Expand a statement into machine instructions. `tryEval` returns undefined if unresolved. */
function expand(st: Statement, tryEval: (e: Expr) => number | undefined): MInsn[] {
  const o = st.operands;
  const m = st.op;
  const R = (i: number, what: string) => wantReg(o[i], what, st);
  const E = (i: number, what: string) => wantExpr(o[i], what, st);

  switch (m) {
    case 'nop': count(st, 0); return [mk('addi', st, { imm: { k: 'const', v: 0 } })];
    case 'li': {
      count(st, 2);
      const rd = R(0, 'rd'), e = E(1, 'an immediate');
      const v = tryEval(e);
      if (v === undefined) {
        return [mk('lui', st, { rd, imm: { k: 'expr', e: { k: 'reloc', fn: 'hi', a: e, r: e.r } } }),
          mk('addi', st, { rd, rs1: rd, imm: { k: 'expr', e: { k: 'reloc', fn: 'lo', a: e, r: e.r } } })];
      }
      if (v >= -2048 && v <= 2047) return [mk('addi', st, { rd, imm: { k: 'const', v } })];
      const hi = ((v + 0x800) >>> 12) & 0xfffff, lo = (v << 20) >> 20;
      const out = [mk('lui', st, { rd, imm: { k: 'const', v: hi << 12 } })];
      if (lo) out.push(mk('addi', st, { rd, rs1: rd, imm: { k: 'const', v: lo } }));
      return out;
    }
    case 'la': case 'lla': {
      count(st, 2);
      const rd = R(0, 'rd'), e = E(1, 'a symbol');
      return [mk('auipc', st, { rd, imm: { k: 'pcrelHi', e } }), mk('addi', st, { rd, rs1: rd, imm: { k: 'pcrelLo', e } })];
    }
    case 'mv': count(st, 2); return [mk('addi', st, { rd: R(0, 'rd'), rs1: R(1, 'rs'), imm: { k: 'const', v: 0 } })];
    case 'not': count(st, 2); return [mk('xori', st, { rd: R(0, 'rd'), rs1: R(1, 'rs'), imm: { k: 'const', v: -1 } })];
    case 'neg': count(st, 2); return [mk('sub', st, { rd: R(0, 'rd'), rs2: R(1, 'rs') })];
    case 'seqz': count(st, 2); return [mk('sltiu', st, { rd: R(0, 'rd'), rs1: R(1, 'rs'), imm: { k: 'const', v: 1 } })];
    case 'snez': count(st, 2); return [mk('sltu', st, { rd: R(0, 'rd'), rs2: R(1, 'rs') })];
    case 'sltz': count(st, 2); return [mk('slt', st, { rd: R(0, 'rd'), rs1: R(1, 'rs') })];
    case 'sgtz': count(st, 2); return [mk('slt', st, { rd: R(0, 'rd'), rs2: R(1, 'rs') })];
    case 'zext.b': count(st, 2); return [mk('andi', st, { rd: R(0, 'rd'), rs1: R(1, 'rs'), imm: { k: 'const', v: 255 } })];
    case 'beqz': case 'bnez': case 'bltz': case 'bgez': {
      count(st, 2);
      const base = { beqz: 'beq', bnez: 'bne', bltz: 'blt', bgez: 'bge' }[m];
      return [mk(base, st, { rs1: R(0, 'rs'), imm: { k: 'target', e: E(1, 'a branch target') } })];
    }
    case 'blez': case 'bgtz': {
      count(st, 2);
      return [mk(m === 'blez' ? 'bge' : 'blt', st, { rs2: R(0, 'rs'), imm: { k: 'target', e: E(1, 'a branch target') } })];
    }
    case 'bgt': case 'ble': case 'bgtu': case 'bleu': {
      count(st, 3);
      const base = { bgt: 'blt', ble: 'bge', bgtu: 'bltu', bleu: 'bgeu' }[m];
      return [mk(base, st, { rs1: R(1, 'rt'), rs2: R(0, 'rs'), imm: { k: 'target', e: E(2, 'a branch target') } })];
    }
    case 'j': count(st, 1); return [mk('jal', st, { imm: { k: 'target', e: E(0, 'a jump target') } })];
    case 'call': count(st, 1); return [mk('jal', st, { rd: 1, imm: { k: 'target', e: E(0, 'a function') } })];
    case 'tail': count(st, 1); return [mk('jal', st, { imm: { k: 'target', e: E(0, 'a function') } })];
    case 'jr': count(st, 1); return [mk('jalr', st, { rs1: R(0, 'rs'), imm: { k: 'const', v: 0 } })];
    case 'ret': count(st, 0); return [mk('jalr', st, { rs1: 1, imm: { k: 'const', v: 0 } })];
    case 'csrr': count(st, 2); return [mk('csrrs', st, { rd: R(0, 'rd'), csr: csrOperand(o[1], st) })];
    case 'csrw': case 'csrs': case 'csrc': {
      count(st, 2);
      const base = { csrw: 'csrrw', csrs: 'csrrs', csrc: 'csrrc' }[m];
      return [mk(base, st, { csr: csrOperand(o[0], st), rs1: R(1, 'rs') })];
    }
    case 'csrwi': case 'csrsi': case 'csrci': {
      count(st, 2);
      const base = { csrwi: 'csrrwi', csrsi: 'csrrsi', csrci: 'csrrci' }[m];
      return [mk(base, st, { csr: csrOperand(o[0], st), imm: { k: 'expr', e: E(1, 'a 5-bit immediate') } })];
    }
    case 'rdcycle': case 'rdcycleh': case 'rdinstret': case 'rdinstreth': case 'rdtime': case 'rdtimeh': {
      count(st, 1);
      return [mk('csrrs', st, { rd: R(0, 'rd'), csr: CSR_BY_NAME.get(m.slice(2))!.addr })];
    }
  }

  const s = BY_MNEMONIC.get(m);
  if (!s) err(`Unknown instruction '${m}'${suggest(m)}`, st.opRange);

  // flexible forms of real instructions
  if (m === 'jal' && o.length === 1) return [mk('jal', st, { rd: 1, imm: { k: 'target', e: E(0, 'a jump target') } })];
  if (m === 'jalr') {
    if (o.length === 1 && o[0].k === 'reg') return [mk('jalr', st, { rd: 1, rs1: o[0].r, imm: { k: 'const', v: 0 } })];
    if (o.length === 1 && o[0].k === 'mem') return [mk('jalr', st, { rd: 1, rs1: o[0].base, imm: memOff(o[0]) })];
    if (o.length === 2 && o[1].k === 'reg') return [mk('jalr', st, { rd: R(0, 'rd'), rs1: o[1].r, imm: { k: 'const', v: 0 } })];
    if (o.length === 3) return [mk('jalr', st, { rd: R(0, 'rd'), rs1: R(1, 'rs1'), imm: { k: 'expr', e: E(2, 'an offset') } })];
  }
  if (s.format === 'R' && s.ext === 'RV32I' && o.length === 3 && o[2].k === 'expr') {
    const immForm = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori', sll: 'slli', srl: 'srli', sra: 'srai', slt: 'slti', sltu: 'sltiu' }[m];
    if (immForm) return [mk(immForm, st, { rd: R(0, 'rd'), rs1: R(1, 'rs1'), imm: { k: 'expr', e: o[2].e } })];
    if (m === 'sub') err(`'sub' has no immediate form — use addi with a negated immediate`, o[2].range);
  }
  if (s.category === 'load' && o.length === 2 && o[1].k === 'expr') {
    const rd = R(0, 'rd'), e = o[1].e;
    return [mk('auipc', st, { rd, imm: { k: 'pcrelHi', e } }), mk(m, st, { rd, rs1: rd, imm: { k: 'pcrelLo', e } })];
  }
  if (s.category === 'store' && o.length === 3 && o[1].k === 'expr') {
    const rs2 = R(0, 'rs2'), e = o[1].e, tmp = R(2, 'a temporary register');
    return [mk('auipc', st, { rd: tmp, imm: { k: 'pcrelHi', e } }), mk(m, st, { rs1: tmp, rs2, imm: { k: 'pcrelLo', e } })];
  }
  if (m === 'fence' && o.length === 0) return [mk('fence', st, { imm: { k: 'const', v: 0xff } })];
  if (m === 'fence') {
    count(st, [0, 2]);
    const bits = (op: Operand) => {
      if (op.k === 'expr' && op.e.k === 'num' && op.e.v === 0) return 0;
      if (op.k !== 'expr' || op.e.k !== 'sym' || !/^[iorw]+$/.test(op.e.name)) err(`Expected fence set like 'rw' or 'iorw'`, op.range);
      const n = op.e.name;
      return (n.includes('i') ? 8 : 0) | (n.includes('o') ? 4 : 0) | (n.includes('r') ? 2 : 0) | (n.includes('w') ? 1 : 0);
    };
    return [mk('fence', st, { imm: { k: 'const', v: (bits(o[0]) << 4) | bits(o[1]) } })];
  }

  // canonical operand list
  if (o.length !== s.operands.length) {
    err(`'${m}' expects ${s.operands.length} operand${s.operands.length === 1 ? '' : 's'} (${syntaxOf(s)}), got ${o.length}`, st.range);
  }
  const r: MInsn = mk(m, st, {});
  s.operands.forEach((kind, i) => {
    const op = o[i];
    switch (kind) {
      case 'rd': r.rd = R(i, 'rd'); break;
      case 'rs1': r.rs1 = R(i, 'rs1'); break;
      case 'rs2': r.rs2 = R(i, 'rs2'); break;
      case 'imm12': case 'shamt': case 'uimm20': case 'zimm': r.imm = { k: 'expr', e: E(i, 'an immediate') }; break;
      case 'branch': case 'jump': r.imm = { k: 'target', e: E(i, 'a target label') }; break;
      case 'csr': r.csr = csrOperand(op, st); break;
      case 'fence': break;
      case 'mem':
        if (op.k !== 'mem') {
          if (op.k === 'reg') err(`Expected a memory operand like 0(${op.name})`, op.range);
          err(`Expected a memory operand like 8(sp)`, op.range);
        }
        r.rs1 = op.base;
        r.imm = memOff(op);
        break;
    }
  });
  return [r];
}

function memOff(op: Extract<Operand, { k: 'mem' }>): ImmSpec {
  return op.off ? { k: 'expr', e: op.off } : { k: 'const', v: 0 };
}

export function syntaxOf(s: InsnSpec): string {
  return s.operands.map(k => ({
    rd: 'rd', rs1: 'rs1', rs2: 'rs2', imm12: 'imm', shamt: 'shamt', mem: 'offset(rs1)', branch: 'label',
    jump: 'label', uimm20: 'imm20', csr: 'csr', zimm: 'uimm5', fence: 'pred, succ',
  })[k]).join(', ');
}

// ---------------------------------------------------------------- assembler
interface Layout {
  items: Item[];
  labels: Map<string, { sec: SectionName; off: number; line: number }>;
  numeric: { n: number; idx: number; sec: SectionName; off: number }[];
  equs: Map<string, { e: Expr; line: number }>;
  sizes: Record<SectionName, number>;
}

function bases(sizes: Record<SectionName, number>): Record<SectionName, number> {
  const align = (x: number) => (x + 15) & ~15;
  const text = TEXT_BASE, data = DATA_BASE;
  const rodata = align(data + sizes.data);
  const bss = align(rodata + sizes.rodata);
  return { text, data, rodata, bss };
}

export function assemble(src: string): AsmResult {
  const parsed = parse(src);
  const diagnostics: Diagnostic[] = [...parsed.diagnostics];
  const stmts = parsed.statements;

  // equ table of the layout in progress (read by the layout callbacks)
  let layEqus = new Map<string, { e: Expr; line: number }>();
  let prev: Map<string, number> | null = null;
  let prevNumeric: { n: number; idx: number; addr: number }[] = [];
  let lay!: Layout;
  let addrs!: Map<string, number>;
  let secBase!: Record<SectionName, number>;

  const makeCtx = (labelAddr: (name: string) => number | undefined, numeric: { n: number; idx: number; addr: number }[],
    equs: Map<string, { e: Expr; line: number }>, idx: number, dot: number, pc: number,
    pcrelLo: EvalCtx['pcrelLo']): EvalCtx => {
    const visiting = new Set<string>();
    const ctx: EvalCtx = {
      dot, pc, pcrelLo,
      sym(name, r) {
        const l = labelAddr(name);
        if (l !== undefined) return l;
        const eq = equs.get(name);
        if (eq) {
          if (visiting.has(name)) throw new AsmError(`Circular definition of '${name}'`, r);
          visiting.add(name);
          try { return evalExpr(eq.e, ctx); } finally { visiting.delete(name); }
        }
        return undefined;
      },
      local(n, dir) {
        if (dir === 'b') {
          for (let i = numeric.length - 1; i >= 0; i--) if (numeric[i].n === n && numeric[i].idx <= idx) return numeric[i].addr;
        } else {
          for (const d of numeric) if (d.n === n && d.idx > idx) return d.addr;
        }
        return undefined;
      },
    };
    return ctx;
  };

  for (let iter = 0; iter < 10; iter++) {
    lay = doLayout(stmts, (e, idx, sec, off) => {
      if (!prev) {
        // first pass: only equ constants are known
        try {
          const ctx = makeCtx(() => undefined, [], layEqus, idx, 0, 0, () => 0);
          return evalExpr(e, ctx);
        } catch { return undefined; }
      }
      try {
        const dot = (secBase[sec] + off) >>> 0;
        const ctx = makeCtx(n => prev!.get(n), prevNumeric, layEqus, idx, dot, dot, () => 0);
        return evalExpr(e, ctx);
      } catch { return undefined; }
    }, null);
    secBase = bases(lay.sizes);
    addrs = new Map();
    for (const [n, l] of lay.labels) addrs.set(n, (secBase[l.sec] + l.off) >>> 0);
    const numeric = lay.numeric.map(d => ({ n: d.n, idx: d.idx, addr: (secBase[d.sec] + d.off) >>> 0 }));
    const stable = prev !== null && addrs.size === prev.size && [...addrs].every(([k, v]) => prev!.get(k) === v) &&
      numeric.length === prevNumeric.length && numeric.every((d, i) => d.addr === prevNumeric[i].addr);
    prev = addrs;
    prevNumeric = numeric;
    if (stable) break;
  }
  // Re-run layout once more collecting diagnostics (with final symbol guesses).
  lay = doLayout(stmts, (e, idx, sec, off) => {
    try {
      const dot = (secBase[sec] + off) >>> 0;
      return evalExpr(e, makeCtx(n => addrs.get(n), prevNumeric, layEqus, idx, dot, dot, () => 0));
    } catch { return undefined; }
  }, diagnostics);

  // ---------------------------------------------------------- emit
  secBase = bases(lay.sizes);
  const buffers: Record<SectionName, Uint8Array> = {
    text: new Uint8Array(lay.sizes.text), data: new Uint8Array(lay.sizes.data),
    rodata: new Uint8Array(lay.sizes.rodata), bss: new Uint8Array(lay.sizes.bss),
  };
  const symbols = new Map<string, SymbolInfo>();
  for (const [name, l] of lay.labels) symbols.set(name, { name, value: (secBase[l.sec] + l.off) >>> 0, kind: 'label', line: l.line, section: l.sec });
  const labelAddr = (n: string) => symbols.get(n)?.value;
  const numeric = lay.numeric.map(d => ({ n: d.n, idx: d.idx, addr: (secBase[d.sec] + d.off) >>> 0 }));
  for (const [name, q] of lay.equs) {
    try {
      const v = evalExpr(q.e, makeCtx(labelAddr, numeric, lay.equs, Infinity, 0, 0, () => 0));
      symbols.set(name, { name, value: v, kind: 'equ', line: q.line });
    } catch (e) {
      if (e instanceof Unresolved) diagnostics.push({ line: q.line, from: q.e.r.from, to: q.e.r.to, severity: 'error', message: `Undefined symbol '${e.message}' in .equ ${name}` });
      else if (e instanceof AsmError) diagnostics.push({ ...e.range, severity: 'error', message: e.message });
    }
  }
  const isLabel = (n: string) => lay.labels.has(n);
  const pcrelHiAt = new Map<number, number>();
  const addrToLine = new Map<number, number>();
  const lineToAddrs = new Map<number, number[]>();
  const listing: ListingEntry[] = [];

  const put = (sec: SectionName, off: number, n: number, v: number) => {
    const b = buffers[sec];
    for (let i = 0; i < n; i++) b[off + i] = n === 8 && i >= 4 ? (v < 0 ? 0xff : 0) : (v >>> (8 * i)) & 0xff;
  };

  for (const it of lay.items) {
    const base = (secBase[it.sec] + it.off) >>> 0;
    const report = (e: unknown) => {
      if (e instanceof AsmError) diagnostics.push({ ...e.range, severity: 'error', message: e.message });
      else if (e instanceof Unresolved) diagnostics.push({ ...rangeOfSym(it.stmt, e.message), severity: 'error', message: `Undefined symbol '${e.message}'` });
      else throw e;
    };
    if (it.k === 'insn') {
      const words: number[] = [];
      const asm: string[] = [];
      it.list.forEach((mi, j) => {
        const pc = (base + 4 * j) >>> 0;
        let word = 0;
        try {
          const ctx = makeCtx(labelAddr, numeric, lay.equs, it.idx, base, pc, (addr, r) => {
            const d = pcrelHiAt.get(addr);
            if (d === undefined) throw new AsmError(`%pcrel_lo must name the label of an auipc with %pcrel_hi`, r);
            return (d << 20) >> 20;
          });
          word = encodeM(mi, pc, ctx, isLabel, pcrelHiAt);
        } catch (e) { report(e); }
        put(it.sec, it.off + 4 * j, 4, word);
        words.push(word);
        asm.push(disassemble(word, pc).text);
        addrToLine.set(pc, it.stmt.line);
      });
      if (words.length) {
        lineToAddrs.set(it.stmt.line, [...(lineToAddrs.get(it.stmt.line) ?? []), ...words.map((_, j) => (base + 4 * j) >>> 0)]);
        listing.push({ line: it.stmt.line, addr: base, words, asm, isData: false, size: 4 * words.length });
      }
    } else if (it.k === 'data') {
      const words: number[] = [];
      it.exprs.forEach((e, j) => {
        let v = 0;
        try {
          v = evalExpr(e, makeCtx(labelAddr, numeric, lay.equs, it.idx, base + j * it.width, base, () => 0));
          if (it.width === 1 && (v < -128 || v > 255)) diagnostics.push({ ...e.r, severity: 'warning', message: `Value ${v} truncated to 8 bits` });
          if (it.width === 2 && (v < -32768 || v > 65535)) diagnostics.push({ ...e.r, severity: 'warning', message: `Value ${v} truncated to 16 bits` });
        } catch (x) { report(x); }
        put(it.sec, it.off + j * it.width, it.width, v);
        words.push(v);
      });
      listing.push({ line: it.stmt.line, addr: base, words, asm: [], isData: true, size: it.width * it.exprs.length });
    } else if (it.k === 'bytes') {
      buffers[it.sec].set(it.bytes, it.off);
      listing.push({ line: it.stmt.line, addr: base, words: [...it.bytes], asm: [], isData: true, size: it.bytes.length });
    } else {
      if (it.nops) for (let j = 0; j + 4 <= it.n; j += 4) put(it.sec, it.off + j, 4, 0x13);
      else buffers[it.sec].fill(it.fill & 0xff, it.off, it.off + it.n);
    }
  }

  const entry = symbols.get('_start')?.value ?? symbols.get('main')?.value ?? TEXT_BASE;
  const segments = SECTION_ORDER.filter(s => lay.sizes[s] > 0).map(s => ({ name: '.' + s, base: secBase[s], bytes: buffers[s] }));
  diagnostics.sort((a, b) => a.line - b.line || a.from - b.from);
  return {
    ok: !diagnostics.some(d => d.severity === 'error'),
    diagnostics, image: { segments, entry }, symbols, addrToLine, lineToAddrs, listing,
    sections: SECTION_ORDER.map(s => ({ name: s, base: secBase[s], size: lay.sizes[s] })),
    entry, textEnd: secBase.text + lay.sizes.text,
  };

  function doLayout(stmts: Statement[], tryEval: (e: Expr, idx: number, sec: SectionName, off: number) => number | undefined, diags: Diagnostic[] | null): Layout {
    const L: Layout = {
      items: [], labels: new Map(), numeric: [], equs: new Map(),
      sizes: { text: 0, data: 0, rodata: 0, bss: 0 },
    };
    layEqus = L.equs;
    let sec: SectionName = 'text';
    const report = (e: unknown) => {
      if (!diags) return;
      if (e instanceof AsmError) diags.push({ ...e.range, severity: 'error', message: e.message });
      else throw e;
    };
    stmts.forEach((st, idx) => {
      for (const lab of st.labels) {
        if (lab.numeric) L.numeric.push({ n: parseInt(lab.name, 10), idx, sec, off: L.sizes[sec] });
        else if (L.labels.has(lab.name) || L.equs.has(lab.name)) {
          diags?.push({ ...lab.range, severity: 'error', message: `Label '${lab.name}' is already defined on line ${(L.labels.get(lab.name)?.line ?? 0) + 1}` });
        } else if (BY_MNEMONIC.has(lab.name) && diags) {
          L.labels.set(lab.name, { sec, off: L.sizes[sec], line: st.line });
          diags.push({ ...lab.range, severity: 'warning', message: `Label '${lab.name}' has the same name as an instruction` });
        } else L.labels.set(lab.name, { sec, off: L.sizes[sec], line: st.line });
      }
      if (!st.op) return;
      const off = L.sizes[sec];
      const ev = (e: Expr) => tryEval(e, idx, sec, off);
      try {
        if (st.isDirective) {
          const d = st.op;
          const newSec = d === '.section' ? null : sectionFor(d);
          if (newSec && ['.text', '.data', '.rodata', '.bss', '.sdata', '.sbss'].includes(d)) { sec = newSec; return; }
          if (d === '.section') {
            const o = st.operands[0];
            const name = o && o.k === 'expr' && o.e.k === 'sym' ? o.e.name : '';
            const s = sectionFor(name);
            if (!s) throw new AsmError(`Unknown section '${name}' (use .text, .data, .rodata or .bss)`, o?.range ?? st.opRange);
            sec = s;
            return;
          }
          if (d in WIDTHS) {
            const width = WIDTHS[d];
            if (sec === 'bss') throw new AsmError('Data in .bss must be zero: use .space', st.opRange);
            const exprs = st.operands.map(o => {
              if (o.k !== 'expr') throw new AsmError(`Expected a value for ${d}`, o.range);
              return o.e;
            });
            if (width > 1 && off % width && diags) diags.push({ ...st.opRange, severity: 'warning', message: `${d} at misaligned offset; add .align ${Math.log2(width)} before it` });
            L.items.push({ k: 'data', stmt: st, idx, sec, off, width, exprs });
            L.sizes[sec] += width * exprs.length;
            return;
          }
          if (d === '.ascii' || d === '.asciz' || d === '.string') {
            const chunks: number[] = [];
            for (const o of st.operands) {
              if (o.k !== 'str') throw new AsmError(`Expected a string for ${d}`, o.range);
              for (const ch of o.value) chunks.push(ch.charCodeAt(0) & 0xff);
              if (d !== '.ascii') chunks.push(0);
            }
            L.items.push({ k: 'bytes', stmt: st, idx, sec, off, bytes: Uint8Array.from(chunks) });
            L.sizes[sec] += chunks.length;
            return;
          }
          if (d === '.space' || d === '.zero' || d === '.skip') {
            const n = ev(wantExpr(st.operands[0], 'a size', st));
            if (n === undefined) throw new AsmError(`${d} size must be a constant`, st.operands[0].range);
            if (n < 0 || n > 1 << 24) throw new AsmError(`Invalid size ${n}`, st.operands[0].range);
            const fill = st.operands[1] ? ev(wantExpr(st.operands[1], 'a fill byte', st)) ?? 0 : 0;
            L.items.push({ k: 'fill', stmt: st, idx, sec, off, n, fill, nops: false });
            L.sizes[sec] += n;
            return;
          }
          if (d === '.align' || d === '.p2align' || d === '.balign') {
            const v = ev(wantExpr(st.operands[0], 'an alignment', st));
            if (v === undefined) throw new AsmError(`Alignment must be a constant`, st.operands[0].range);
            const a = d === '.balign' ? v : 1 << v;
            if (a <= 0 || (a & (a - 1)) || a > 4096) throw new AsmError(`Alignment must be a power of two ≤ 4096`, st.operands[0].range);
            const pad = (a - (off % a)) % a;
            if (pad) {
              L.items.push({ k: 'fill', stmt: st, idx, sec, off, n: pad, fill: 0, nops: sec === 'text' && pad % 4 === 0 });
              L.sizes[sec] += pad;
            }
            return;
          }
          if (d === '.equ' || d === '.set' || d === '.eqv') {
            count(st, 2);
            const o = st.operands[0];
            if (o.k !== 'expr' || o.e.k !== 'sym') throw new AsmError(`Expected a symbol name`, o.range);
            L.equs.set(o.e.name, { e: wantExpr(st.operands[1], 'a value', st), line: st.line });
            return;
          }
          if (IGNORED.has(d)) return;
          throw new AsmError(`Unknown directive '${d}'`, st.opRange);
        }
        const list = expand(st, ev);
        if (sec !== 'text' && diags) diags.push({ ...st.opRange, severity: 'warning', message: `Instruction outside .text` });
        if (off % 4 && diags) diags.push({ ...st.opRange, severity: 'error', message: `Instruction at misaligned offset; add .align 2` });
        L.items.push({ k: 'insn', stmt: st, idx, sec, off, list });
        L.sizes[sec] += 4 * list.length;
      } catch (e) { report(e); }
    });
    return L;
  }
}

function rangeOfSym(st: Statement, name: string): Range {
  for (const o of st.operands) {
    const found = findSym(o.k === 'expr' ? o.e : o.k === 'mem' ? o.off : null, name);
    if (found) return found;
  }
  return st.range;
}

function findSym(e: Expr | null, name: string): Range | null {
  if (!e) return null;
  switch (e.k) {
    case 'sym': return e.name === name ? e.r : null;
    case 'local': return `${e.n}${e.dir}` === name ? e.r : null;
    case 'un': case 'reloc': return findSym(e.a, name);
    case 'bin': return findSym(e.a, name) ?? findSym(e.b, name);
    default: return null;
  }
}

function encodeM(mi: MInsn, pc: number, ctx: EvalCtx, isLabel: (n: string) => boolean, pcrelHiAt: Map<number, number>): number {
  const s = mi.spec;
  let imm = 0;
  const rangeCheck = (v: number, r: Range) => {
    const [lo, hi] = immRange(s.format);
    if (v < lo || v > hi) {
      const hint = s.format === 'I' || s.format === 'S' ? (s.category === 'load' || s.category === 'store' ? '' : ' — use li to load large constants') : '';
      throw new AsmError(`Immediate ${v} is out of range for ${s.mnemonic} (${lo}…${hi})${hint}`, r);
    }
  };
  if (mi.imm) {
    const im = mi.imm;
    switch (im.k) {
      case 'const': imm = im.v; break;
      case 'expr': {
        let v = evalExpr(im.e, ctx);
        if (s.format === 'U') {
          // lui/auipc take the 20-bit field value; %hi() already yields it.
          if (v < -(1 << 19) || v > 0xfffff) throw new AsmError(`Upper immediate ${v} is out of range (0…0xfffff)`, im.e.r);
          v = (v & 0xfffff) << 12;
        } else if (s.format === 'CSRI') {
          if (v < 0 || v > 31) throw new AsmError(`CSR immediate must be 0…31, got ${v}`, im.e.r);
        } else if (!(hasReloc(im.e) && (s.format === 'I' || s.format === 'S'))) rangeCheck(v, im.e.r);
        imm = v;
        break;
      }
      case 'target': {
        const v = evalExpr(im.e, ctx);
        const off = refersToLabel(im.e, isLabel) ? (v - pc) | 0 : v;
        if (off & 1) throw new AsmError(`Branch/jump offset ${off} must be even`, im.e.r);
        rangeCheck(off, im.e.r);
        imm = off;
        break;
      }
      case 'pcrelHi': {
        const target = evalExpr(im.e, ctx);
        const delta = (target - pc) | 0;
        pcrelHiAt.set(pc, delta);
        imm = (((delta + 0x800) >>> 12) & 0xfffff) << 12;
        break;
      }
      case 'pcrelLo': {
        const target = evalExpr(im.e, ctx);
        const delta = (target - (pc - 4)) | 0;
        imm = (delta << 20) >> 20;
        break;
      }
    }
    if (mi.imm.k === 'expr' && mi.imm.e.k === 'reloc' && mi.imm.e.fn === 'pcrel_hi') {
      const target = evalExpr(mi.imm.e.a, ctx);
      pcrelHiAt.set(pc, (target - pc) | 0);
    }
  }
  let w = s.match;
  if (s.fixedWord !== undefined) return w;
  const ops = s.operands;
  if (ops.includes('rd') || s.format === 'CSR' || s.format === 'CSRI') w |= mi.rd << 7;
  if (s.format === 'CSRI') w |= (imm & 31) << 15;
  else w |= mi.rs1 << 15;
  if (s.format === 'R' || s.format === 'S' || s.format === 'B') w |= mi.rs2 << 20;
  if (s.format === 'CSR' || s.format === 'CSRI') w |= (mi.csr ?? 0) << 20;
  else w |= encodeImm(s.format, imm);
  return w | 0;
}
