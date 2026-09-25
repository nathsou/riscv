import type { Stmt } from '../dsl/ast.ts';
import type { Format } from '../formats.ts';

export type Ext = 'RV32I' | 'M' | 'Zicsr' | 'Priv';

export type Category =
  | 'arith' | 'logic' | 'shift' | 'compare' | 'upper'
  | 'branch' | 'jump' | 'load' | 'store'
  | 'muldiv' | 'csr' | 'system';

export type OperandKind = 'rd' | 'rs1' | 'rs2' | 'imm12' | 'shamt' | 'mem' | 'branch' | 'jump' | 'uimm20' | 'csr' | 'zimm' | 'fence';

export type AluOp = 'add' | 'sub' | 'sll' | 'slt' | 'sltu' | 'xor' | 'srl' | 'sra' | 'or' | 'and';
export type ImmSel = 'I' | 'S' | 'B' | 'U' | 'J' | 'Ish' | '-';
export type BrType = 'none' | 'eq' | 'ne' | 'lt' | 'ge' | 'ltu' | 'geu';
export type WbSel = 'alu' | 'mem' | 'pc4' | 'md' | 'csr' | '-';

/** Single-cycle datapath control signals (CS61C / P&H style). */
export interface Control {
  regWrite: 0 | 1;
  immSel: ImmSel;
  aSel: 'rs1' | 'pc' | 'zero';
  bSel: 'rs2' | 'imm';
  aluOp: AluOp;
  brType: BrType;
  jump: 0 | 1;
  memRead: 0 | 1;
  memWrite: 0 | 1;
  memWidth: 'b' | 'h' | 'w';
  memSigned: 0 | 1;
  wbSel: WbSel;
  csrOp: 'none' | 'rw' | 'rs' | 'rc';
  csrImm: 0 | 1;
  sys: 'none' | 'ecall' | 'ebreak' | 'mret' | 'wfi' | 'fence';
}

export interface InsnSpec {
  mnemonic: string;
  ext: Ext;
  format: Format;
  category: Category;
  opcode: number;
  funct3?: number;
  funct7?: number;
  /** Full fixed word for SYS-format instructions. */
  fixedWord?: number;
  operands: OperandKind[];
  summary: string;
  description: string;
  semantics: Stmt[];
  control: Control;
  notes?: string[];
  example: string;
  /** Computed: mask/match for decoding. */
  mask: number;
  match: number;
}
