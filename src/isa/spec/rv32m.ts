import { X1, X2, setX, mul, mulhOp, mulhsuOp, mulhuOp, divOp, divuOp, remOp, remuOp } from '../dsl/ast.ts';
import type { Expr } from '../dsl/ast.ts';
import { ctl, insn } from './define.ts';
import type { InsnSpec } from './types.ts';

function m(mn: string, f3: number, e: (a: Expr, b: Expr) => Expr, summary: string, description: string, notes?: string[]): InsnSpec {
  return insn({
    mnemonic: mn, ext: 'M', format: 'R', category: 'muldiv', opcode: 0b0110011, funct3: f3, funct7: 0b0000001,
    operands: ['rd', 'rs1', 'rs2'], summary, description, notes, example: `${mn} a0, a1, a2`,
    semantics: [setX(e(X1, X2))],
    control: ctl({ regWrite: 1, aSel: 'rs1', bSel: 'rs2', wbSel: 'md' }),
  });
}

export const RV32M: InsnSpec[] = [
  m('mul', 0b000, mul, 'Multiply', 'Multiplies rs1 by rs2 and writes the low 32 bits of the product. The low half is the same for signed and unsigned operands.'),
  m('mulh', 0b001, mulhOp, 'Multiply high, signed × signed', 'Writes the upper 32 bits of the 64-bit product of rs1 and rs2, both treated as signed.'),
  m('mulhsu', 0b010, mulhsuOp, 'Multiply high, signed × unsigned', 'Writes the upper 32 bits of the product, with rs1 signed and rs2 unsigned. Used for multi-word arithmetic.'),
  m('mulhu', 0b011, mulhuOp, 'Multiply high, unsigned × unsigned', 'Writes the upper 32 bits of the product of rs1 and rs2, both unsigned.'),
  m('div', 0b100, divOp, 'Divide, signed', 'Signed integer division, rounding towards zero.',
    ['Division by zero does not trap: the result is −1 (all ones).', 'Overflow (−2³¹ ÷ −1) returns −2³¹.']),
  m('divu', 0b101, divuOp, 'Divide, unsigned', 'Unsigned integer division.', ['Division by zero returns 2³²−1.']),
  m('rem', 0b110, remOp, 'Remainder, signed', 'Remainder of signed division. The sign of the result follows the dividend.',
    ['Remainder by zero returns the dividend.', 'Overflow (−2³¹ rem −1) returns 0.']),
  m('remu', 0b111, remuOp, 'Remainder, unsigned', 'Remainder of unsigned division.', ['Remainder by zero returns the dividend.']),
];
