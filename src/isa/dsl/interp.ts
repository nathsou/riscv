/**
 * Reference interpreter: a direct, obviously-correct tree walk that returns
 * the *effects* of an instruction instead of performing them. Used by tests
 * (differential checking) and by the datapath model for comparison.
 */
import { evalBin } from './ast.ts';
import type { Expr, Stmt, Width } from './ast.ts';
import type { DecodedInsn } from '../decode.ts';

export interface ReadState {
  x(i: number): number;
  pc: number;
  load(addr: number, w: Width, signed: boolean): number;
  csr(addr: number): number;
}

export interface Effects {
  rd?: { reg: number; value: number };
  pc: number;
  store?: { w: Width; addr: number; value: number };
  csr?: { addr: number; value: number };
  sys?: 'ecall' | 'ebreak' | 'mret' | 'fence' | 'wfi';
}

export function evalExpr(e: Expr, d: DecodedInsn, s: ReadState): number {
  switch (e.k) {
    case 'x': return s.x(e.r === 'rs1' ? d.rs1 : d.rs2) | 0;
    case 'imm': return d.imm | 0;
    case 'shamt': return d.imm & 31;
    case 'zimm': return d.rs1;
    case 'pc': return s.pc | 0;
    case 'csr': return s.csr(d.csr) | 0;
    case 'const': return e.v | 0;
    case 'bin': return evalBin(e.op, evalExpr(e.a, d, s), evalExpr(e.b, d, s)) | 0;
    case 'not': return ~evalExpr(e.a, d, s);
    case 'load': return s.load(evalExpr(e.addr, d, s) >>> 0, e.w, e.signed) | 0;
  }
}

export function interpret(d: DecodedInsn, s: ReadState): Effects {
  const eff: Effects = { pc: (s.pc + 4) | 0 };
  const run = (stmts: Stmt[]) => {
    for (const st of stmts) {
      switch (st.k) {
        case 'setX': if (d.rd !== 0) eff.rd = { reg: d.rd, value: evalExpr(st.v, d, s) }; else evalExpr(st.v, d, s); break;
        case 'setPC': eff.pc = evalExpr(st.v, d, s); break;
        case 'if': if (evalExpr(st.c, d, s)) run(st.then); break;
        case 'store': eff.store = { w: st.w, addr: evalExpr(st.addr, d, s) >>> 0, value: evalExpr(st.v, d, s) }; break;
        case 'setCSR':
          if (st.unless === 'rs1zero' && d.rs1 === 0) break;
          if (st.unless === 'zimmzero' && d.rs1 === 0) break;
          eff.csr = { addr: d.csr, value: evalExpr(st.v, d, s) };
          break;
        default: eff.sys = st.k;
      }
    }
  };
  run(d.spec.semantics);
  return eff;
}
