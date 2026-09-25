import type { Control, InsnSpec } from './types.ts';

export const NOCTL: Control = {
  regWrite: 0, immSel: '-', aSel: 'rs1', bSel: 'rs2', aluOp: 'add', brType: 'none', jump: 0,
  memRead: 0, memWrite: 0, memWidth: 'w', memSigned: 0, wbSel: '-', csrOp: 'none', csrImm: 0, sys: 'none',
};

export function ctl(c: Partial<Control>): Control {
  return { ...NOCTL, ...c };
}

type Def = Omit<InsnSpec, 'mask' | 'match'>;

/** Finalise a definition: compute the decode mask/match from its fixed fields. */
export function insn(d: Def): InsnSpec {
  let mask = 0x7f;
  let match = d.opcode;
  if (d.fixedWord !== undefined) {
    mask = 0xffffffff | 0;
    match = d.fixedWord | 0;
  } else {
    if (d.funct3 !== undefined) { mask |= 0x7 << 12; match |= d.funct3 << 12; }
    if (d.funct7 !== undefined) { mask |= 0x7f << 25; match |= d.funct7 << 25; }
  }
  return { ...d, mask: mask | 0, match: match | 0 };
}
