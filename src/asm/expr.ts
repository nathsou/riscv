/** Assembler expressions: parsing and evaluation. */
import { AsmError } from './diagnostics.ts';
import type { Range } from './diagnostics.ts';
import type { Token } from './lexer.ts';

export type RelocFn = 'hi' | 'lo' | 'pcrel_hi' | 'pcrel_lo';

export type Expr =
  | { k: 'num'; v: number; r: Range }
  | { k: 'sym'; name: string; r: Range }
  | { k: 'local'; n: number; dir: 'b' | 'f'; r: Range }
  | { k: 'dot'; r: Range }
  | { k: 'un'; op: '-' | '~' | '+'; a: Expr; r: Range }
  | { k: 'bin'; op: string; a: Expr; b: Expr; r: Range }
  | { k: 'reloc'; fn: RelocFn; a: Expr; r: Range };

const BIN_PREC: Record<string, number> = {
  '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

/** Recursive-descent parser over a token slice (whitespace already removed). */
export class ExprParser {
  toks: Token[];
  pos = 0;
  line: number;
  constructor(toks: Token[], line: number) {
    this.toks = toks;
    this.line = line;
  }
  peek(): Token | undefined { return this.toks[this.pos]; }
  next(): Token | undefined { return this.toks[this.pos++]; }
  range(t: Token): Range { return { line: this.line, from: t.start, to: t.end }; }
  fail(msg: string, t?: Token): never {
    const tok = t ?? this.peek() ?? this.toks[this.toks.length - 1];
    throw new AsmError(msg, tok ? this.range(tok) : { line: this.line, from: 0, to: 0 });
  }

  parse(minPrec = 0): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'punct') break;
      const p = BIN_PREC[t.text];
      if (p === undefined || p < minPrec) break;
      this.next();
      const right = this.parse(p + 1);
      left = { k: 'bin', op: t.text, a: left, b: right, r: span(left.r, right.r) };
    }
    return left;
  }

  unary(): Expr {
    const t = this.peek();
    if (!t) this.fail('Expected an expression');
    if (t.kind === 'punct' && (t.text === '-' || t.text === '~' || t.text === '+')) {
      this.next();
      const a = this.unary();
      return { k: 'un', op: t.text as '-' | '~' | '+', a, r: span(this.range(t), a.r) };
    }
    return this.primary();
  }

  primary(): Expr {
    const t = this.next();
    if (!t) this.fail('Expected an expression');
    switch (t.kind) {
      case 'number': case 'char': return { k: 'num', v: t.value as number, r: this.range(t) };
      case 'localref': return { k: 'local', n: parseInt(t.text, 10), dir: t.text.endsWith('b') ? 'b' : 'f', r: this.range(t) };
      case 'ident': return { k: 'sym', name: t.text, r: this.range(t) };
      case 'directive':
        return { k: 'sym', name: t.text, r: this.range(t) };
      case 'reloc': {
        const fn = t.text.slice(1);
        if (!['hi', 'lo', 'pcrel_hi', 'pcrel_lo'].includes(fn)) this.fail(`Unknown relocation ${t.text} (expected %hi, %lo, %pcrel_hi or %pcrel_lo)`, t);
        const open = this.next();
        if (!open || open.text !== '(') this.fail(`Expected '(' after ${t.text}`, open ?? t);
        const a = this.parse();
        const close = this.next();
        if (!close || close.text !== ')') this.fail(`Expected ')'`, close ?? t);
        return { k: 'reloc', fn: fn as RelocFn, a, r: span(this.range(t), this.range(close)) };
      }
      case 'punct':
        if (t.text === '(') {
          const e = this.parse();
          const close = this.next();
          if (!close || close.text !== ')') this.fail(`Expected ')'`, close ?? t);
          return e;
        }
        break;
    }
    this.fail(`Unexpected '${t.text}' in expression`, t);
  }
}

export function span(a: Range, b: Range): Range {
  return { line: a.line, from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}

export interface EvalCtx {
  /** Resolve a named symbol; return undefined if unknown. */
  sym(name: string, r: Range): number | undefined;
  local(n: number, dir: 'b' | 'f', r: Range): number | undefined;
  dot: number;
  /** Address of the instruction being assembled (for %pcrel_hi). */
  pc: number;
  /** %pcrel_lo(label): the pc-relative delta recorded for the auipc at label. */
  pcrelLo(addr: number, r: Range): number;
}

/** Thrown when a symbol is not yet known (during layout). */
export class Unresolved extends Error {}

export function evalExpr(e: Expr, ctx: EvalCtx): number {
  switch (e.k) {
    case 'num': return e.v | 0;
    case 'dot': return ctx.dot | 0;
    case 'sym': {
      if (e.name === '.') return ctx.dot | 0;
      const v = ctx.sym(e.name, e.r);
      if (v === undefined) throw new Unresolved(e.name);
      return v | 0;
    }
    case 'local': {
      const v = ctx.local(e.n, e.dir, e.r);
      if (v === undefined) throw new Unresolved(`${e.n}${e.dir}`);
      return v | 0;
    }
    case 'un': {
      const a = evalExpr(e.a, ctx);
      return e.op === '-' ? -a | 0 : e.op === '~' ? ~a : a;
    }
    case 'bin': {
      const a = evalExpr(e.a, ctx), b = evalExpr(e.b, ctx);
      switch (e.op) {
        case '+': return (a + b) | 0;
        case '-': return (a - b) | 0;
        case '*': return Math.imul(a, b);
        case '/': if (b === 0) throw new AsmError('Division by zero', e.r); return (a / b) | 0;
        case '%': if (b === 0) throw new AsmError('Division by zero', e.r); return (a % b) | 0;
        case '<<': return a << (b & 31);
        case '>>': return a >> (b & 31);
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
      }
      throw new AsmError(`Unknown operator ${e.op}`, e.r);
    }
    case 'reloc': {
      const v = evalExpr(e.a, ctx);
      switch (e.fn) {
        case 'hi': return ((v + 0x800) >>> 12) & 0xfffff;
        case 'lo': return (v << 20) >> 20;
        case 'pcrel_hi': return (((v - ctx.pc) + 0x800) >>> 12) & 0xfffff;
        case 'pcrel_lo': return ctx.pcrelLo(v >>> 0, e.r);
      }
    }
  }
}

/** Does the expression refer to an address (label, '.', local label)? */
export function refersToLabel(e: Expr, isLabel: (name: string) => boolean): boolean {
  switch (e.k) {
    case 'num': return false;
    case 'dot': case 'local': return true;
    case 'sym': return e.name === '.' || isLabel(e.name);
    case 'un': return refersToLabel(e.a, isLabel);
    case 'bin': return refersToLabel(e.a, isLabel) || refersToLabel(e.b, isLabel);
    case 'reloc': return false;
  }
}

export function hasReloc(e: Expr): boolean {
  switch (e.k) {
    case 'reloc': return true;
    case 'un': return hasReloc(e.a);
    case 'bin': return hasReloc(e.a) || hasReloc(e.b);
    default: return false;
  }
}
