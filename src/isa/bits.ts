/** Bit-vector helpers. Values are JS numbers holding 32-bit patterns. */

export const u32 = (x: number): number => x >>> 0;
export const i32 = (x: number): number => x | 0;

/** Sign-extend the low `bits` bits of x to a signed 32-bit integer. */
export function sext(x: number, bits: number): number {
  const s = 32 - bits;
  return (x << s) >> s;
}

/** Zero-extend the low `bits` bits of x. */
export function zext(x: number, bits: number): number {
  return bits >= 32 ? x >>> 0 : (x & ((1 << bits) - 1)) >>> 0;
}

/** Extract bits [hi:lo] (inclusive) of x as an unsigned number. */
export function bits(x: number, hi: number, lo: number): number {
  const w = hi - lo + 1;
  return w >= 32 ? x >>> 0 : (x >>> lo) & ((1 << w) - 1);
}

export function bit(x: number, i: number): number {
  return (x >>> i) & 1;
}

export function hex(x: number, digits = 8): string {
  return '0x' + (x >>> 0).toString(16).padStart(digits, '0');
}

export function bin(x: number, width = 32): string {
  return (x >>> 0).toString(2).padStart(width, '0').slice(-width);
}

/** Signed high 32 bits of a 64-bit product. */
export function mulh(a: number, b: number): number {
  return Number((BigInt(a | 0) * BigInt(b | 0)) >> 32n) | 0;
}
export function mulhu(a: number, b: number): number {
  return Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n) | 0;
}
export function mulhsu(a: number, b: number): number {
  return Number((BigInt(a | 0) * BigInt(b >>> 0)) >> 32n) | 0;
}

/** RISC-V division semantics (no traps): see the M-extension spec, table 7.1. */
export function div(a: number, b: number): number {
  a |= 0; b |= 0;
  if (b === 0) return -1;
  if (a === -0x80000000 && b === -1) return a;
  return (a / b) | 0;
}
export function divu(a: number, b: number): number {
  a >>>= 0; b >>>= 0;
  if (b === 0) return -1;
  return Math.floor(a / b) | 0;
}
export function rem(a: number, b: number): number {
  a |= 0; b |= 0;
  if (b === 0) return a;
  if (a === -0x80000000 && b === -1) return 0;
  return (a % b) | 0;
}
export function remu(a: number, b: number): number {
  a >>>= 0; b >>>= 0;
  if (b === 0) return a | 0;
  return (a % b) | 0;
}
