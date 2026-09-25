import { RV32I } from './rv32i.ts';
import { RV32M } from './rv32m.ts';
import { ZICSR } from './zicsr.ts';
import type { InsnSpec } from './types.ts';

export type { InsnSpec, Control, Category, Ext, OperandKind, AluOp, BrType, WbSel, ImmSel } from './types.ts';

export const INSTRUCTIONS: InsnSpec[] = [...RV32I, ...RV32M, ...ZICSR];

export const BY_MNEMONIC = new Map(INSTRUCTIONS.map(i => [i.mnemonic, i]));

export const CATEGORY_LABELS: Record<InsnSpec['category'], string> = {
  arith: 'Arithmetic', logic: 'Logic', shift: 'Shifts', compare: 'Comparison', upper: 'Upper immediate',
  branch: 'Branches', jump: 'Jumps', load: 'Loads', store: 'Stores', muldiv: 'Multiply / divide',
  csr: 'CSR access', system: 'System',
};
