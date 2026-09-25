/** Turns lexed lines into labelled statements with typed operands. */
import { regIndex } from '../isa/regs.ts';
import { AsmError } from './diagnostics.ts';
import type { Diagnostic, Range } from './diagnostics.ts';
import { ExprParser, span } from './expr.ts';
import type { Expr } from './expr.ts';
import { lexAll } from './lexer.ts';
import type { Token } from './lexer.ts';

export type Operand =
  | { k: 'reg'; r: number; name: string; range: Range }
  | { k: 'expr'; e: Expr; range: Range }
  | { k: 'mem'; off: Expr | null; base: number; range: Range }
  | { k: 'str'; value: string; range: Range };

export interface Label { name: string; numeric: boolean; range: Range }

export interface Statement {
  line: number;
  labels: Label[];
  /** Mnemonic or directive (lower-case), or '' for label-only lines. */
  op: string;
  opRange: Range;
  operands: Operand[];
  isDirective: boolean;
  range: Range;
}

export interface ParseResult {
  statements: Statement[];
  diagnostics: Diagnostic[];
  tokens: Token[][];
}

function splitOperands(toks: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.kind === 'punct' && t.text === '(') depth++;
    if (t.kind === 'punct' && t.text === ')') depth--;
    if (t.kind === 'punct' && t.text === ',' && depth === 0) { out.push(cur); cur = []; continue; }
    cur.push(t);
  }
  out.push(cur);
  return out;
}

function parseOperand(toks: Token[], line: number): Operand {
  const range: Range = { line, from: toks[0].start, to: toks[toks.length - 1].end };
  if (toks.length === 1) {
    const t = toks[0];
    if (t.kind === 'ident') {
      const r = regIndex(t.text);
      if (r >= 0) return { k: 'reg', r, name: t.text, range };
    }
    if (t.kind === 'string') return { k: 'str', value: t.value as string, range };
  }
  // memory operand: [expr] ( reg )
  const last = toks[toks.length - 1];
  if (last.kind === 'punct' && last.text === ')' && toks.length >= 3) {
    const regTok = toks[toks.length - 2];
    const open = toks[toks.length - 3];
    if (open.text === '(' && regTok.kind === 'ident' && regIndex(regTok.text) >= 0) {
      const base = regIndex(regTok.text);
      const offToks = toks.slice(0, -3);
      let off: Expr | null = null;
      if (offToks.length) {
        const p = new ExprParser(offToks, line);
        off = p.parse();
        if (p.pos < offToks.length) p.fail(`Unexpected '${p.peek()!.text}'`);
      }
      return { k: 'mem', off, base, range };
    }
  }
  const p = new ExprParser(toks, line);
  const e = p.parse();
  if (p.pos < toks.length) {
    const t = p.peek()!;
    if (t.text === '(') p.fail(`Expected a register inside '( )', e.g. 8(sp)`, t);
    p.fail(`Unexpected '${t.text}'`, t);
  }
  return { k: 'expr', e, range: span(range, e.r) };
}

export function parse(src: string): ParseResult {
  const tokens = lexAll(src);
  const statements: Statement[] = [];
  const diagnostics: Diagnostic[] = [];

  tokens.forEach((lineToks, line) => {
    for (const t of lineToks) {
      if (t.kind === 'error') diagnostics.push({ line, from: t.start, to: t.end, severity: 'error', message: `Invalid token '${t.text}'` });
    }
    const toks = lineToks.filter(t => t.kind !== 'ws' && t.kind !== 'comment');
    if (!toks.length) return;
    try {
      const labels: Label[] = [];
      let i = 0;
      while (i + 1 < toks.length && toks[i + 1].kind === 'punct' && toks[i + 1].text === ':' &&
        (toks[i].kind === 'ident' || toks[i].kind === 'directive' || toks[i].kind === 'number')) {
        const t = toks[i];
        labels.push({ name: t.text, numeric: t.kind === 'number', range: { line, from: t.start, to: t.end } });
        i += 2;
      }
      const rest = toks.slice(i);
      const lineRange: Range = { line, from: toks[0].start, to: toks[toks.length - 1].end };
      if (!rest.length) {
        statements.push({ line, labels, op: '', opRange: lineRange, operands: [], isDirective: false, range: lineRange });
        return;
      }
      const head = rest[0];
      if (head.kind !== 'ident' && head.kind !== 'directive') {
        throw new AsmError(`Expected an instruction or directive, found '${head.text}'`, { line, from: head.start, to: head.end });
      }
      const opRange: Range = { line, from: head.start, to: head.end };
      const operandToks = rest.slice(1);
      const operands: Operand[] = [];
      if (operandToks.length) {
        for (const group of splitOperands(operandToks)) {
          if (!group.length) {
            const at = operandToks[0];
            throw new AsmError('Empty operand (stray comma?)', { line, from: at.start, to: operandToks[operandToks.length - 1].end });
          }
          operands.push(parseOperand(group, line));
        }
      }
      statements.push({
        line, labels, op: head.text.toLowerCase(), opRange, operands,
        isDirective: head.kind === 'directive', range: lineRange,
      });
    } catch (e) {
      if (e instanceof AsmError) diagnostics.push({ ...e.range, severity: 'error', message: e.message });
      else throw e;
    }
  });
  return { statements, diagnostics, tokens };
}
