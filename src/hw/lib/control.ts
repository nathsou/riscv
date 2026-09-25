/**
 * The main control unit as a real PLA, generated from the instruction spec:
 * an AND plane with one product term per instruction (matching its fixed
 * opcode/funct bits) and an OR plane collecting the terms for each control
 * output bit. Change the spec, and the hardware changes with it.
 */
import type { Def } from '../netlist.ts';
import { AND, OR, NOT, NOR, SPLIT, JOIN, CONST } from './gates.ts';
import { INSTRUCTIONS } from '../../isa/spec/index.ts';
import type { Control, InsnSpec } from '../../isa/spec/index.ts';
import { findSpec } from '../../isa/decode.ts';
import { ALU_OPS } from './alu.ts';

export const IMMSEL = { '-': 0, I: 0, S: 1, B: 2, U: 3, J: 4, Ish: 5 } as const;
export const IMMSEL_NAMES = ['I', 'S', 'B', 'U', 'J', 'shamt'];
export const ASEL = { rs1: 0, pc: 1, zero: 2 } as const;
export const ASEL_NAMES = ['rs1', 'pc', '0'];
export const BRTYPE = { none: 0, eq: 1, ne: 2, lt: 3, ge: 4, ltu: 5, geu: 6 } as const;
export const BRTYPE_NAMES = ['none', 'eq', 'ne', 'lt', 'ge', 'ltu', 'geu'];
export const WBSEL = { '-': 0, alu: 0, mem: 1, pc4: 2, md: 3, csr: 4 } as const;
export const WBSEL_NAMES = ['alu', 'mem', 'pc+4', 'muldiv', 'csr'];
export const CSROP = { none: 0, rw: 1, rs: 2, rc: 3 } as const;
export const SYS = { none: 0, ecall: 1, ebreak: 2, mret: 3, wfi: 4, fence: 5 } as const;
export const SYS_NAMES = ['none', 'ecall', 'ebreak', 'mret', 'wfi', 'fence'];

/** Control outputs: name, width, encoder from the spec's Control record. */
export const CONTROL_FIELDS: { name: string; width: number; enc: (c: Control) => number; doc: string }[] = [
  { name: 'regWrite', width: 1, enc: c => c.regWrite, doc: 'Write the result into register rd at the clock edge.' },
  { name: 'immSel', width: 3, enc: c => IMMSEL[c.immSel], doc: 'Which immediate format the immediate generator extracts.' },
  { name: 'aSel', width: 2, enc: c => ASEL[c.aSel], doc: 'ALU operand A: rs1, the PC, or zero.' },
  { name: 'bSel', width: 1, enc: c => (c.bSel === 'imm' ? 1 : 0), doc: 'ALU operand B: rs2 or the immediate.' },
  { name: 'aluOp', width: 4, enc: c => ALU_OPS[c.aluOp], doc: 'The ALU operation.' },
  { name: 'brType', width: 3, enc: c => BRTYPE[c.brType], doc: 'Branch condition to test (none for non-branches).' },
  { name: 'jump', width: 1, enc: c => c.jump, doc: 'Unconditional jump (jal / jalr): take the ALU result as the next PC.' },
  { name: 'memRead', width: 1, enc: c => c.memRead, doc: 'Read data memory.' },
  { name: 'memWrite', width: 1, enc: c => c.memWrite, doc: 'Write data memory at the clock edge.' },
  { name: 'wbSel', width: 3, enc: c => WBSEL[c.wbSel], doc: 'What to write back: ALU result, loaded data, pc+4, mul/div result or CSR value.' },
  { name: 'csrOp', width: 2, enc: c => CSROP[c.csrOp], doc: 'CSR operation: none, read-write, read-set, read-clear.' },
  { name: 'csrImm', width: 1, enc: c => c.csrImm, doc: 'CSR source is the 5-bit immediate instead of rs1.' },
  { name: 'sys', width: 3, enc: c => SYS[c.sys], doc: 'System operation: ecall, ebreak, mret, wfi or fence.' },
];

export function controlWord(spec: InsnSpec | undefined): number[] {
  const out = CONTROL_FIELDS.map(f => (spec ? f.enc(spec.control) : 0));
  out.push(spec ? 0 : 1); // illegal
  return out;
}

export const CONTROL: Def = {
  type: 'Control', name: 'Control unit (PLA)',
  inputs: [{ name: 'inst', width: 32 }],
  outputs: [...CONTROL_FIELDS.map(f => ({ name: f.name, width: f.width, kind: 'ctrl' as const, side: 'r' as const })), { name: 'illegal', width: 1, kind: 'ctrl' as const }],
  behave: ([w]) => controlWord(findSpec(w | 0)),
  build(b) {
    const bits = b.add(SPLIT(32), [b.in('inst')], { name: 'bits' });
    const used = new Set<number>();
    for (const s of INSTRUCTIONS) for (let i = 0; i < 32; i++) if ((s.mask >>> i) & 1) used.add(i);
    const inv = new Map<number, ReturnType<typeof b.add>[number]>();
    for (const i of [...used].sort((x, y) => x - y)) inv.set(i, b.add(NOT, [bits[i]], { name: `n${i}` })[0]);
    // AND plane: one product term per instruction
    const terms = INSTRUCTIONS.map(s => {
      const lits = [];
      for (let i = 0; i < 32; i++) if ((s.mask >>> i) & 1) lits.push((s.match >>> i) & 1 ? bits[i] : inv.get(i)!);
      return b.add(AND(lits.length), lits, { name: `term_${s.mnemonic}`, netNames: [s.mnemonic] })[0];
    });
    // OR plane: one OR per output bit
    CONTROL_FIELDS.forEach(f => {
      const outBits = [];
      for (let k = 0; k < f.width; k++) {
        const on = terms.filter((_, j) => (f.enc(INSTRUCTIONS[j].control) >> k) & 1);
        outBits.push(on.length ? b.add(OR(on.length), on, { name: `or_${f.name}${f.width > 1 ? k : ''}` })[0]
          : b.add(CONST(1, 0), [], { name: `zero_${f.name}${k}` })[0]);
      }
      b.out(f.name, f.width === 1 ? outBits[0] : b.add(JOIN(f.width), outBits, { name: `join_${f.name}` })[0]);
    });
    b.out('illegal', b.add(NOR(terms.length), terms, { name: 'nor_illegal', netNames: ['illegal'] })[0]);
  },
  interior: 'pla',
  label: i => findSpec(i.inVals[0] | 0)?.mnemonic ?? 'illegal',
  doc: 'Decodes the instruction into control signals. It is a programmable logic array generated from the instruction table: each instruction is one AND of its fixed opcode/funct bits (a row), and each control output ORs together the rows that need it.',
  level: 'PLA',
};
