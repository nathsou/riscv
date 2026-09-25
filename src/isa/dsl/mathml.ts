/**
 * Render instruction semantics as MathML (natively supported by browsers).
 * Two notations are produced from the same AST:
 *   - a list of state updates  (x[rd] ← …, pc ← …)
 *   - a small-step operational inference rule  ⟨pc, x, M⟩ → ⟨pc′, x′, M′⟩
 */
import type { Expr, Stmt, BinOp } from './ast.ts';
import type { InsnSpec } from '../spec/index.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mi = (s: string, cls = '') => `<mi${cls ? ` class="${cls}"` : ''}${s.length > 1 ? ' mathvariant="normal"' : ''}>${esc(s)}</mi>`;
const mo = (s: string) => `<mo>${esc(s)}</mo>`;
const mn = (s: string | number) => `<mn>${esc(String(s))}</mn>`;
const row = (...xs: string[]) => `<mrow>${xs.join('')}</mrow>`;
const sub = (a: string, b: string) => `<msub>${a}${b}</msub>`;
const sup = (a: string, b: string) => `<msup>${a}${b}</msup>`;
const paren = (x: string) => row(mo('('), x, mo(')'));
const fn = (name: string, ...args: string[]) => row(mi(name, 'fn'), mo('('), args.join(mo(',')), mo(')'));
const text = (s: string) => `<mtext>${esc(s)}</mtext>`;
const sp = '<mspace width="0.4em"></mspace>';

export const reg = (r: string) => row(mi('x', 'reg'), mo('['), mi(r, 'field'), mo(']'));
const mem = (w: number, a: string) => row(sub(mi('M'), mn(w)), mo('['), a, mo(']'));

const PREC: Record<BinOp, number> = {
  mul: 6, mulh: 6, mulhsu: 6, mulhu: 6, div: 6, divu: 6, rem: 6, remu: 6,
  add: 5, sub: 5, sll: 4, srl: 4, sra: 4,
  ltS: 3, ltU: 3, geS: 3, geU: 3, eq: 3, ne: 3, and: 2, xor: 1, or: 0,
};

function opSym(op: BinOp): string {
  const subOp = (s: string, t: string) => sub(mo(s), mi(t));
  switch (op) {
    case 'add': return mo('+');
    case 'sub': return mo('−');
    case 'and': return mo('&');
    case 'or': return mo('|');
    case 'xor': return mo('⊕');
    case 'sll': return mo('≪');
    case 'srl': return subOp('≫', 'u');
    case 'sra': return subOp('≫', 's');
    case 'ltS': return subOp('<', 's');
    case 'ltU': return subOp('<', 'u');
    case 'geS': return subOp('≥', 's');
    case 'geU': return subOp('≥', 'u');
    case 'eq': return mo('=');
    case 'ne': return mo('≠');
    case 'mul': return mo('×');
    case 'div': return subOp('÷', 's');
    case 'divu': return subOp('÷', 'u');
    case 'rem': return sub(mi('rem', 'fn'), mi('s'));
    case 'remu': return sub(mi('rem', 'fn'), mi('u'));
    default: return mo('×');
  }
}

export function immMath(spec: InsnSpec): string {
  switch (spec.format) {
    case 'U': return row(mi('imm', 'field'), mo('∥'), sup(mn(0), mn(12)));
    case 'Ish': return mi('shamt', 'field');
    case 'CSRI': return fn('zext', mi('uimm', 'field'));
    default: return fn('sext', mi('imm', 'field'));
  }
}

function isShiftAmount(op: BinOp) { return op === 'sll' || op === 'srl' || op === 'sra'; }

export function exprMath(e: Expr, spec: InsnSpec, ctx = -1): string {
  switch (e.k) {
    case 'x': return reg(e.r);
    case 'imm': return immMath(spec);
    case 'shamt': return mi('shamt', 'field');
    case 'zimm': return fn('zext', mi('uimm', 'field'));
    case 'pc': return mi('pc', 'reg');
    case 'csr': return row(mi('CSR', 'reg'), mo('['), mi('csr', 'field'), mo(']'));
    case 'const': return e.v === ~1 ? row(mo('¬'), mn(1)) : mn(e.v);
    case 'not': return row(mo('¬'), exprMath(e.a, spec, 9));
    case 'load': {
      const m = mem(e.w, exprMath(e.addr, spec));
      return e.w === 32 ? m : fn(e.signed ? 'sext' : 'zext', m);
    }
    case 'bin': {
      if (e.op === 'mulh' || e.op === 'mulhsu' || e.op === 'mulhu') {
        const [sa, sb] = e.op === 'mulh' ? ['s', 's'] : e.op === 'mulhsu' ? ['s', 'u'] : ['u', 'u'];
        const prod = paren(row(sub(exprMath(e.a, spec, 9), mi(sa)), mo('×'), sub(exprMath(e.b, spec, 9), mi(sb))));
        return row(prod, mo('['), mn(63), mo(':'), mn(32), mo(']'));
      }
      const p = PREC[e.op];
      let rhs = exprMath(e.b, spec, p + 1);
      if (isShiftAmount(e.op) && e.b.k === 'x') rhs = row(rhs, mo('['), mn(4), mo(':'), mn(0), mo(']'));
      const body = row(exprMath(e.a, spec, p), opSym(e.op), rhs);
      return ctx > p ? paren(body) : body;
    }
  }
}

function isCompare(e: Expr) {
  return e.k === 'bin' && ['ltS', 'ltU', 'geS', 'geU', 'eq', 'ne'].includes(e.op);
}

/** RHS for x[rd] ← …; comparisons become (c) ? 1 : 0. */
function valueMath(e: Expr, spec: InsnSpec): string {
  if (isCompare(e)) return row(paren(exprMath(e, spec)), mo('?'), mn(1), mo(':'), mn(0));
  return exprMath(e, spec);
}

const assign = (lhs: string, rhs: string) => row(lhs, mo('←'), rhs);
const storeSlice = (w: number) => w === 32 ? '' : row(mo('['), mn(w - 1), mo(':'), mn(0), mo(']'));

/** One MathML <math> element per line of state updates. */
export function stateUpdateMath(spec: InsnSpec): string[] {
  const lines: string[] = [];
  const pcPlus4 = row(mi('pc', 'reg'), mo('+'), mn(4));
  let pcAssigned = false;
  const walk = (stmts: Stmt[], cond?: string) => {
    for (const s of stmts) {
      switch (s.k) {
        case 'setX': lines.push(assign(reg('rd'), valueMath(s.v, spec))); break;
        case 'setPC':
          pcAssigned = true;
          lines.push(assign(mi('pc', 'reg'), cond
            ? row(paren(cond), mo('?'), exprMath(s.v, spec), mo(':'), pcPlus4)
            : exprMath(s.v, spec)));
          break;
        case 'if': walk(s.then, exprMath(s.c, spec)); break;
        case 'store':
          lines.push(assign(mem(s.w, exprMath(s.addr, spec)), row(exprMath(s.v, spec), storeSlice(s.w))));
          break;
        case 'setCSR': {
          let rhs = exprMath(s.v, spec);
          const csr = row(mi('CSR', 'reg'), mo('['), mi('csr', 'field'), mo(']'));
          if (s.unless) rhs = row(rhs, sp, text(s.unless === 'rs1zero' ? '(only if rs1 ≠ 0)' : '(only if uimm ≠ 0)'));
          lines.push(assign(csr, rhs));
          break;
        }
        case 'ecall':
          pcAssigned = true;
          lines.push(row(mi('mtvec', 'reg'), mo('='), mn(0), mo('⇒'), row(mi('σ'), mo('←'), fn('syscall', sub(reg('a7'), text('')), mi('σ')))));
          lines.push(row(mi('mtvec', 'reg'), mo('≠'), mn(0), mo('⇒'), fn('trap', mn(11))));
          break;
        case 'ebreak':
          pcAssigned = true;
          lines.push(row(mi('mtvec', 'reg'), mo('='), mn(0), mo('⇒'), text('halt for debugger')));
          lines.push(row(mi('mtvec', 'reg'), mo('≠'), mn(0), mo('⇒'), fn('trap', mn(3))));
          break;
        case 'mret':
          pcAssigned = true;
          lines.push(assign(mi('pc', 'reg'), mi('mepc', 'reg')));
          lines.push(assign(row(mi('mstatus', 'reg'), mo('.'), mi('MIE')), row(mi('mstatus', 'reg'), mo('.'), mi('MPIE'))));
          lines.push(assign(row(mi('mstatus', 'reg'), mo('.'), mi('MPIE')), mn(1)));
          break;
        case 'fence': lines.push(text('no effect on a single in-order hart')); break;
        case 'wfi': lines.push(text('stall until an interrupt is pending (hint)')); break;
      }
    }
  };
  walk(spec.semantics);
  if (!pcAssigned) lines.push(assign(mi('pc', 'reg'), pcPlus4));
  return lines.map(l => `<math display="block">${l}</math>`);
}

/** Small-step operational rule(s). Branches get a taken and a not-taken rule. */
export function inferenceRules(spec: InsnSpec): { name: string; math: string }[] {
  const fetch = row(fn('decode', row(sub(mi('M'), mn(32)), mo('['), mi('pc', 'reg'), mo(']'))), mo('='), text(spec.mnemonic + ' '), mi(operandLabel(spec)));
  const state = (pc: string, x: string, m: string) => row(mo('⟨'), pc, mo(','), x, mo(','), m, mo('⟩'));
  const rule = (premises: string[], concl: string) =>
    `<math display="block"><mfrac linethickness="1.2px">${row(...premises.flatMap((p, i) => i ? [sp, sp, sp, p] : [p]))}${concl}</mfrac></math>`;
  const X = mi('x'), M = mi('M'), P = mi('pc');
  const pc4 = row(mi('pc'), mo('+'), mn(4));
  const upd = (m: string, k: string, v: string) => row(m, mo('['), k, mo('↦'), v, mo(']'));
  const out: { name: string; math: string }[] = [];

  const stmts = spec.semantics;
  const s0 = stmts[0];
  if (s0.k === 'if') {
    const cond = exprMath(s0.c, spec);
    const tgt = s0.then[0].k === 'setPC' ? exprMath(s0.then[0].v, spec) : '';
    out.push({ name: `${spec.mnemonic}-taken`, math: rule([fetch, cond], row(state(P, X, M), mo('→'), state(tgt, X, M))) });
    out.push({ name: `${spec.mnemonic}-not-taken`, math: rule([fetch, row(mo('¬'), paren(cond))], row(state(P, X, M), mo('→'), state(pc4, X, M))) });
    return out;
  }
  const premises = [fetch];
  let pc = pc4, x = X, m = M;
  for (const s of stmts) {
    switch (s.k) {
      case 'setX': {
        const v = mi('v');
        premises.push(row(v, mo('='), valueMath(s.v, spec)));
        x = upd(X, mi('rd', 'field'), v);
        break;
      }
      case 'setPC': {
        premises.push(row(mi('t'), mo('='), exprMath(s.v, spec)));
        pc = mi('t');
        break;
      }
      case 'store': {
        const a = mi('a');
        premises.push(row(a, mo('='), exprMath(s.addr, spec)));
        if (s.w > 8) premises.push(fn('aligned', a, mn(s.w / 8)));
        m = upd(M, row(a, mo('..'), a, mo('+'), mn(s.w / 8 - 1)), row(exprMath(s.v, spec), storeSlice(s.w)));
        break;
      }
      case 'setCSR': {
        premises.push(row(mi('c'), mo('='), exprMath(s.v, spec)));
        break;
      }
      default: return [];
    }
  }
  if (stmts.some(s => s.k === 'setX' && s.v.k === 'load')) {
    const ld = stmts.find(s => s.k === 'setX')!;
    if (ld.k === 'setX' && ld.v.k === 'load' && ld.v.w > 8) premises.splice(1, 0, fn('aligned', exprMath(ld.v.addr, spec), mn(ld.v.w / 8)));
  }
  let concl = row(state(P, X, M), mo('→'), state(pc, x, m));
  if (stmts.some(s => s.k === 'setCSR')) concl = row(concl, sp, text('with CSR[csr] ← c'));
  out.push({ name: spec.mnemonic, math: rule(premises, concl) });
  return out;
}

function operandLabel(spec: InsnSpec): string {
  return spec.operands.map(o => o === 'mem' ? 'imm(rs1)' : o === 'branch' || o === 'jump' ? 'imm' : o === 'uimm20' ? 'imm' : o === 'imm12' ? 'imm' : o === 'zimm' ? 'uimm' : o).join(', ');
}
