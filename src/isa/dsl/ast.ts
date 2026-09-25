/**
 * A tiny semantics language for RISC-V instructions.
 *
 * Every instruction's behaviour is written once as a list of statements over
 * 32-bit bit-vectors. All expressions read the *pre-state* (parallel
 * assignment), so `jalr ra, 0(ra)` behaves correctly. If no statement assigns
 * the PC, the implicit update is `pc ← pc + 4`.
 *
 * Back-ends: `interp.ts` (reference interpreter), `compile.ts` (closure
 * compiler used by the fast simulator) and `mathml.ts` (formal notation).
 */

import { mulh, mulhsu, mulhu, div, divu, rem, remu } from '../bits.ts';

export type BinOp =
  | 'add' | 'sub' | 'and' | 'or' | 'xor'
  | 'sll' | 'srl' | 'sra'
  | 'ltS' | 'ltU' | 'eq' | 'ne' | 'geS' | 'geU'
  | 'mul' | 'mulh' | 'mulhsu' | 'mulhu' | 'div' | 'divu' | 'rem' | 'remu';

export type Width = 8 | 16 | 32;

export type Expr =
  | { k: 'x'; r: 'rs1' | 'rs2' }
  | { k: 'imm' }
  | { k: 'shamt' }
  | { k: 'zimm' }
  | { k: 'pc' }
  | { k: 'csr' }
  | { k: 'const'; v: number }
  | { k: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'load'; w: Width; signed: boolean; addr: Expr };

export type Stmt =
  | { k: 'setX'; v: Expr }
  | { k: 'setPC'; v: Expr }
  | { k: 'if'; c: Expr; then: Stmt[] }
  | { k: 'store'; w: Width; addr: Expr; v: Expr }
  | { k: 'setCSR'; v: Expr; unless?: 'rs1zero' | 'zimmzero' }
  | { k: 'ecall' } | { k: 'ebreak' } | { k: 'mret' } | { k: 'fence' } | { k: 'wfi' };

// ---------- builders ----------
export const X1: Expr = { k: 'x', r: 'rs1' };
export const X2: Expr = { k: 'x', r: 'rs2' };
export const IMM: Expr = { k: 'imm' };
export const SHAMT: Expr = { k: 'shamt' };
export const ZIMM: Expr = { k: 'zimm' };
export const PC: Expr = { k: 'pc' };
export const CSR: Expr = { k: 'csr' };
export const c = (v: number): Expr => ({ k: 'const', v });
const bin = (op: BinOp) => (a: Expr, b: Expr): Expr => ({ k: 'bin', op, a, b });
export const add = bin('add'), sub = bin('sub'), and = bin('and'), or = bin('or'), xor = bin('xor');
export const sll = bin('sll'), srl = bin('srl'), sra = bin('sra');
export const ltS = bin('ltS'), ltU = bin('ltU'), eq = bin('eq'), ne = bin('ne'), geS = bin('geS'), geU = bin('geU');
export const mul = bin('mul'), mulhOp = bin('mulh'), mulhsuOp = bin('mulhsu'), mulhuOp = bin('mulhu');
export const divOp = bin('div'), divuOp = bin('divu'), remOp = bin('rem'), remuOp = bin('remu');
export const not = (a: Expr): Expr => ({ k: 'not', a });
export const load = (w: Width, signed: boolean, addr: Expr): Expr => ({ k: 'load', w, signed, addr });

export const setX = (v: Expr): Stmt => ({ k: 'setX', v });
export const setPC = (v: Expr): Stmt => ({ k: 'setPC', v });
export const iff = (cond: Expr, ...then: Stmt[]): Stmt => ({ k: 'if', c: cond, then });
export const store = (w: Width, addr: Expr, v: Expr): Stmt => ({ k: 'store', w, addr, v });
export const setCSR = (v: Expr, unless?: 'rs1zero' | 'zimmzero'): Stmt => ({ k: 'setCSR', v, unless });

/** Does any statement (recursively) assign the PC? */
export function writesPC(stmts: Stmt[]): boolean {
  return stmts.some(s => s.k === 'setPC' || s.k === 'mret' || (s.k === 'if' && writesPC(s.then)));
}

/** Pure evaluation of a binary operator on 32-bit patterns. */
export function evalBin(op: BinOp, a: number, b: number): number {
  switch (op) {
    case 'add': return (a + b) | 0;
    case 'sub': return (a - b) | 0;
    case 'and': return a & b;
    case 'or': return a | b;
    case 'xor': return a ^ b;
    case 'sll': return a << (b & 31);
    case 'srl': return (a >>> (b & 31)) | 0;
    case 'sra': return a >> (b & 31);
    case 'ltS': return (a | 0) < (b | 0) ? 1 : 0;
    case 'ltU': return (a >>> 0) < (b >>> 0) ? 1 : 0;
    case 'geS': return (a | 0) >= (b | 0) ? 1 : 0;
    case 'geU': return (a >>> 0) >= (b >>> 0) ? 1 : 0;
    case 'eq': return (a | 0) === (b | 0) ? 1 : 0;
    case 'ne': return (a | 0) !== (b | 0) ? 1 : 0;
    case 'mul': return Math.imul(a, b);
    case 'mulh': return mulh(a, b);
    case 'mulhsu': return mulhsu(a, b);
    case 'mulhu': return mulhu(a, b);
    case 'div': return div(a, b);
    case 'divu': return divu(a, b);
    case 'rem': return rem(a, b);
    case 'remu': return remu(a, b);
  }
}
