import { assemble } from '../src/asm/assembler.ts';
import { Machine } from '../src/sim/machine.ts';

export function asmOk(src: string) {
  const r = assemble(src);
  if (!r.ok) throw new Error('assembly failed:\n' + r.diagnostics.map(d => `${d.line + 1}:${d.from}: ${d.message}`).join('\n'));
  return r;
}

export function words(src: string): number[] {
  const r = asmOk(src);
  const t = r.image.segments.find(s => s.name === '.text')!;
  const out: number[] = [];
  for (let i = 0; i < t.bytes.length; i += 4) out.push((t.bytes[i] | (t.bytes[i + 1] << 8) | (t.bytes[i + 2] << 16) | (t.bytes[i + 3] << 24)) >>> 0);
  return out;
}

export function run(src: string, max = 1_000_000): Machine {
  const r = asmOk(src);
  const m = new Machine();
  m.loadProgram(r.image);
  m.run(max);
  return m;
}

/** Tiny deterministic PRNG for property tests. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
}
