/** Pseudo-instruction catalogue (documentation + expansion templates). */

export interface PseudoDoc {
  name: string;
  syntax: string;
  expansion: string;
  description: string;
}

export const PSEUDOS: PseudoDoc[] = [
  { name: 'nop', syntax: 'nop', expansion: 'addi zero, zero, 0', description: 'Do nothing for one instruction.' },
  { name: 'li', syntax: 'li rd, imm', expansion: 'addi rd, zero, imm  |  lui rd, %hi(imm); addi rd, rd, %lo(imm)', description: 'Load a 32-bit constant, using one instruction when it fits in 12 bits.' },
  { name: 'la', syntax: 'la rd, symbol', expansion: 'auipc rd, %pcrel_hi(symbol); addi rd, rd, %pcrel_lo(…)', description: 'Load the address of a symbol (position-independent).' },
  { name: 'lla', syntax: 'lla rd, symbol', expansion: 'auipc rd, %pcrel_hi(symbol); addi rd, rd, %pcrel_lo(…)', description: 'Load a local address. Same as la here.' },
  { name: 'mv', syntax: 'mv rd, rs', expansion: 'addi rd, rs, 0', description: 'Copy a register.' },
  { name: 'not', syntax: 'not rd, rs', expansion: 'xori rd, rs, -1', description: 'Bitwise complement.' },
  { name: 'neg', syntax: 'neg rd, rs', expansion: 'sub rd, zero, rs', description: 'Two’s-complement negation.' },
  { name: 'seqz', syntax: 'seqz rd, rs', expansion: 'sltiu rd, rs, 1', description: 'Set rd to 1 if rs == 0.' },
  { name: 'snez', syntax: 'snez rd, rs', expansion: 'sltu rd, zero, rs', description: 'Set rd to 1 if rs ≠ 0.' },
  { name: 'sltz', syntax: 'sltz rd, rs', expansion: 'slt rd, rs, zero', description: 'Set rd to 1 if rs < 0.' },
  { name: 'sgtz', syntax: 'sgtz rd, rs', expansion: 'slt rd, zero, rs', description: 'Set rd to 1 if rs > 0.' },
  { name: 'zext.b', syntax: 'zext.b rd, rs', expansion: 'andi rd, rs, 255', description: 'Zero-extend the low byte.' },
  { name: 'beqz', syntax: 'beqz rs, label', expansion: 'beq rs, zero, label', description: 'Branch if zero.' },
  { name: 'bnez', syntax: 'bnez rs, label', expansion: 'bne rs, zero, label', description: 'Branch if not zero.' },
  { name: 'blez', syntax: 'blez rs, label', expansion: 'bge zero, rs, label', description: 'Branch if ≤ 0.' },
  { name: 'bgez', syntax: 'bgez rs, label', expansion: 'bge rs, zero, label', description: 'Branch if ≥ 0.' },
  { name: 'bltz', syntax: 'bltz rs, label', expansion: 'blt rs, zero, label', description: 'Branch if < 0.' },
  { name: 'bgtz', syntax: 'bgtz rs, label', expansion: 'blt zero, rs, label', description: 'Branch if > 0.' },
  { name: 'bgt', syntax: 'bgt rs, rt, label', expansion: 'blt rt, rs, label', description: 'Branch if rs > rt (signed).' },
  { name: 'ble', syntax: 'ble rs, rt, label', expansion: 'bge rt, rs, label', description: 'Branch if rs ≤ rt (signed).' },
  { name: 'bgtu', syntax: 'bgtu rs, rt, label', expansion: 'bltu rt, rs, label', description: 'Branch if rs > rt (unsigned).' },
  { name: 'bleu', syntax: 'bleu rs, rt, label', expansion: 'bgeu rt, rs, label', description: 'Branch if rs ≤ rt (unsigned).' },
  { name: 'j', syntax: 'j label', expansion: 'jal zero, label', description: 'Unconditional jump.' },
  { name: 'jal', syntax: 'jal label', expansion: 'jal ra, label', description: 'Call (one-operand form).' },
  { name: 'jr', syntax: 'jr rs', expansion: 'jalr zero, 0(rs)', description: 'Jump to the address in a register.' },
  { name: 'jalr', syntax: 'jalr rs', expansion: 'jalr ra, 0(rs)', description: 'Indirect call (one-operand form).' },
  { name: 'ret', syntax: 'ret', expansion: 'jalr zero, 0(ra)', description: 'Return from a function.' },
  { name: 'call', syntax: 'call symbol', expansion: 'jal ra, symbol', description: 'Call a function. GNU as emits auipc+jalr and the linker relaxes it to jal; we emit the relaxed form.' },
  { name: 'tail', syntax: 'tail symbol', expansion: 'jal zero, symbol', description: 'Tail call (jump without saving a return address).' },
  { name: 'l{b|h|w|bu|hu}', syntax: 'lw rd, symbol', expansion: 'auipc rd, %pcrel_hi(symbol); lw rd, %pcrel_lo(…)(rd)', description: 'Load from a global symbol.' },
  { name: 's{b|h|w}', syntax: 'sw rs, symbol, rt', expansion: 'auipc rt, %pcrel_hi(symbol); sw rs, %pcrel_lo(…)(rt)', description: 'Store to a global symbol using rt as a temporary.' },
  { name: 'csrr', syntax: 'csrr rd, csr', expansion: 'csrrs rd, csr, zero', description: 'Read a CSR.' },
  { name: 'csrw', syntax: 'csrw csr, rs', expansion: 'csrrw zero, csr, rs', description: 'Write a CSR.' },
  { name: 'csrs', syntax: 'csrs csr, rs', expansion: 'csrrs zero, csr, rs', description: 'Set CSR bits.' },
  { name: 'csrc', syntax: 'csrc csr, rs', expansion: 'csrrc zero, csr, rs', description: 'Clear CSR bits.' },
  { name: 'csrwi', syntax: 'csrwi csr, uimm', expansion: 'csrrwi zero, csr, uimm', description: 'Write a CSR with a 5-bit immediate.' },
  { name: 'csrsi', syntax: 'csrsi csr, uimm', expansion: 'csrrsi zero, csr, uimm', description: 'Set CSR bits (immediate).' },
  { name: 'csrci', syntax: 'csrci csr, uimm', expansion: 'csrrci zero, csr, uimm', description: 'Clear CSR bits (immediate).' },
  { name: 'rdcycle', syntax: 'rdcycle rd', expansion: 'csrrs rd, cycle, zero', description: 'Read the cycle counter.' },
  { name: 'rdinstret', syntax: 'rdinstret rd', expansion: 'csrrs rd, instret, zero', description: 'Read the retired-instruction counter.' },
  { name: 'rdtime', syntax: 'rdtime rd', expansion: 'csrrs rd, time, zero', description: 'Read the timer.' },
];

export const PSEUDO_NAMES = new Set([
  'nop', 'li', 'la', 'lla', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz', 'zext.b',
  'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz', 'bgt', 'ble', 'bgtu', 'bleu',
  'j', 'jr', 'ret', 'call', 'tail', 'csrr', 'csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci',
  'rdcycle', 'rdcycleh', 'rdinstret', 'rdinstreth', 'rdtime', 'rdtimeh',
]);

export const DIRECTIVES: { name: string; syntax: string; description: string }[] = [
  { name: '.text', syntax: '.text', description: 'Switch to the code section (0x00000000).' },
  { name: '.data', syntax: '.data', description: 'Switch to the data section (0x10000000).' },
  { name: '.rodata', syntax: '.rodata', description: 'Read-only data (placed after .data).' },
  { name: '.bss', syntax: '.bss', description: 'Zero-initialised data (placed after .rodata).' },
  { name: '.section', syntax: '.section name', description: 'Switch to a named section (.text*, .data*, .rodata*, .bss*).' },
  { name: '.byte', syntax: '.byte expr, …', description: 'Emit 8-bit values.' },
  { name: '.half', syntax: '.half expr, …', description: 'Emit 16-bit values (also .short, .2byte).' },
  { name: '.word', syntax: '.word expr, …', description: 'Emit 32-bit values (also .long, .4byte).' },
  { name: '.dword', syntax: '.dword expr, …', description: 'Emit 64-bit values (sign-extended from 32 bits).' },
  { name: '.ascii', syntax: '.ascii "text"', description: 'Emit string bytes without a terminator.' },
  { name: '.asciz', syntax: '.asciz "text"', description: 'Emit a NUL-terminated string (also .string).' },
  { name: '.space', syntax: '.space n[, fill]', description: 'Reserve n bytes (also .zero, .skip).' },
  { name: '.align', syntax: '.align p', description: 'Align to 2^p bytes (also .p2align). Pads code with nops.' },
  { name: '.balign', syntax: '.balign n', description: 'Align to n bytes.' },
  { name: '.equ', syntax: '.equ name, expr', description: 'Define a constant symbol (also .set, .eqv).' },
  { name: '.globl', syntax: '.globl name', description: 'Mark a symbol global (accepted, no effect in a single file).' },
];
