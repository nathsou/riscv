import {
  X1, X2, IMM, SHAMT, PC, c, add, sub, and, or, xor, sll, srl, sra, ltS, ltU,
  load, setX, setPC, iff, store,
} from '../dsl/ast.ts';
import type { BinOp, Expr, Width } from '../dsl/ast.ts';
import { ctl, insn } from './define.ts';
import type { AluOp, BrType, InsnSpec } from './types.ts';

const OP = 0b0110011, OP_IMM = 0b0010011, LOAD = 0b0000011, STORE = 0b0100011;
const BRANCH = 0b1100011, JAL = 0b1101111, JALR = 0b1100111, LUI = 0b0110111, AUIPC = 0b0010111;
const SYSTEM = 0b1110011, MISC_MEM = 0b0001111;

function rType(m: string, f3: number, f7: number, aluOp: AluOp, e: (a: Expr, b: Expr) => Expr,
  cat: InsnSpec['category'], summary: string, description: string, example: string, notes?: string[]): InsnSpec {
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'R', category: cat, opcode: OP, funct3: f3, funct7: f7,
    operands: ['rd', 'rs1', 'rs2'], summary, description, example, notes,
    semantics: [setX(e(X1, X2))],
    control: ctl({ regWrite: 1, aSel: 'rs1', bSel: 'rs2', aluOp, wbSel: 'alu' }),
  });
}

function iType(m: string, f3: number, aluOp: AluOp, e: (a: Expr, b: Expr) => Expr,
  cat: InsnSpec['category'], summary: string, description: string, example: string, notes?: string[]): InsnSpec {
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'I', category: cat, opcode: OP_IMM, funct3: f3,
    operands: ['rd', 'rs1', 'imm12'], summary, description, example, notes,
    semantics: [setX(e(X1, IMM))],
    control: ctl({ regWrite: 1, immSel: 'I', aSel: 'rs1', bSel: 'imm', aluOp, wbSel: 'alu' }),
  });
}

function shiftImm(m: string, f3: number, f7: number, aluOp: AluOp, e: (a: Expr, b: Expr) => Expr, summary: string, description: string, example: string): InsnSpec {
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'Ish', category: 'shift', opcode: OP_IMM, funct3: f3, funct7: f7,
    operands: ['rd', 'rs1', 'shamt'], summary, description, example,
    semantics: [setX(e(X1, SHAMT))],
    control: ctl({ regWrite: 1, immSel: 'Ish', aSel: 'rs1', bSel: 'imm', aluOp, wbSel: 'alu' }),
  });
}

function loadI(m: string, f3: number, w: Width, signed: boolean, summary: string, description: string): InsnSpec {
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'I', category: 'load', opcode: LOAD, funct3: f3,
    operands: ['rd', 'mem'], summary, description, example: `${m} a0, 4(sp)`,
    notes: w > 8 ? [`The address must be ${w / 8}-byte aligned; a misaligned address raises a load-address-misaligned trap in this machine.`] : undefined,
    semantics: [setX(load(w, signed, add(X1, IMM)))],
    control: ctl({
      regWrite: 1, immSel: 'I', aSel: 'rs1', bSel: 'imm', aluOp: 'add', memRead: 1,
      memWidth: w === 8 ? 'b' : w === 16 ? 'h' : 'w', memSigned: signed ? 1 : 0, wbSel: 'mem',
    }),
  });
}

function storeS(m: string, f3: number, w: Width, summary: string, description: string): InsnSpec {
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'S', category: 'store', opcode: STORE, funct3: f3,
    operands: ['rs2', 'mem'], summary, description, example: `${m} a0, 8(sp)`,
    notes: w > 8 ? [`The address must be ${w / 8}-byte aligned; a misaligned address raises a store-address-misaligned trap in this machine.`] : undefined,
    semantics: [store(w, add(X1, IMM), X2)],
    control: ctl({ immSel: 'S', aSel: 'rs1', bSel: 'imm', aluOp: 'add', memWrite: 1, memWidth: w === 8 ? 'b' : w === 16 ? 'h' : 'w' }),
  });
}

function branch(m: string, f3: number, op: BinOp, brType: BrType, summary: string, description: string): InsnSpec {
  const cond: Expr = { k: 'bin', op, a: X1, b: X2 };
  return insn({
    mnemonic: m, ext: 'RV32I', format: 'B', category: 'branch', opcode: BRANCH, funct3: f3,
    operands: ['rs1', 'rs2', 'branch'], summary, description, example: `${m} a0, a1, loop`,
    notes: ['The offset is a signed multiple of 2 relative to this instruction, giving a range of ±4 KiB.'],
    semantics: [iff(cond, setPC(add(PC, IMM)))],
    control: ctl({ immSel: 'B', aSel: 'pc', bSel: 'imm', aluOp: 'add', brType }),
  });
}

export const RV32I: InsnSpec[] = [
  // ---- upper immediates ----
  insn({
    mnemonic: 'lui', ext: 'RV32I', format: 'U', category: 'upper', opcode: LUI, operands: ['rd', 'uimm20'],
    summary: 'Load upper immediate',
    description: 'Places the 20-bit immediate in the top 20 bits of rd and fills the low 12 bits with zeros. Together with addi it builds any 32-bit constant.',
    example: 'lui a0, 0x12345', semantics: [setX(IMM)],
    control: ctl({ regWrite: 1, immSel: 'U', aSel: 'zero', bSel: 'imm', aluOp: 'add', wbSel: 'alu' }),
  }),
  insn({
    mnemonic: 'auipc', ext: 'RV32I', format: 'U', category: 'upper', opcode: AUIPC, operands: ['rd', 'uimm20'],
    summary: 'Add upper immediate to PC',
    description: 'Adds the 20-bit upper immediate (shifted left by 12) to the address of this instruction and writes the sum to rd. It is the basis of position-independent addressing (la, call).',
    example: 'auipc t0, %pcrel_hi(msg)', semantics: [setX(add(PC, IMM))],
    control: ctl({ regWrite: 1, immSel: 'U', aSel: 'pc', bSel: 'imm', aluOp: 'add', wbSel: 'alu' }),
  }),
  // ---- jumps ----
  insn({
    mnemonic: 'jal', ext: 'RV32I', format: 'J', category: 'jump', opcode: JAL, operands: ['rd', 'jump'],
    summary: 'Jump and link',
    description: 'Writes the address of the next instruction (pc+4) to rd, then jumps to pc + offset. With rd = ra it is a function call; with rd = zero it is a plain jump (j).',
    example: 'jal ra, func', notes: ['Range is ±1 MiB relative to this instruction.'],
    semantics: [setX(add(PC, c(4))), setPC(add(PC, IMM))],
    control: ctl({ regWrite: 1, immSel: 'J', aSel: 'pc', bSel: 'imm', aluOp: 'add', jump: 1, wbSel: 'pc4' }),
  }),
  insn({
    mnemonic: 'jalr', ext: 'RV32I', format: 'I', category: 'jump', opcode: JALR, funct3: 0, operands: ['rd', 'mem'],
    summary: 'Jump and link register',
    description: 'Jumps to (rs1 + offset) with the lowest bit cleared, and writes pc+4 to rd. It is used for returns (ret = jalr zero, 0(ra)), indirect calls and jump tables.',
    example: 'jalr ra, 0(t0)',
    notes: ['The target is computed from the old value of rs1, so jalr ra, 0(ra) works as expected.', 'Bit 0 of the target is cleared.'],
    semantics: [setX(add(PC, c(4))), setPC(and(add(X1, IMM), c(~1)))],
    control: ctl({ regWrite: 1, immSel: 'I', aSel: 'rs1', bSel: 'imm', aluOp: 'add', jump: 1, wbSel: 'pc4' }),
  }),
  // ---- branches ----
  branch('beq', 0b000, 'eq', 'eq', 'Branch if equal', 'Jumps to pc + offset if rs1 equals rs2.'),
  branch('bne', 0b001, 'ne', 'ne', 'Branch if not equal', 'Jumps to pc + offset if rs1 differs from rs2.'),
  branch('blt', 0b100, 'ltS', 'lt', 'Branch if less than', 'Jumps to pc + offset if rs1 < rs2, comparing as signed two’s-complement numbers.'),
  branch('bge', 0b101, 'geS', 'ge', 'Branch if greater or equal', 'Jumps to pc + offset if rs1 ≥ rs2, comparing as signed numbers.'),
  branch('bltu', 0b110, 'ltU', 'ltu', 'Branch if less than, unsigned', 'Jumps to pc + offset if rs1 < rs2, comparing as unsigned numbers.'),
  branch('bgeu', 0b111, 'geU', 'geu', 'Branch if greater or equal, unsigned', 'Jumps to pc + offset if rs1 ≥ rs2, comparing as unsigned numbers.'),
  // ---- loads / stores ----
  loadI('lb', 0b000, 8, true, 'Load byte', 'Loads an 8-bit value from memory, sign-extends it to 32 bits and writes it to rd.'),
  loadI('lh', 0b001, 16, true, 'Load halfword', 'Loads a 16-bit value from memory, sign-extends it and writes it to rd.'),
  loadI('lw', 0b010, 32, true, 'Load word', 'Loads a 32-bit little-endian value from memory into rd.'),
  loadI('lbu', 0b100, 8, false, 'Load byte, unsigned', 'Loads an 8-bit value from memory, zero-extends it and writes it to rd.'),
  loadI('lhu', 0b101, 16, false, 'Load halfword, unsigned', 'Loads a 16-bit value from memory, zero-extends it and writes it to rd.'),
  storeS('sb', 0b000, 8, 'Store byte', 'Stores the low 8 bits of rs2 to memory at rs1 + offset.'),
  storeS('sh', 0b001, 16, 'Store halfword', 'Stores the low 16 bits of rs2 to memory at rs1 + offset.'),
  storeS('sw', 0b010, 32, 'Store word', 'Stores the 32-bit value of rs2 to memory at rs1 + offset (little-endian).'),
  // ---- register-immediate ----
  iType('addi', 0b000, 'add', add, 'arith', 'Add immediate', 'Adds the sign-extended 12-bit immediate to rs1. Overflow wraps around silently. addi rd, rs1, 0 is mv; addi zero, zero, 0 is nop.', 'addi a0, a0, 1',
    ['There is no subi: use addi with a negative immediate.']),
  iType('slti', 0b010, 'slt', ltS, 'compare', 'Set if less than immediate', 'Writes 1 to rd if rs1 < imm (signed), otherwise 0.', 'slti t0, a0, 10'),
  iType('sltiu', 0b011, 'sltu', ltU, 'compare', 'Set if less than immediate, unsigned', 'Writes 1 to rd if rs1 < imm, comparing as unsigned numbers. The immediate is sign-extended first, then treated as unsigned. sltiu rd, rs1, 1 is seqz.', 'sltiu t0, a0, 1'),
  iType('xori', 0b100, 'xor', xor, 'logic', 'XOR immediate', 'Bitwise exclusive-or of rs1 and the sign-extended immediate. xori rd, rs1, -1 is not.', 'xori a0, a0, -1'),
  iType('ori', 0b110, 'or', or, 'logic', 'OR immediate', 'Bitwise or of rs1 and the sign-extended immediate.', 'ori a0, a0, 0xff'),
  iType('andi', 0b111, 'and', and, 'logic', 'AND immediate', 'Bitwise and of rs1 and the sign-extended immediate, often used as a mask.', 'andi a0, a0, 0xff'),
  shiftImm('slli', 0b001, 0b0000000, 'sll', sll, 'Shift left logical immediate', 'Shifts rs1 left by shamt (0–31) bits, filling with zeros. Multiplies by 2^shamt.', 'slli a0, a0, 2'),
  shiftImm('srli', 0b101, 0b0000000, 'srl', srl, 'Shift right logical immediate', 'Shifts rs1 right by shamt bits, filling with zeros (unsigned divide by 2^shamt).', 'srli a0, a0, 4'),
  shiftImm('srai', 0b101, 0b0100000, 'sra', sra, 'Shift right arithmetic immediate', 'Shifts rs1 right by shamt bits, copying the sign bit into the vacated bits. For negative numbers this rounds towards −∞.', 'srai a0, a0, 1'),
  // ---- register-register ----
  rType('add', 0b000, 0b0000000, 'add', add, 'arith', 'Add', 'Adds rs1 and rs2. Overflow is ignored: the result is the low 32 bits of the sum.', 'add a0, a1, a2'),
  rType('sub', 0b000, 0b0100000, 'sub', sub, 'arith', 'Subtract', 'Subtracts rs2 from rs1, ignoring overflow. The hardware computes rs1 + ~rs2 + 1.', 'sub a0, a1, a2'),
  rType('sll', 0b001, 0b0000000, 'sll', sll, 'shift', 'Shift left logical', 'Shifts rs1 left by the amount in the low 5 bits of rs2.', 'sll a0, a0, t0', ['Only rs2[4:0] is used: shifting by 33 shifts by 1.']),
  rType('slt', 0b010, 0b0000000, 'slt', ltS, 'compare', 'Set if less than', 'Writes 1 to rd if rs1 < rs2 (signed), else 0.', 'slt t0, a0, a1'),
  rType('sltu', 0b011, 0b0000000, 'sltu', ltU, 'compare', 'Set if less than, unsigned', 'Writes 1 to rd if rs1 < rs2 (unsigned), else 0. sltu rd, zero, rs2 is snez.', 'sltu t0, a0, a1'),
  rType('xor', 0b100, 0b0000000, 'xor', xor, 'logic', 'Exclusive or', 'Bitwise exclusive-or of rs1 and rs2.', 'xor a0, a0, a1'),
  rType('srl', 0b101, 0b0000000, 'srl', srl, 'shift', 'Shift right logical', 'Shifts rs1 right by rs2[4:0] bits, filling with zeros.', 'srl a0, a0, t0'),
  rType('sra', 0b101, 0b0100000, 'sra', sra, 'shift', 'Shift right arithmetic', 'Shifts rs1 right by rs2[4:0] bits, replicating the sign bit.', 'sra a0, a0, t0'),
  rType('or', 0b110, 0b0000000, 'or', or, 'logic', 'Or', 'Bitwise or of rs1 and rs2.', 'or a0, a0, a1'),
  rType('and', 0b111, 0b0000000, 'and', and, 'logic', 'And', 'Bitwise and of rs1 and rs2.', 'and a0, a0, a1'),
  // ---- misc ----
  insn({
    mnemonic: 'fence', ext: 'RV32I', format: 'FENCE', category: 'system', opcode: MISC_MEM, funct3: 0, operands: ['fence'],
    summary: 'Memory fence',
    description: 'Orders memory accesses from other harts and devices. This machine has a single in-order hart, so fence behaves as a no-op.',
    example: 'fence rw, rw', semantics: [{ k: 'fence' }], control: ctl({ sys: 'fence' }),
  }),
  insn({
    mnemonic: 'ecall', ext: 'RV32I', format: 'SYS', category: 'system', opcode: SYSTEM, fixedWord: 0x00000073, operands: [],
    summary: 'Environment call',
    description: 'Requests a service from the execution environment. If mtvec is 0, the simulator acts as the OS and performs the system call selected by a7 (print, read, exit…). Otherwise the hart traps to mtvec with mcause = 11.',
    example: 'li a7, 10\necall', semantics: [{ k: 'ecall' }], control: ctl({ sys: 'ecall' }),
  }),
  insn({
    mnemonic: 'ebreak', ext: 'RV32I', format: 'SYS', category: 'system', opcode: SYSTEM, fixedWord: 0x00100073, operands: [],
    summary: 'Breakpoint',
    description: 'Hands control to a debugger. If there is no trap handler the simulator pauses here; otherwise it traps with mcause = 3.',
    example: 'ebreak', semantics: [{ k: 'ebreak' }], control: ctl({ sys: 'ebreak' }),
  }),
];
