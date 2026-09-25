/**
 * Closure compiler: turns an instruction's semantics into a specialised JS
 * function with the register numbers and immediate baked in. This is what
 * the fast simulator runs. Values are computed into locals first and
 * committed afterwards, preserving the DSL's parallel-assignment semantics.
 */
import { evalBin } from './ast.ts';
import type { Expr, Stmt } from './ast.ts';
import type { Hart } from './env.ts';
import type { DecodedInsn } from '../decode.ts';

type F = (h: Hart) => number;
export type Exec = (h: Hart) => void;

function cexpr(e: Expr, d: DecodedInsn): F {
  switch (e.k) {
    case 'x': {
      const r = e.r === 'rs1' ? d.rs1 : d.rs2;
      return r === 0 ? () => 0 : h => h.x[r];
    }
    case 'imm': { const v = d.imm | 0; return () => v; }
    case 'shamt': { const v = d.imm & 31; return () => v; }
    case 'zimm': { const v = d.rs1; return () => v; }
    case 'pc': return h => h.pc | 0;
    case 'csr': { const a = d.csr; return h => h.csrRead(a) | 0; }
    case 'const': { const v = e.v | 0; return () => v; }
    case 'not': { const a = cexpr(e.a, d); return h => ~a(h); }
    case 'load': {
      const a = cexpr(e.addr, d), w = e.w, sg = e.signed;
      return h => h.load(a(h) >>> 0, w, sg);
    }
    case 'bin': {
      const a = cexpr(e.a, d), b = cexpr(e.b, d);
      switch (e.op) {
        case 'add': return h => (a(h) + b(h)) | 0;
        case 'sub': return h => (a(h) - b(h)) | 0;
        case 'and': return h => a(h) & b(h);
        case 'or': return h => a(h) | b(h);
        case 'xor': return h => a(h) ^ b(h);
        case 'sll': return h => a(h) << (b(h) & 31);
        case 'srl': return h => (a(h) >>> (b(h) & 31)) | 0;
        case 'sra': return h => a(h) >> (b(h) & 31);
        case 'ltS': return h => (a(h) < b(h) ? 1 : 0);
        case 'ltU': return h => ((a(h) >>> 0) < (b(h) >>> 0) ? 1 : 0);
        case 'eq': return h => (a(h) === b(h) ? 1 : 0);
        case 'ne': return h => (a(h) !== b(h) ? 1 : 0);
        default: { const op = e.op; return h => evalBin(op, a(h), b(h)); }
      }
    }
  }
}

function cstmts(stmts: Stmt[], d: DecodedInsn): Exec {
  // Specialise the very common shapes for speed.
  if (stmts.length === 1) {
    const s = stmts[0];
    if (s.k === 'setX') {
      const v = cexpr(s.v, d), rd = d.rd;
      return rd === 0 ? h => { v(h); } : h => { h.writeReg(rd, v(h)); };
    }
    if (s.k === 'if' && s.then.length === 1 && s.then[0].k === 'setPC') {
      const cond = cexpr(s.c, d), t = cexpr(s.then[0].v, d);
      return h => { if (cond(h)) h.nextPc = t(h) >>> 0; };
    }
    if (s.k === 'store') {
      const a = cexpr(s.addr, d), v = cexpr(s.v, d), w = s.w;
      return h => { const addr = a(h) >>> 0; h.checkStore(addr, w); h.store(addr, w, v(h)); };
    }
  }
  // General case: evaluate everything, then commit in a fixed order.
  const parts = stmts.map(s => cstmt(s, d));
  return h => {
    const commits: (() => void)[] = [];
    for (const p of parts) p(h, commits);
    for (const c of commits) c();
  };
}

type Part = (h: Hart, commits: (() => void)[]) => void;

function cstmt(s: Stmt, d: DecodedInsn): Part {
  switch (s.k) {
    case 'setX': {
      const v = cexpr(s.v, d), rd = d.rd;
      return (h, cs) => { const val = v(h); if (rd !== 0) cs.push(() => h.writeReg(rd, val)); };
    }
    case 'setPC': {
      const v = cexpr(s.v, d);
      return (h, cs) => { const val = v(h) >>> 0; cs.push(() => { h.nextPc = val; }); };
    }
    case 'if': {
      const cond = cexpr(s.c, d), inner = s.then.map(t => cstmt(t, d));
      return (h, cs) => { if (cond(h)) for (const p of inner) p(h, cs); };
    }
    case 'store': {
      const a = cexpr(s.addr, d), v = cexpr(s.v, d), w = s.w;
      return (h, cs) => { const addr = a(h) >>> 0, val = v(h); h.checkStore(addr, w); cs.unshift(() => h.store(addr, w, val)); };
    }
    case 'setCSR': {
      const v = cexpr(s.v, d), addr = d.csr;
      const skip = (s.unless === 'rs1zero' || s.unless === 'zimmzero') && d.rs1 === 0;
      return (h, cs) => { if (skip) return; const val = v(h); cs.unshift(() => h.csrWrite(addr, val)); };
    }
    case 'ecall': return (h, cs) => cs.push(() => h.ecall());
    case 'ebreak': return (h, cs) => cs.push(() => h.ebreak());
    case 'mret': return (h, cs) => cs.push(() => h.mret());
    case 'wfi': return (h, cs) => cs.push(() => h.wfi());
    case 'fence': return () => {};
  }
}

export function compile(d: DecodedInsn): Exec {
  return cstmts(d.spec.semantics, d);
}
