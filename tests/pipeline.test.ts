import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { assemble } from '../src/asm/assembler.ts';
import { Machine } from '../src/sim/machine.ts';
import { PipelineEngine } from '../src/hw/cpu/pipeline.ts';
import { asmOk } from './helpers.ts';

const dir = new URL('../src/content/examples/', import.meta.url);

function state(m: Machine) {
  let memHash = 0;
  for (const [no, p] of [...m.mem.pages].sort((a, b) => a[0] - b[0])) for (let i = 0; i < p.length; i++) if (p[i]) memHash = (Math.imul(memHash, 31) + p[i] * 7 + i + no * 4096) | 0;
  return { x: [...m.x], pc: m.pc, out: m.consoleOut, status: m.status, instret: m.instret, memHash, mcause: m.mcause };
}

function pipe(src: string) {
  const r = asmOk(src);
  const m = new Machine();
  m.loadProgram(r.image);
  const e = new PipelineEngine(m);
  return { m, e };
}

function runPipe(m: Machine, e: PipelineEngine, max = 100000) {
  for (let i = 0; i < max && m.status === 'ready'; i++) { e.step(); m.sleepMs = 0; }
}

for (const f of readdirSync(dir).filter(f => f.endsWith('.s')).sort()) {
  test(`pipeline ≡ ISA on ${f}`, () => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const r = assemble(src);
    assert.ok(r.ok);
    const a = new Machine(), b = new Machine();
    a.loadProgram(r.image); b.loadProgram(r.image);
    a.provideInput('6\n7\n'); b.provideInput('6\n7\n');
    const e = new PipelineEngine(b);
    for (let i = 0; i < 4000 && a.status === 'ready'; i++) { a.step(); a.sleepMs = 0; }
    for (let i = 0; i < 40000 && b.status === 'ready' && b.instret < a.instret; i++) { e.step(); b.sleepMs = 0; }
    // run until the same number of instructions have executed
    assert.deepEqual(state(b), state(a));
    if (a.instret > 20) assert.ok(b.cycles > b.instret, 'pipeline CPI should exceed 1');
  });
}

const LINE = (n: number) => Array.from({ length: n }, (_, i) => `    addi t${i % 3}, zero, ${i}`).join('\n');

test('independent instructions: N instructions take N + 4 cycles to retire the last one', () => {
  const { m, e } = pipe(`main:\n${LINE(6)}\n    ebreak\n`);
  let retired = 0, cycles = 0;
  while (retired < 6) { e.step(); cycles++; if (e.retired()) retired++; }
  assert.equal(cycles, 6 + 4);
  void m;
});

test('load-use hazard stalls exactly one cycle and forwarding resolves the rest', () => {
  const base = `main:\n    addi sp, sp, -16\n    li t0, 7\n    sw t0, 0(sp)\n`;
  const count = (body: string) => {
    const { m, e } = pipe(base + body + '\n    ebreak\n');
    let stalls = 0;
    runPipe(m, e, 200);
    for (const c of e.chart) if (c.stalled) stalls++;
    return { stalls, m };
  };
  const a = count('    lw t1, 0(sp)\n    add t2, t1, t1');
  assert.equal(a.stalls, 1);
  assert.equal(a.m.x[7], 14);
  const b = count('    lw t1, 0(sp)\n    nop\n    add t2, t1, t1');
  assert.equal(b.stalls, 0);
  assert.equal(b.m.x[7], 14);
});

test('forwarding sources are identified', () => {
  const { e } = pipe(`main:\n    addi t0, zero, 5\n    add t1, t0, t0\n    nop\n    add t2, t0, t1\n    ebreak\n`);
  const seen = new Map<string, [string?, string?]>();
  for (let i = 0; i < 12; i++) {
    e.step();
    const ex = e.state.stages[2];
    if (ex && ex.done) seen.set(ex.text, [ex.fwdA, ex.fwdB]);
  }
  assert.deepEqual(seen.get('add t1, t0, t0'), ['mem', 'mem']);
  assert.deepEqual(seen.get('add t2, t0, t1'), ['none', 'wb']);
});

test('a taken branch flushes two instructions', () => {
  const { m, e } = pipe(`main:\n    li t0, 1\n    bnez t0, skip\n    li a0, 99\n    li a0, 98\nskip:\n    li a1, 3\n    ebreak\n`);
  runPipe(m, e, 100);
  const flushedSeqs = new Set<number>();
  for (const c of e.chart) c.stages.forEach((s, i) => { if (s !== null && c.flushed[i]) flushedSeqs.add(s); });
  assert.equal(flushedSeqs.size, 2);
  assert.equal(m.x[10], 0);
  assert.equal(m.x[11], 3);
});

test('stepping back restores machine and pipeline exactly', () => {
  const src = readFileSync(new URL('03-fib.s', dir), 'utf8');
  const { m, e } = pipe(src);
  const snaps: string[] = [];
  for (let i = 0; i < 300; i++) { snaps.push(JSON.stringify([state(m), m.cycles, e.state.stages.map(s => s?.seq ?? null)])); e.step(); }
  for (let i = 299; i >= 0; i--) { assert.ok(e.undo()); assert.equal(JSON.stringify([state(m), m.cycles, e.state.stages.map(s => s?.seq ?? null)]), snaps[i], `cycle ${i}`); }
});

test('timer interrupts are precise in the pipeline', () => {
  const src = readFileSync(new URL('11-timer.s', dir), 'utf8');
  const a = new Machine(), b = new Machine();
  const r = asmOk(src);
  a.loadProgram(r.image); b.loadProgram(r.image);
  const e = new PipelineEngine(b);
  for (let i = 0; i < 3000 && a.status === 'ready'; i++) { a.step(); a.sleepMs = 0; }
  for (let i = 0; i < 30000 && b.status === 'ready' && b.instret < a.instret; i++) { e.step(); b.sleepMs = 0; }
  assert.equal(b.consoleOut, a.consoleOut);
});
