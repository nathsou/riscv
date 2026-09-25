/** Instruction decoding, driven by the spec table. */
import { INSTRUCTIONS } from './spec/index.ts';
import type { InsnSpec } from './spec/index.ts';
import { decodeFields } from './formats.ts';
import type { Decoded } from './formats.ts';

const byOpcode = new Map<number, InsnSpec[]>();
for (const s of INSTRUCTIONS) {
  const list = byOpcode.get(s.opcode) ?? [];
  list.push(s);
  byOpcode.set(s.opcode, list);
}
// Most specific (largest mask) first, so fixed-word SYS encodings win.
for (const list of byOpcode.values()) list.sort((a, b) => popcount(b.mask) - popcount(a.mask));

function popcount(x: number): number {
  x >>>= 0;
  let n = 0;
  while (x) { n += x & 1; x >>>= 1; }
  return n;
}

export function findSpec(word: number): InsnSpec | undefined {
  const list = byOpcode.get(word & 0x7f);
  if (!list) return undefined;
  for (const s of list) if ((word & s.mask) === s.match) return s;
  return undefined;
}

export interface DecodedInsn extends Decoded {
  spec: InsnSpec;
}

export function decode(word: number): DecodedInsn | undefined {
  const spec = findSpec(word);
  if (!spec) return undefined;
  return { ...decodeFields(spec.format, word), spec };
}
