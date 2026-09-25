/** Instruction formats: field layouts, immediate encoding and decoding. */
import { bits, sext } from './bits.ts';

export type Format = 'R' | 'I' | 'Ish' | 'S' | 'B' | 'U' | 'J' | 'CSR' | 'CSRI' | 'SYS' | 'FENCE';

export type FieldKind = 'opcode' | 'funct' | 'rd' | 'rs1' | 'rs2' | 'imm' | 'csr' | 'fixed';

export interface Field {
  name: string;
  hi: number;
  lo: number;
  kind: FieldKind;
}

const OPC: Field = { name: 'opcode', hi: 6, lo: 0, kind: 'opcode' };
const RD: Field = { name: 'rd', hi: 11, lo: 7, kind: 'rd' };
const F3: Field = { name: 'funct3', hi: 14, lo: 12, kind: 'funct' };
const RS1: Field = { name: 'rs1', hi: 19, lo: 15, kind: 'rs1' };
const RS2: Field = { name: 'rs2', hi: 24, lo: 20, kind: 'rs2' };

export const FORMAT_FIELDS: Record<Format, Field[]> = {
  R: [{ name: 'funct7', hi: 31, lo: 25, kind: 'funct' }, RS2, RS1, F3, RD, OPC],
  I: [{ name: 'imm[11:0]', hi: 31, lo: 20, kind: 'imm' }, RS1, F3, RD, OPC],
  Ish: [{ name: 'funct7', hi: 31, lo: 25, kind: 'funct' }, { name: 'shamt', hi: 24, lo: 20, kind: 'imm' }, RS1, F3, RD, OPC],
  S: [{ name: 'imm[11:5]', hi: 31, lo: 25, kind: 'imm' }, RS2, RS1, F3, { name: 'imm[4:0]', hi: 11, lo: 7, kind: 'imm' }, OPC],
  B: [
    { name: 'imm[12]', hi: 31, lo: 31, kind: 'imm' }, { name: 'imm[10:5]', hi: 30, lo: 25, kind: 'imm' }, RS2, RS1, F3,
    { name: 'imm[4:1]', hi: 11, lo: 8, kind: 'imm' }, { name: 'imm[11]', hi: 7, lo: 7, kind: 'imm' }, OPC,
  ],
  U: [{ name: 'imm[31:12]', hi: 31, lo: 12, kind: 'imm' }, RD, OPC],
  J: [
    { name: 'imm[20]', hi: 31, lo: 31, kind: 'imm' }, { name: 'imm[10:1]', hi: 30, lo: 21, kind: 'imm' },
    { name: 'imm[11]', hi: 20, lo: 20, kind: 'imm' }, { name: 'imm[19:12]', hi: 19, lo: 12, kind: 'imm' }, RD, OPC,
  ],
  CSR: [{ name: 'csr', hi: 31, lo: 20, kind: 'csr' }, RS1, F3, RD, OPC],
  CSRI: [{ name: 'csr', hi: 31, lo: 20, kind: 'csr' }, { name: 'uimm[4:0]', hi: 19, lo: 15, kind: 'imm' }, F3, RD, OPC],
  SYS: [{ name: 'funct12', hi: 31, lo: 20, kind: 'funct' }, { name: 'rs1', hi: 19, lo: 15, kind: 'fixed' }, F3, { name: 'rd', hi: 11, lo: 7, kind: 'fixed' }, OPC],
  FENCE: [
    { name: 'fm', hi: 31, lo: 28, kind: 'funct' }, { name: 'pred', hi: 27, lo: 24, kind: 'imm' }, { name: 'succ', hi: 23, lo: 20, kind: 'imm' },
    { name: 'rs1', hi: 19, lo: 15, kind: 'fixed' }, F3, { name: 'rd', hi: 11, lo: 7, kind: 'fixed' }, OPC,
  ],
};

/** The underlying base format (for grouping in the reference). */
export const BASE_FORMAT: Record<Format, 'R' | 'I' | 'S' | 'B' | 'U' | 'J'> = {
  R: 'R', I: 'I', Ish: 'I', S: 'S', B: 'B', U: 'U', J: 'J', CSR: 'I', CSRI: 'I', SYS: 'I', FENCE: 'I',
};

/** Decode the (sign-extended) immediate of a word in the given format. */
export function decodeImm(format: Format, w: number): number {
  switch (format) {
    case 'I': case 'SYS': return w >> 20;
    case 'Ish': return bits(w, 24, 20);
    case 'CSR': case 'CSRI': return bits(w, 31, 20);
    case 'FENCE': return bits(w, 27, 20);
    case 'S': return ((w >> 25) << 5) | bits(w, 11, 7);
    case 'B': return sext((bit(w, 31) << 12) | (bit(w, 7) << 11) | (bits(w, 30, 25) << 5) | (bits(w, 11, 8) << 1), 13);
    case 'U': return (w & 0xfffff000) | 0;
    case 'J': return sext((bit(w, 31) << 20) | (bits(w, 19, 12) << 12) | (bit(w, 20) << 11) | (bits(w, 30, 21) << 1), 21);
    case 'R': return 0;
  }
}

function bit(w: number, i: number) { return (w >>> i) & 1; }

/** Place an immediate into its bit positions (other fields zero). */
export function encodeImm(format: Format, imm: number): number {
  switch (format) {
    case 'I': case 'SYS': case 'CSR': return (imm & 0xfff) << 20;
    case 'Ish': return (imm & 0x1f) << 20;
    case 'CSRI': return 0;
    case 'FENCE': return (imm & 0xff) << 20;
    case 'S': return (((imm >> 5) & 0x7f) << 25) | ((imm & 0x1f) << 7);
    case 'B': return (bit(imm, 12) << 31) | (bits(imm, 10, 5) << 25) | (bits(imm, 4, 1) << 8) | (bit(imm, 11) << 7);
    case 'U': return imm & 0xfffff000;
    case 'J': return (bit(imm, 20) << 31) | (bits(imm, 10, 1) << 21) | (bit(imm, 11) << 20) | (bits(imm, 19, 12) << 12);
    case 'R': return 0;
  }
}

export interface Decoded {
  word: number;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  csr: number;
}

export function decodeFields(format: Format, w: number): Decoded {
  return {
    word: w,
    rd: bits(w, 11, 7),
    rs1: bits(w, 19, 15),
    rs2: bits(w, 24, 20),
    imm: decodeImm(format, w),
    csr: bits(w, 31, 20),
  };
}

/** Immediate range, in bytes/value, accepted by the assembler for each format. */
export function immRange(format: Format): [number, number] {
  switch (format) {
    case 'I': case 'S': return [-2048, 2047];
    case 'Ish': return [0, 31];
    case 'B': return [-4096, 4094];
    case 'J': return [-(1 << 20), (1 << 20) - 2];
    case 'U': return [0, 0xfffff];
    case 'CSRI': return [0, 31];
    default: return [-2048, 2047];
  }
}
