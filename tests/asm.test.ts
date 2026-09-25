import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/asm/assembler.ts';
import { disassemble } from '../src/asm/disasm.ts';
import { INSTRUCTIONS } from '../src/isa/spec/index.ts';
import { words, rng } from './helpers.ts';

const GOLDEN: [string, number][] = [
  ['addi a0, a0, 1', 0x00150513],
  ['add a0, a1, a2', 0x00c58533],
  ['sub a0, a1, a2', 0x40c58533],
  ['lw a0, 8(sp)', 0x00812503],
  ['sw a0, 8(sp)', 0x00a12423],
  ['lui a0, 0x12345', 0x12345537],
  ['auipc t0, 0', 0x00000297],
  ['ret', 0x00008067],
  ['ecall', 0x00000073],
  ['ebreak', 0x00100073],
  ['mret', 0x30200073],
  ['wfi', 0x10500073],
  ['nop', 0x00000013],
  ['li a0, 10', 0x00a00513],
  ['slli a0, a0, 2', 0x00251513],
  ['srai a0, a0, 1', 0x40155513],
  ['mul a0, a1, a2', 0x02c58533],
  ['divu t0, t1, t2', 0x027352b3],
  ['rdcycle a0', 0xc0002573],
  ['csrw mtvec, t0', 0x30529073],
  ['lbu a1, -1(a0)', 0xfff54583],
  ['sb zero, 0(sp)', 0x00010023],
  ['fence', 0x0ff0000f],
  ['andi a0, a0, 0xff', 0x0ff57513],
];

test('golden encodings', () => {
  for (const [src, w] of GOLDEN) assert.equal(words(src)[0], w >>> 0, src);
});

test('branches and jumps are pc-relative', () => {
  assert.deepEqual(words('beq a0, a1, L\nnop\nL: nop'), [0x00b50463, 0x13, 0x13]);
  assert.equal(words('L: j L')[0], 0x0000006f);
  assert.equal(words('nop\nL: j .-4')[1], 0xffdff06f);
  assert.equal(words('1: nop\n j 1b')[1], 0xffdff06f);
  assert.equal(words('j 1f\n1: nop')[0], 0x0040006f);
});

test('li picks the shortest expansion with %hi/%lo rounding', () => {
  assert.equal(words('li a0, 2047').length, 1);
  assert.equal(words('li a0, 4096').length, 1); // lui only
  const w = words('li a0, 0x12345fff');
  assert.equal(w.length, 2);
  // 0x12345fff: lo = -1, hi = 0x12346
  assert.equal(w[0], 0x12346537);
  assert.equal(w[1], 0xfff50513);
});

test('la uses auipc + addi against the data section', () => {
  const r = assemble('.data\nmsg: .asciz "hi"\n.text\nla a0, msg');
  assert.ok(r.ok);
  assert.equal(r.symbols.get('msg')!.value, 0x10000000);
  const t = r.image.segments[0].bytes;
  const w0 = t[0] | (t[1] << 8) | (t[2] << 16) | (t[3] << 24);
  assert.equal((w0 >>> 12), 0x10000); // auipc a0, 0x10000
});

test('equ constants and expressions', () => {
  assert.equal(words('.equ N, 3*4+1\naddi a0, zero, N<<1')[0], words('addi a0, zero, 26')[0]);
  assert.equal(words('addi a0, zero, %lo(0x12345678)')[0], words('addi a0, zero, 0x678')[0]);
});

test('diagnostics are precise and helpful', () => {
  let r = assemble('addi a0, a0, 5000');
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0].message, /out of range.*li/);
  r = assemble('ad a0, a1, a2');
  assert.match(r.diagnostics[0].message, /did you mean/);
  assert.equal(r.diagnostics[0].from, 0);
  assert.equal(r.diagnostics[0].to, 2);
  r = assemble('j nowhere');
  assert.match(r.diagnostics[0].message, /Undefined symbol 'nowhere'/);
  assert.equal(r.diagnostics[0].from, 2);
  r = assemble('x: nop\nx: nop');
  assert.match(r.diagnostics[0].message, /already defined/);
  r = assemble('lw a0, a1');
  assert.equal(r.ok, false);
});

test('data directives', () => {
  const r = assemble('.data\n.byte 1,2\n.align 2\n.word 0xdeadbeef\n.half -1\n.asciz "A\\n"');
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  const d = r.image.segments.find(s => s.name === '.data')!.bytes;
  assert.deepEqual([...d], [1, 2, 0, 0, 0xef, 0xbe, 0xad, 0xde, 0xff, 0xff, 65, 10, 0]);
});

test('source map and listing', () => {
  const r = assemble('main:\n  li a0, 0x12345678\n  ret');
  assert.deepEqual(r.lineToAddrs.get(1), [0, 4]);
  assert.equal(r.addrToLine.get(8), 2);
  assert.equal(r.listing[0].asm.length, 2);
});

test('disassemble → assemble round-trip for random encodings', () => {
  const next = rng(42);
  let n = 0;
  for (const spec of INSTRUCTIONS) {
    for (let k = 0; k < 40; k++) {
      let w = (next() & ~spec.mask) | spec.match;
      if (spec.format === 'CSR' || spec.format === 'CSRI') w = (w & 0x000fffff) | (0x340 << 20); // mscratch
      if (spec.format === 'FENCE') w = (w & 0x0ff00000) | spec.match;
      w |= 0;
      const pc = 0x1000;
      const d = disassemble(w, pc, { pseudo: false });
      const src = `.text\n.space ${pc}\n${d.text}`;
      const r = assemble(src);
      assert.ok(r.ok, `${d.text}: ${r.diagnostics[0]?.message}`);
      const t = r.image.segments[0].bytes;
      const got = t[pc] | (t[pc + 1] << 8) | (t[pc + 2] << 16) | (t[pc + 3] << 24);
      assert.equal(got >>> 0, w >>> 0, `${d.text}`);
      n++;
    }
  }
  assert.ok(n > 1000);
});
