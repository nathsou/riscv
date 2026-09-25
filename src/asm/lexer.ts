/**
 * Line-oriented tokenizer shared by the assembler and the editor's syntax
 * highlighter, so what you see highlighted is exactly what gets parsed.
 */

export type TokKind =
  | 'ident' | 'directive' | 'number' | 'string' | 'char' | 'punct'
  | 'comment' | 'reloc' | 'localref' | 'ws' | 'error';

export interface Token {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
  /** Numeric value for number/char tokens; decoded string for strings. */
  value?: number | string;
}

export interface LexResult {
  tokens: Token[];
  /** True if the line ends inside a block comment. */
  inBlock: boolean;
}

const IDENT_START = /[A-Za-z_.$]/;
const IDENT_CHAR = /[A-Za-z0-9_.$]/;
const PUNCT2 = ['<<', '>>'];
const PUNCT1 = ',():+-*/%&|^~';

function unescape(ch: string): number | null {
  switch (ch) {
    case 'n': return 10; case 't': return 9; case 'r': return 13; case '0': return 0;
    case '\\': return 92; case '\'': return 39; case '"': return 34; case 'a': return 7;
    case 'b': return 8; case 'f': return 12; case 'v': return 11; case 'e': return 27;
  }
  return null;
}

export function lexLine(line: string, inBlock = false): LexResult {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  const push = (kind: TokKind, start: number, end: number, value?: number | string) =>
    tokens.push({ kind, text: line.slice(start, end), start, end, value });

  if (inBlock) {
    const close = line.indexOf('*/');
    if (close < 0) { if (n) push('comment', 0, n); return { tokens, inBlock: true }; }
    push('comment', 0, close + 2);
    i = close + 2;
  }

  while (i < n) {
    const ch = line[i];
    const start = i;
    if (ch === ' ' || ch === '\t') {
      while (i < n && (line[i] === ' ' || line[i] === '\t')) i++;
      push('ws', start, i);
      continue;
    }
    if (ch === '#' || (ch === '/' && line[i + 1] === '/') || ch === ';') {
      push('comment', start, n);
      break;
    }
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) { push('comment', start, n); return { tokens, inBlock: true }; }
      i = close + 2;
      push('comment', start, i);
      continue;
    }
    if (ch === '"') {
      i++;
      let s = '';
      let ok = false;
      while (i < n) {
        const c = line[i];
        if (c === '"') { ok = true; i++; break; }
        if (c === '\\' && i + 1 < n) {
          const e = line[i + 1];
          if (e === 'x') {
            const m = /^[0-9a-fA-F]{1,2}/.exec(line.slice(i + 2));
            if (m) { s += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
          }
          const u = unescape(e);
          s += u === null ? e : String.fromCharCode(u);
          i += 2;
          continue;
        }
        s += c;
        i++;
      }
      push(ok ? 'string' : 'error', start, i, s);
      continue;
    }
    if (ch === '\'') {
      // 'a' or '\n'
      let v: number | null = null;
      let j = i + 1;
      if (line[j] === '\\') { v = unescape(line[j + 1] ?? ''); j += 2; }
      else if (j < n) { v = line.charCodeAt(j); j += 1; }
      if (v !== null && line[j] === '\'') { i = j + 1; push('char', start, i, v); }
      else { i = Math.min(n, j + 1); push('error', start, i); }
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const rest = line.slice(i);
      let m = /^0[xX][0-9a-fA-F_]+/.exec(rest) ?? /^0[bB][01_]+/.exec(rest) ?? /^0[oO][0-7_]+/.exec(rest);
      if (m) {
        const t = m[0].replace(/_/g, '');
        const base = /[xX]/.test(t[1]) ? 16 : /[bB]/.test(t[1]) ? 2 : 8;
        i += m[0].length;
        if (i < n && IDENT_CHAR.test(line[i])) { while (i < n && IDENT_CHAR.test(line[i])) i++; push('error', start, i); continue; }
        push('number', start, i, parseInt(t.slice(2), base));
        continue;
      }
      m = /^[0-9]+[bf](?![A-Za-z0-9_])/.exec(rest);
      if (m) { i += m[0].length; push('localref', start, i); continue; }
      m = /^[0-9][0-9_]*/.exec(rest)!;
      i += m[0].length;
      if (i < n && IDENT_CHAR.test(line[i]) && line[i] !== '.') { while (i < n && IDENT_CHAR.test(line[i])) i++; push('error', start, i); continue; }
      push('number', start, i, parseInt(m[0].replace(/_/g, ''), 10));
      continue;
    }
    if (ch === '%' && /[a-z]/.test(line[i + 1] ?? '')) {
      i++;
      while (i < n && /[a-z_]/.test(line[i])) i++;
      push('reloc', start, i);
      continue;
    }
    if (IDENT_START.test(ch)) {
      i++;
      while (i < n && IDENT_CHAR.test(line[i])) i++;
      const text = line.slice(start, i);
      push(text[0] === '.' && text.length > 1 ? 'directive' : 'ident', start, i);
      continue;
    }
    const two = line.slice(i, i + 2);
    if (PUNCT2.includes(two)) { i += 2; push('punct', start, i); continue; }
    if (PUNCT1.includes(ch)) { i++; push('punct', start, i); continue; }
    i++;
    push('error', start, i);
  }
  return { tokens, inBlock: false };
}

/** Lex a whole document, returning per-line tokens. */
export function lexAll(src: string): Token[][] {
  const lines = src.split('\n');
  const out: Token[][] = [];
  let inBlock = false;
  for (const l of lines) {
    const r = lexLine(l.replace(/\r$/, ''), inBlock);
    out.push(r.tokens);
    inBlock = r.inBlock;
  }
  return out;
}
