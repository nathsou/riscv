/** Disassembler built from the same spec table as the assembler. */
import { decode } from '../isa/decode.ts';
import type { DecodedInsn } from '../isa/decode.ts';
import { regName } from '../isa/regs.ts';
import { csrName } from '../isa/csr.ts';
import { hex } from '../isa/bits.ts';

export interface DisasmOptions {
  abi?: boolean;
  pseudo?: boolean;
  /** Map an address to a symbol name for branch targets. */
  symbolize?: (addr: number) => string | undefined;
}

export interface Disasm {
  text: string;
  mnemonic: string;
  operands: string;
  d?: DecodedInsn;
  target?: number;
}

export function disassemble(word: number, pc: number, opts: DisasmOptions = {}): Disasm {
  const d = decode(word);
  if (!d) return { text: `.word ${hex(word)}`, mnemonic: '.word', operands: hex(word) };
  const abi = opts.abi ?? true;
  const R = (i: number) => regName(i, abi);
  const s = d.spec;
  const tgt = (off: number) => {
    const t = (pc + off) >>> 0;
    return { t, str: opts.symbolize?.(t) ?? (off < 0 ? `.${off}` : `.+${off}`) };
  };
  let m = s.mnemonic;
  let ops: string[] = [];
  let target: number | undefined;

  switch (s.format) {
    case 'R': ops = [R(d.rd), R(d.rs1), R(d.rs2)]; break;
    case 'I':
      if (s.category === 'load' || m === 'jalr') ops = [R(d.rd), `${d.imm}(${R(d.rs1)})`];
      else ops = [R(d.rd), R(d.rs1), String(d.imm)];
      break;
    case 'Ish': ops = [R(d.rd), R(d.rs1), String(d.imm)]; break;
    case 'S': ops = [R(d.rs2), `${d.imm}(${R(d.rs1)})`]; break;
    case 'B': { const t = tgt(d.imm); target = t.t; ops = [R(d.rs1), R(d.rs2), t.str]; break; }
    case 'U': ops = [R(d.rd), hex((d.imm >>> 12) & 0xfffff, 0)]; break;
    case 'J': { const t = tgt(d.imm); target = t.t; ops = [R(d.rd), t.str]; break; }
    case 'CSR': ops = [R(d.rd), csrName(d.csr), R(d.rs1)]; break;
    case 'CSRI': ops = [R(d.rd), csrName(d.csr), String(d.rs1)]; break;
    case 'FENCE': {
      const set = (b: number) => ['i', 'o', 'r', 'w'].filter((_, i) => b & (8 >> i)).join('') || '0';
      ops = [set((d.imm >> 4) & 15), set(d.imm & 15)];
      break;
    }
    case 'SYS': ops = []; break;
  }

  if (opts.pseudo ?? true) {
    const p = pseudo(d, R, ops, target, m);
    if (p) { m = p[0]; ops = p[1]; }
  }
  const operands = ops.join(', ');
  return { text: operands ? `${m} ${operands}` : m, mnemonic: m, operands, d, target };
}

function pseudo(d: DecodedInsn, R: (i: number) => string, ops: string[], target: number | undefined, m: string): [string, string[]] | null {
  void target;
  switch (m) {
    case 'addi':
      if (d.rd === 0 && d.rs1 === 0 && d.imm === 0) return ['nop', []];
      if (d.rs1 === 0) return ['li', [R(d.rd), String(d.imm)]];
      if (d.imm === 0) return ['mv', [R(d.rd), R(d.rs1)]];
      break;
    case 'xori': if (d.imm === -1) return ['not', [R(d.rd), R(d.rs1)]]; break;
    case 'sub': if (d.rs1 === 0) return ['neg', [R(d.rd), R(d.rs2)]]; break;
    case 'sltiu': if (d.imm === 1) return ['seqz', [R(d.rd), R(d.rs1)]]; break;
    case 'sltu': if (d.rs1 === 0) return ['snez', [R(d.rd), R(d.rs2)]]; break;
    case 'beq': if (d.rs2 === 0) return ['beqz', [R(d.rs1), ops[2]]]; break;
    case 'bne': if (d.rs2 === 0) return ['bnez', [R(d.rs1), ops[2]]]; break;
    case 'jal':
      if (d.rd === 0) return ['j', [ops[1]]];
      if (d.rd === 1) return ['jal', [ops[1]]];
      break;
    case 'jalr':
      if (d.rd === 0 && d.rs1 === 1 && d.imm === 0) return ['ret', []];
      if (d.rd === 0 && d.imm === 0) return ['jr', [R(d.rs1)]];
      if (d.rd === 1 && d.imm === 0) return ['jalr', [R(d.rs1)]];
      break;
    case 'csrrs': if (d.rs1 === 0) return ['csrr', [R(d.rd), ops[1]]]; break;
    case 'csrrw': if (d.rd === 0) return ['csrw', [ops[1], R(d.rs1)]]; break;
  }
  return null;
}
