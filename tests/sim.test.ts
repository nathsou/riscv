import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine, Trap } from '../src/sim/machine.ts';
import { INSTRUCTIONS } from '../src/isa/spec/index.ts';
import { decode } from '../src/isa/decode.ts';
import { interpret } from '../src/isa/dsl/interp.ts';
import type { Width } from '../src/isa/dsl/ast.ts';
import { asmOk, run, rng } from './helpers.ts';

test('hello world via ecall', () => {
  const m = run(`
    .data
    msg: .asciz "Hello, RISC-V!\\n"
    .text
    main:
      la a0, msg
      li a7, 4
      ecall
      li a0, 42
      li a7, 1
      ecall
      li a7, 10
      ecall`);
  assert.equal(m.status, 'halted');
  assert.equal(m.consoleOut, 'Hello, RISC-V!\n42');
});

test('recursive fibonacci using the stack', () => {
  const m = run(`
    main:
      li a0, 15
      call fib
      li a7, 1
      ecall
      li a7, 10
      ecall
    fib:
      li t0, 2
      blt a0, t0, 1f
      addi sp, sp, -16
      sw ra, 12(sp)
      sw s0, 8(sp)
      sw s1, 4(sp)
      mv s0, a0
      addi a0, s0, -1
      call fib
      mv s1, a0
      addi a0, s0, -2
      call fib
      add a0, a0, s1
      lw ra, 12(sp)
      lw s0, 8(sp)
      lw s1, 4(sp)
      addi sp, sp, 16
    1: ret`);
  assert.equal(m.consoleOut, '610');
});

test('main returning halts cleanly', () => {
  const m = run('main: li a0, 7\n ret');
  assert.equal(m.status, 'halted');
  assert.equal(m.exitCode, 7);
});

test('self-checking ALU / memory / M-extension program', () => {
  // Each check: compute into a0, compare with t6; on mismatch exit(test number).
  const checks: [string, number][] = [
    ['li a1, 0x7fffffff\n addi a0, a1, 1', 0x80000000 | 0],
    ['li a1, -8\n srai a0, a1, 1', -4],
    ['li a1, -8\n srli a0, a1, 28', 0xf],
    ['li a1, 1\n li a2, 33\n sll a0, a1, a2', 2],
    ['li a1, -1\n li a2, 1\n sltu a0, a1, a2', 0],
    ['li a1, -1\n li a2, 1\n slt a0, a1, a2', 1],
    ['li a1, -7\n li a2, 2\n div a0, a1, a2', -3],
    ['li a1, -7\n li a2, 2\n rem a0, a1, a2', -1],
    ['li a1, 5\n li a2, 0\n div a0, a1, a2', -1],
    ['li a1, 5\n li a2, 0\n remu a0, a1, a2', 5],
    ['li a1, 0x80000000\n li a2, -1\n div a0, a1, a2', 0x80000000 | 0],
    ['li a1, 0x80000000\n li a2, -1\n rem a0, a1, a2', 0],
    ['li a1, -1\n li a2, -1\n mulhu a0, a1, a2', -2],
    ['li a1, -1\n li a2, -1\n mulh a0, a1, a2', 0],
    ['li a1, -2\n li a2, 3\n mulhsu a0, a1, a2', -1],
    ['li a1, 0x12345678\n sw a1, 0(gp)\n lb a0, 3(gp)', 0x12],
    ['li a1, 0x80\n sb a1, 0(gp)\n lb a0, 0(gp)', -128],
    ['li a1, 0x80\n sb a1, 0(gp)\n lbu a0, 0(gp)', 128],
    ['li a1, 0xbeef\n sh a1, 2(gp)\n lh a0, 2(gp)', 0xffffbeef | 0],
    ['auipc a0, 0\n auipc a1, 0\n sub a0, a1, a0', 4],
    ['la a1, 1f\n jalr a0, 0(a1)\n 1: sub a0, a0, a1', 0],
  ];
  let src = 'main:\n';
  checks.forEach(([code, expect], i) => {
    src += `  ${code}\n  li t6, ${expect}\n  li a7, 93\n  li s11, ${i + 1}\n  bne a0, t6, fail\n`;
  });
  src += '  li a0, 0\n  li a7, 93\n  ecall\nfail:\n  mv a0, s11\n  ecall\n';
  const m = run(src);
  assert.equal(m.status, 'halted', m.message);
  assert.equal(m.exitCode, 0, `check ${m.exitCode} failed`);
});

test('misaligned load traps without a handler; handled with mtvec', () => {
  let m = run('li a1, 2\n lw a0, 0(a1)');
  assert.equal(m.status, 'error');
  assert.match(m.message, /misaligned/i);
  m = run(`
    main:
      la t0, handler
      csrw mtvec, t0
      li a1, 2
      lw a0, 0(a1)
      li a7, 93
      ecall
    handler:
      csrr a0, mcause
      csrr t1, mepc
      addi t1, t1, 4
      csrw mepc, t1
      mret`);
  assert.equal(m.status, 'halted');
  assert.equal(m.exitCode, 4);
});

test('timer interrupt fires and wfi fast-forwards time', () => {
  const m = run(`
    .equ MTIMECMP, 0xffff0028
    main:
      la t0, handler
      csrw mtvec, t0
      li t0, MTIMECMP
      li t1, 1000
      sw t1, 0(t0)
      li t1, 0x80
      csrw mie, t1
      csrsi mstatus, 8
      li s0, 0
    loop:
      wfi
      beqz s0, loop
      li a7, 93
      csrr a0, mcause
      ecall
    handler:
      li s0, 1
      li t0, MTIMECMP
      li t1, -1
      sw t1, 0(t0)
      mret`);
  assert.equal(m.status, 'halted', m.message);
  assert.equal(m.exitCode, 0x80000007 | 0);
});

test('reverse execution restores the exact initial state', () => {
  const r = asmOk(`
    .data
    buf: .space 64
    .text
    main:
      la s0, buf
      li t0, 0
    1: sw t0, 0(s0)
      sb t0, 7(s0)
      addi s0, s0, 4
      addi t0, t0, 1
      li a0, 'x'
      li a7, 11
      ecall
      li t1, 10
      blt t0, t1, 1b
      li a7, 10
      ecall`);
  const m = new Machine();
  m.loadProgram(r.image);
  const snap = () => JSON.stringify({ x: [...m.x], pc: m.pc, mem: [...m.mem.readBytes(0x10000000, 64)], out: m.consoleOut, i: m.instret });
  const s0 = snap();
  m.run(1000);
  assert.equal(m.consoleOut, 'xxxxxxxxxx');
  while (m.undo()) { /* rewind */ }
  assert.equal(snap(), s0);
});

const SKIP = Symbol('skip');

test('differential: compiled executor == reference interpreter', () => {
  const next = rng(7);
  const specs = INSTRUCTIONS.filter(s => !['system', 'csr'].includes(s.category));
  for (let iter = 0; iter < 20000; iter++) {
    const spec = specs[next() % specs.length];
    const word = ((next() & ~spec.mask) | spec.match) | 0;
    const d = decode(word)!;
    assert.equal(d.spec, spec);
    const m = new Machine();
    m.pc = 0x1000;
    for (let r = 1; r < 32; r++) {
      const k = next() % 4;
      m.x[r] = k === 0 ? 0x10000000 + (next() % 256) * 4 : k === 1 ? (next() % 64) - 32 : next() | 0;
    }
    for (let a = 0; a < 1024; a += 4) m.mem.write32(0x10000000 + a, next());
    m.mem.write32(0x1000, word);
    const pre = { x: Int32Array.from(m.x), pc: m.pc };
    let eff: ReturnType<typeof interpret> | null = null;
    let refTrap = false;
    try {
      eff = interpret(d, {
        x: i => pre.x[i], pc: pre.pc,
        load: (addr: number, w: Width, signed: boolean) => {
          if (addr >= 0xff000000) throw SKIP;
          if (addr % (w / 8)) throw new Trap(4, addr, '');
          const v = m.mem.readN(addr, (w / 8) as 1 | 2 | 4);
          return w === 32 ? v | 0 : signed ? (v << (32 - w)) >> (32 - w) : v;
        },
        csr: () => 0,
      });
      if (eff.store && eff.store.addr >= 0xff000000) continue;
      if (eff.store && eff.store.addr % (eff.store.w / 8)) refTrap = true;
      if (!refTrap && eff.pc & 3) refTrap = true; // (pc misalignment is detected at the next fetch)
    } catch (e) {
      if (e === SKIP) continue;
      if (!(e instanceof Trap)) throw e;
      refTrap = true;
    }
    m.step();
    if (refTrap) {
      if (eff && !(eff.store && eff.store.addr % (eff.store.w / 8))) continue; // misaligned target: fetch traps later
      assert.equal(m.status, 'error', `${spec.mnemonic} should trap`);
      continue;
    }
    assert.equal(m.status, 'ready', `${spec.mnemonic}: ${m.message}`);
    assert.equal(m.pc, eff!.pc >>> 0, `${spec.mnemonic} pc`);
    for (let r = 1; r < 32; r++) {
      const expect = eff!.rd && eff!.rd.reg === r ? eff!.rd.value : pre.x[r];
      assert.equal(m.x[r], expect | 0, `${spec.mnemonic} x${r}`);
    }
    if (eff!.store) {
      const n = (eff!.store.w / 8) as 1 | 2 | 4;
      const mask = n === 4 ? -1 : (1 << (8 * n)) - 1;
      assert.equal(m.mem.readN(eff!.store.addr, n) & mask, eff!.store.value & mask, `${spec.mnemonic} store`);
    }
  }
});
