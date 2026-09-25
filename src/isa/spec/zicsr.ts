import { X1, CSR, ZIMM, or, and, not, setX, setCSR } from '../dsl/ast.ts';
import { ctl, insn } from './define.ts';
import type { InsnSpec } from './types.ts';

const SYSTEM = 0b1110011;

export const ZICSR: InsnSpec[] = [
  insn({
    mnemonic: 'csrrw', ext: 'Zicsr', format: 'CSR', category: 'csr', opcode: SYSTEM, funct3: 0b001, operands: ['rd', 'csr', 'rs1'],
    summary: 'CSR read and write', description: 'Atomically swaps: writes the old CSR value to rd and rs1 into the CSR.',
    example: 'csrrw zero, mtvec, t0', semantics: [setX(CSR), setCSR(X1)],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rw' }),
  }),
  insn({
    mnemonic: 'csrrs', ext: 'Zicsr', format: 'CSR', category: 'csr', opcode: SYSTEM, funct3: 0b010, operands: ['rd', 'csr', 'rs1'],
    summary: 'CSR read and set bits', description: 'Writes the old CSR value to rd and sets the CSR bits that are 1 in rs1. With rs1 = zero it is a pure read (csrr).',
    example: 'csrrs a0, cycle, zero', semantics: [setX(CSR), setCSR(or(CSR, X1), 'rs1zero')],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rs' }),
  }),
  insn({
    mnemonic: 'csrrc', ext: 'Zicsr', format: 'CSR', category: 'csr', opcode: SYSTEM, funct3: 0b011, operands: ['rd', 'csr', 'rs1'],
    summary: 'CSR read and clear bits', description: 'Writes the old CSR value to rd and clears the CSR bits that are 1 in rs1.',
    example: 'csrrc zero, mstatus, t0', semantics: [setX(CSR), setCSR(and(CSR, not(X1)), 'rs1zero')],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rc' }),
  }),
  insn({
    mnemonic: 'csrrwi', ext: 'Zicsr', format: 'CSRI', category: 'csr', opcode: SYSTEM, funct3: 0b101, operands: ['rd', 'csr', 'zimm'],
    summary: 'CSR read and write immediate', description: 'Like csrrw, but writes a 5-bit zero-extended immediate (in the rs1 field) into the CSR.',
    example: 'csrrwi zero, mscratch, 5', semantics: [setX(CSR), setCSR(ZIMM)],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rw', csrImm: 1 }),
  }),
  insn({
    mnemonic: 'csrrsi', ext: 'Zicsr', format: 'CSRI', category: 'csr', opcode: SYSTEM, funct3: 0b110, operands: ['rd', 'csr', 'zimm'],
    summary: 'CSR read and set bits immediate', description: 'Sets the CSR bits given by a 5-bit immediate. csrsi mstatus, 8 enables interrupts.',
    example: 'csrrsi zero, mstatus, 8', semantics: [setX(CSR), setCSR(or(CSR, ZIMM), 'zimmzero')],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rs', csrImm: 1 }),
  }),
  insn({
    mnemonic: 'csrrci', ext: 'Zicsr', format: 'CSRI', category: 'csr', opcode: SYSTEM, funct3: 0b111, operands: ['rd', 'csr', 'zimm'],
    summary: 'CSR read and clear bits immediate', description: 'Clears the CSR bits given by a 5-bit immediate.',
    example: 'csrrci zero, mstatus, 8', semantics: [setX(CSR), setCSR(and(CSR, not(ZIMM)), 'zimmzero')],
    control: ctl({ regWrite: 1, wbSel: 'csr', csrOp: 'rc', csrImm: 1 }),
  }),
  insn({
    mnemonic: 'mret', ext: 'Priv', format: 'SYS', category: 'system', opcode: SYSTEM, fixedWord: 0x30200073, operands: [],
    summary: 'Return from machine-mode trap',
    description: 'Returns from a trap handler: pc ← mepc, and interrupts are re-enabled from mstatus.MPIE (MIE ← MPIE, MPIE ← 1).',
    example: 'mret', semantics: [{ k: 'mret' }], control: ctl({ sys: 'mret' }),
  }),
  insn({
    mnemonic: 'wfi', ext: 'Priv', format: 'SYS', category: 'system', opcode: SYSTEM, fixedWord: 0x10500073, operands: [],
    summary: 'Wait for interrupt',
    description: 'A hint that the hart may sleep until an interrupt is pending. This simulator fast-forwards time to the next timer interrupt, or treats wfi as a no-op if none is armed.',
    example: 'wfi', semantics: [{ k: 'wfi' }], control: ctl({ sys: 'wfi' }),
  }),
];
