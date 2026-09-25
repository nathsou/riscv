import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { assemble } from '../src/asm/assembler.ts';
import { Machine } from '../src/sim/machine.ts';

const dir = new URL('../src/content/examples/', import.meta.url);
const expected: Record<string, { out?: string | RegExp; input?: string; runsForever?: boolean }> = {
  '01-hello.s': { out: 'Hello, RISC-V!\n' },
  '02-sum.s': { out: '55' },
  '03-fib.s': { out: '55' },
  '04-bubble.s': { out: '-3, 0, 5, 7, 14, 19, 23, 42, 61, 88\n' },
  '05-primes.s': { out: /^2 3 5 7 11 13 .* 197 199 $/ },
  '06-strings.s': { out: '13\nNUF SI V-CSIR' },
  '07-echo.s': { input: '6\n7\n', out: 'First number: Second number: Product: 42' },
  '08-mandelbrot.s': {},
  '09-life.s': { runsForever: true },
  '10-snake.s': { runsForever: true },
  '11-timer.s': { out: 'tick 1\ntick 2\ntick 3\ntick 4\ntick 5\n' },
  '12-traps.s': { out: /trap: mcause=2 .*\ntrap: mcause=4 .*mtval=0x10000002\ntrap: mcause=3 / },
  '13-hazards.s': { out: '12' },
  '14-factorial.s': { out: '12! = 479001600\n0xffffffff × 0xffffffff = 0xfffffffe0x00000001\n' },
};

for (const f of readdirSync(dir).filter(f => f.endsWith('.s')).sort()) {
  test(`example ${f}`, () => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const r = assemble(src);
    assert.ok(r.ok, r.diagnostics.map(d => `${d.line + 1}: ${d.message}`).join('\n'));
    const m = new Machine();
    m.loadProgram(r.image);
    const exp = expected[f] ?? {};
    if (exp.input) m.provideInput(exp.input);
    for (let i = 0; i < 400 && m.status === 'ready'; i++) { m.run(50_000); m.sleepMs = 0; }
    if (exp.runsForever) { assert.equal(m.status, 'ready', m.message); return; }
    assert.equal(m.status, 'halted', `${m.message} (pc=${m.pc.toString(16)})`);
    if (typeof exp.out === 'string') assert.equal(m.consoleOut, exp.out);
    else if (exp.out) assert.match(m.consoleOut, exp.out);
  });
}
