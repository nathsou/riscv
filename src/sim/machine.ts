/**
 * The architectural machine: one RV32IM hart with M-mode traps, paged RAM,
 * memory-mapped devices and a built-in "operating system" that services
 * ecalls. Every mutation is journaled so execution can be reversed.
 */
import { CAUSE, CAUSE_NAMES, CSR_BY_ADDR, MIP_MEIP, MIP_MTIP, MSTATUS_MIE, MSTATUS_MPIE } from '../isa/csr.ts';
import { decode } from '../isa/decode.ts';
import type { DecodedInsn } from '../isa/decode.ts';
import { compile } from '../isa/dsl/compile.ts';
import type { Exec } from '../isa/dsl/compile.ts';
import { Trap } from '../isa/dsl/env.ts';
import type { Hart } from '../isa/dsl/env.ts';
import type { Width } from '../isa/dsl/ast.ts';
import { hex } from '../isa/bits.ts';
import { History } from './history.ts';
import { Memory } from './memory.ts';
import { EXIT_ADDR, GP_INIT, MMIO, MMIO_BASE, STACK_TOP } from './memmap.ts';

export { Trap };

export interface Segment { name: string; base: number; bytes: Uint8Array }
export interface ProgramImage { segments: Segment[]; entry: number }

export type Status = 'ready' | 'halted' | 'error' | 'waiting' | 'break';

/** Thrown internally when a syscall must wait for console input. */
export const BLOCK = Symbol('block');

interface ICacheEntry { word: number; exec: Exec; d: DecodedInsn }

/** Reset value of mtimecmp: 0x00000000_ffffffff (effectively disarmed). */
const CMP_RESET = 0xffffffff;

export class Machine implements Hart {
  readonly x = new Int32Array(32);
  pc = 0;
  nextPc = 0;
  readonly mem = new Memory();
  readonly history: History;

  // CSRs
  mstatus = 0;
  mie = 0;
  mtvec = 0;
  mscratch = 0;
  mepc = 0;
  mcause = 0;
  mtval = 0;
  mtimecmp = CMP_RESET;
  /** mtime = instret + timeSkew (wfi/sleep fast-forward time). */
  timeSkew = 0;

  instret = 0;
  cycles = 0;
  /** Executed-instruction counts by spec id (statistics; not rewound). */
  mix = new Float64Array(64);

  status: Status = 'ready';
  message = '';
  exitCode = 0;
  /** Set by the sleep syscall; the runner may pause for this many ms. */
  sleepMs = 0;

  // devices
  consoleOut = '';
  consoleIn = '';
  keys: number[] = [];
  rng = 0x2545f491;

  // last-step observations for the UI
  lastRegWrite = -1;
  lastMemWrite: { addr: number; w: number } | null = null;
  lastMemRead: { addr: number; w: number } | null = null;
  lastTrap: { cause: number; tval: number; message: string } | null = null;

  private icache = new Map<number, ICacheEntry>();
  image: ProgramImage | null = null;
  /** Invoked when console output changes (for the UI). */
  onOutput: (() => void) | null = null;

  constructor(historyCap = 1 << 18) {
    this.history = new History(historyCap);
    this.history.target = { setReg: (r, v) => this.setReg(r, v), setMem: (a, w, v) => this.setMem(a, w, v) };
  }

  // ------------------------------------------------------------ lifecycle
  loadProgram(image: ProgramImage): void {
    this.image = image;
    this.reset();
  }

  reset(): void {
    this.x.fill(0);
    this.mem.clear();
    this.history.clear();
    this.icache.clear();
    this.mstatus = 0; this.mie = 0; this.mtvec = 0; this.mscratch = 0;
    this.mepc = 0; this.mcause = 0; this.mtval = 0; this.mtimecmp = CMP_RESET; this.timeSkew = 0;
    this.instret = 0; this.cycles = 0; this.mix.fill(0);
    this.status = 'ready'; this.message = ''; this.exitCode = 0; this.sleepMs = 0;
    this.consoleOut = ''; this.consoleIn = ''; this.keys = []; this.rng = 0x2545f491;
    this.lastRegWrite = -1; this.lastMemWrite = null; this.lastMemRead = null; this.lastTrap = null;
    this.x[1] = EXIT_ADDR | 0;
    this.x[2] = STACK_TOP | 0;
    this.x[3] = GP_INIT | 0;
    if (this.image) {
      for (const s of this.image.segments) this.mem.load(s.base, s.bytes);
      this.pc = this.image.entry >>> 0;
    } else this.pc = 0;
    this.nextPc = this.pc;
    this.onOutput?.();
  }

  get mtime(): number { return this.instret + this.timeSkew; }

  // ------------------------------------------------------------ Hart API
  writeReg(rd: number, v: number): void {
    if (rd === 0) return;
    this.history.reg1(rd, this.x[rd]);
    this.x[rd] = v;
    this.lastRegWrite = rd;
  }

  load(addr: number, w: Width, signed: boolean): number {
    const n = (w >> 3) as 1 | 2 | 4;
    if (addr & (n - 1)) throw new Trap(CAUSE.misalignedLoad, addr, `Misaligned ${w}-bit load from ${hex(addr)}`);
    this.lastMemRead = { addr, w: n };
    let v: number;
    if (addr >= MMIO_BASE) v = this.mmioRead(addr, n);
    else v = this.mem.readN(addr, n);
    if (n === 1) return signed ? (v << 24) >> 24 : v & 0xff;
    if (n === 2) return signed ? (v << 16) >> 16 : v & 0xffff;
    return v | 0;
  }

  checkStore(addr: number, w: Width): void {
    const n = w >> 3;
    if (addr & (n - 1)) throw new Trap(CAUSE.misalignedStore, addr, `Misaligned ${w}-bit store to ${hex(addr)}`);
    if (addr >= MMIO_BASE && !this.mmioWritable(addr)) throw new Trap(CAUSE.storeFault, addr, `Store to read-only or unmapped device address ${hex(addr)}`);
  }

  store(addr: number, w: Width, v: number): void {
    const n = (w >> 3) as 1 | 2 | 4;
    this.lastMemWrite = { addr, w: n };
    if (addr >= MMIO_BASE) { this.mmioWrite(addr, v); return; }
    this.history.mem1(addr, n, this.mem.readN(addr, n));
    this.mem.writeN(addr, n, v);
    // self-modifying code: drop any cached decode for this word
    if (this.icache.size && this.icache.has(addr & ~3)) this.icache.delete(addr & ~3);
  }

  csrRead(addr: number): number {
    switch (addr) {
      case 0x300: return this.mstatus;
      case 0x301: return (1 << 30) | (1 << 8) | (1 << 12); // MXL=32, I, M
      case 0x304: return this.mie;
      case 0x305: return this.mtvec;
      case 0x340: return this.mscratch;
      case 0x341: return this.mepc;
      case 0x342: return this.mcause;
      case 0x343: return this.mtval;
      case 0x344: return this.mip();
      case 0xb00: case 0xc00: return this.cycles | 0;
      case 0xb80: case 0xc80: return Math.floor(this.cycles / 2 ** 32) | 0;
      case 0xb02: case 0xc02: return this.instret | 0;
      case 0xb82: case 0xc82: return Math.floor(this.instret / 2 ** 32) | 0;
      case 0xc01: return this.mtime | 0;
      case 0xc81: return Math.floor(this.mtime / 2 ** 32) | 0;
      case 0xf11: case 0xf12: case 0xf13: case 0xf14: return 0;
    }
    throw new Trap(CAUSE.illegalInstruction, addr, `Unknown CSR ${hex(addr, 3)}`);
  }

  csrWrite(addr: number, v: number): void {
    const info = CSR_BY_ADDR.get(addr);
    if (!info) throw new Trap(CAUSE.illegalInstruction, addr, `Unknown CSR ${hex(addr, 3)}`);
    if (info.readOnly) throw new Trap(CAUSE.illegalInstruction, addr, `CSR ${info.name} is read-only`);
    const old = this.csrRead(addr);
    this.history.addUndo(() => this.csrSet(addr, old));
    this.csrSet(addr, v);
  }

  /** Raw CSR update (no checks, no journaling). */
  csrSet(addr: number, v: number): void {
    switch (addr) {
      case 0x300: this.mstatus = v & (MSTATUS_MIE | MSTATUS_MPIE | (3 << 11)); break;
      case 0x304: this.mie = v & (MIP_MTIP | MIP_MEIP); break;
      case 0x305: this.mtvec = v & ~3; break;
      case 0x340: this.mscratch = v | 0; break;
      case 0x341: this.mepc = v & ~3; break;
      case 0x342: this.mcause = v | 0; break;
      case 0x343: this.mtval = v | 0; break;
      case 0xb00: this.cycles = (Math.floor(this.cycles / 2 ** 32) * 2 ** 32) + (v >>> 0); break;
      case 0xb02: this.instret = (Math.floor(this.instret / 2 ** 32) * 2 ** 32) + (v >>> 0); break;
      case 0xb80: this.cycles = (v >>> 0) * 2 ** 32 + (this.cycles % 2 ** 32); break;
      case 0xb82: this.instret = (v >>> 0) * 2 ** 32 + (this.instret % 2 ** 32); break;
    }
  }

  mip(): number {
    let p = 0;
    if (this.mtime >= this.mtimecmp) p |= MIP_MTIP;
    if (this.keys.length) p |= MIP_MEIP;
    return p;
  }

  ecall(): void {
    const a7 = this.x[17];
    if (this.syscall(a7)) return;
    if (this.mtvec) throw new Trap(CAUSE.ecallM, 0, 'Environment call');
    throw new Trap(CAUSE.ecallM, 0, `Unknown system call a7 = ${a7}`);
  }

  ebreak(): void {
    if (this.mtvec) throw new Trap(CAUSE.breakpoint, this.pc, 'Breakpoint');
    this.status = 'break';
    this.message = 'ebreak: paused (no trap handler installed)';
  }

  mret(): void {
    const old = { mstatus: this.mstatus };
    this.history.addUndo(() => { this.mstatus = old.mstatus; });
    const mpie = (this.mstatus & MSTATUS_MPIE) !== 0;
    this.mstatus = (this.mstatus & ~MSTATUS_MIE) | (mpie ? MSTATUS_MIE : 0) | MSTATUS_MPIE;
    this.nextPc = this.mepc >>> 0;
  }

  wfi(): void {
    if ((this.mie & MIP_MTIP) && this.mtime < this.mtimecmp) {
      const skew = this.timeSkew;
      this.history.addUndo(() => { this.timeSkew = skew; });
      this.timeSkew += this.mtimecmp - this.mtime;
    }
  }

  // ------------------------------------------------------------ devices
  private mmioWritable(addr: number): boolean {
    const a = (addr & ~3) >>> 0;
    return a === MMIO.CONSOLE_TX || a === MMIO.MTIMECMP || a === MMIO.MTIMECMPH;
  }

  private mmioRead(addr: number, n: number): number {
    switch ((addr & ~3) >>> 0) {
      case MMIO.CONSOLE_TX: return 0;
      case MMIO.CONSOLE_RX_READY: return this.consoleIn.length ? 1 : 0;
      case MMIO.CONSOLE_RX: {
        if (!this.consoleIn.length) return 0;
        const s = this.consoleIn;
        this.history.addUndo(() => { this.consoleIn = s; });
        this.consoleIn = s.slice(1);
        return s.charCodeAt(0) & 0xff;
      }
      case MMIO.KEY_READY: return this.keys.length ? 1 : 0;
      case MMIO.KEY_CODE: {
        if (!this.keys.length) return 0;
        const k = this.keys.slice();
        this.history.addUndo(() => { this.keys = k; });
        return this.keys.shift()!;
      }
      case MMIO.MTIME: return this.mtime | 0;
      case MMIO.MTIMEH: return Math.floor(this.mtime / 2 ** 32) | 0;
      case MMIO.MTIMECMP: return this.mtimecmp % 2 ** 32 | 0;
      case MMIO.MTIMECMPH: return Math.floor(this.mtimecmp / 2 ** 32) | 0;
      case MMIO.RANDOM: return this.nextRandom();
    }
    void n;
    throw new Trap(CAUSE.loadFault, addr, `Load from unmapped device address ${hex(addr)}`);
  }

  private mmioWrite(addr: number, v: number): void {
    switch ((addr & ~3) >>> 0) {
      case MMIO.CONSOLE_TX: this.print(String.fromCharCode(v & 0xff)); return;
      case MMIO.MTIMECMP: case MMIO.MTIMECMPH: {
        const old = this.mtimecmp;
        this.history.addUndo(() => { this.mtimecmp = old; });
        const hi = Math.floor(old / 2 ** 32), lo = old % 2 ** 32;
        this.mtimecmp = ((addr & ~3) >>> 0) === MMIO.MTIMECMP ? hi * 2 ** 32 + (v >>> 0) : (v >>> 0) * 2 ** 32 + lo;
        return;
      }
    }
  }

  private nextRandom(): number {
    const old = this.rng;
    this.history.addUndo(() => { this.rng = old; });
    let s = this.rng;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.rng = s | 0;
    return this.rng;
  }

  print(s: string): void {
    const old = this.consoleOut;
    this.history.addUndo(() => { this.consoleOut = old; this.onOutput?.(); });
    this.consoleOut = old.length > 200_000 ? old.slice(-100_000) + s : old + s;
    this.onOutput?.();
  }

  /** Called by the UI. Not journaled: input is an external event. */
  provideInput(s: string): void {
    this.consoleIn += s;
    if (this.status === 'waiting') this.status = 'ready';
  }

  pressKey(code: number): void {
    if (this.keys.length < 64) this.keys.push(code);
  }

  readCString(addr: number, max = 65536): string {
    let s = '';
    for (let i = 0; i < max; i++) {
      const b = this.mem.read8((addr + i) >>> 0);
      if (!b) break;
      s += String.fromCharCode(b);
    }
    return s;
  }

  private consumeInput(n: number): string {
    const s = this.consoleIn;
    this.history.addUndo(() => { this.consoleIn = s; });
    this.consoleIn = s.slice(n);
    return s.slice(0, n);
  }

  /** The simulated OS. Returns false for unknown call numbers. */
  private syscall(n: number): boolean {
    const a0 = this.x[10], a1 = this.x[11], a2 = this.x[12];
    switch (n) {
      case 1: this.print(String(a0 | 0)); return true;
      case 4: this.print(this.readCString(a0 >>> 0)); return true;
      case 5: {
        const nl = this.consoleIn.indexOf('\n');
        if (nl < 0) throw BLOCK;
        const line = this.consumeInput(nl + 1);
        this.writeReg(10, parseInt(line, 10) | 0);
        return true;
      }
      case 8: {
        const nl = this.consoleIn.indexOf('\n');
        if (nl < 0) throw BLOCK;
        const max = Math.max(0, (a1 | 0) - 1);
        const line = this.consumeInput(nl + 1).slice(0, max);
        for (let i = 0; i <= line.length; i++) {
          const addr = (a0 + i) >>> 0;
          this.history.mem1(addr, 1, this.mem.read8(addr));
          this.mem.write8(addr, i < line.length ? line.charCodeAt(i) & 0xff : 0);
        }
        return true;
      }
      case 10: this.halt(0); return true;
      case 11: this.print(String.fromCharCode(a0 & 0xff)); return true;
      case 12: {
        if (!this.consoleIn.length) throw BLOCK;
        this.writeReg(10, this.consumeInput(1).charCodeAt(0));
        return true;
      }
      case 17: case 93: this.halt(a0 | 0); return true;
      case 30: {
        const t = this.mtime;
        this.writeReg(10, t | 0);
        this.writeReg(11, Math.floor(t / 2 ** 32) | 0);
        return true;
      }
      case 32: this.sleepMs = Math.max(0, a0 | 0); return true;
      case 34: this.print(hex(a0)); return true;
      case 35: this.print('0b' + (a0 >>> 0).toString(2).padStart(32, '0')); return true;
      case 36: this.print(String(a0 >>> 0)); return true;
      case 40: { const old = this.rng; this.history.addUndo(() => { this.rng = old; }); this.rng = a1 | 1; return true; }
      case 41: this.writeReg(10, this.nextRandom()); return true;
      case 42: { const b = a1 >>> 0; this.writeReg(10, b ? (this.nextRandom() >>> 0) % b : 0); return true; }
      case 64: {
        const bytes = this.mem.readBytes(a1 >>> 0, Math.min(a2 >>> 0, 1 << 16));
        this.print(String.fromCharCode(...bytes));
        this.writeReg(10, bytes.length);
        return true;
      }
    }
    return false;
  }

  halt(code: number): void {
    this.status = 'halted';
    this.exitCode = code;
    this.message = `Program exited with code ${code}`;
  }

  // ------------------------------------------------------------ execution
  /** Decode (cached) the instruction at pc. Throws an illegal-instruction trap. */
  fetch(pc: number): ICacheEntry {
    const word = this.mem.read32(pc);
    const hit = this.icache.get(pc);
    if (hit && hit.word === word) return hit;
    const d = decode(word);
    if (!d) throw new Trap(CAUSE.illegalInstruction, word, `Illegal instruction ${hex(word)} at ${hex(pc)}`);
    const e = { word, exec: compile(d), d };
    this.icache.set(pc, e);
    return e;
  }

  /** Is an enabled interrupt pending? Returns its cause or 0. */
  pendingInterrupt(): number {
    if (!(this.mstatus & MSTATUS_MIE) || !this.mie) return 0;
    const p = this.mip() & this.mie;
    if (p & MIP_MEIP) return CAUSE.externalInterrupt;
    if (p & MIP_MTIP) return CAUSE.timerInterrupt;
    return 0;
  }

  /** Enter the trap handler. Returns false if no handler is installed. */
  enterTrap(cause: number, tval: number, epc: number): boolean {
    if (!this.mtvec) return false;
    const saved = [this.mstatus, this.mepc, this.mcause, this.mtval];
    this.history.addUndo(() => { [this.mstatus, this.mepc, this.mcause, this.mtval] = saved; });
    const mie = (this.mstatus & MSTATUS_MIE) !== 0;
    this.mstatus = (this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE)) | (mie ? MSTATUS_MPIE : 0) | (3 << 11);
    this.mepc = epc >>> 0;
    this.mcause = cause | 0;
    this.mtval = tval | 0;
    this.nextPc = this.mtvec >>> 0;
    return true;
  }

  /** Handle a synchronous trap raised by the current instruction. */
  takeTrap(t: Trap): void {
    this.lastTrap = { cause: t.cause, tval: t.tval, message: t.message };
    if (this.enterTrap(t.cause, t.tval, this.pc)) {
      this.pc = this.nextPc;
      this.cycles++;
      return;
    }
    this.status = 'error';
    this.message = `${CAUSE_NAMES[t.cause] ?? 'Trap'}: ${t.message}`;
  }

  /**
   * Run one journaled step. `body` performs the state changes; synchronous
   * traps and blocking syscalls are handled uniformly here, so hardware
   * engines share the exact same exception semantics as the ISA simulator.
   */
  runStep(body: () => void): void {
    if (this.status === 'halted' || this.status === 'error') return;
    if (this.status === 'break') this.status = 'ready';
    this.history.begin(this.pc, this.instret, this.cycles);
    this.lastRegWrite = -1;
    this.lastMemWrite = null;
    this.lastMemRead = null;
    this.lastTrap = null;
    try {
      body();
    } catch (err) {
      if (err instanceof Trap) this.takeTrap(err);
      else if (err === BLOCK) {
        this.status = 'waiting';
        this.message = 'Waiting for console input…';
        this.undo();
      } else throw err;
    }
  }

  /** Execute one instruction (or take one interrupt). */
  step(): void {
    this.runStep(() => {
      const pc = this.pc;
      const irq = this.pendingInterrupt();
      if (irq) {
        this.lastTrap = { cause: irq, tval: 0, message: CAUSE_NAMES[irq] };
        this.enterTrap(irq, 0, pc);
        this.pc = this.nextPc;
        this.cycles++;
        return;
      }
      if (pc === EXIT_ADDR) {
        this.halt(this.x[10]);
        this.message = `main returned ${this.x[10]}`;
        return;
      }
      if (pc & 3) throw new Trap(CAUSE.misalignedFetch, pc, `Jump to misaligned address ${hex(pc)}`);
      if (pc >= MMIO_BASE) throw new Trap(1, pc, `Instruction fetch from device memory ${hex(pc)}`);
      const e = this.fetch(pc);
      this.nextPc = (pc + 4) >>> 0;
      e.exec(this);
      this.mix[e.d.spec.id!]++;
      this.pc = this.nextPc;
      this.instret++;
      this.cycles++;
    });
  }

  /** Side-effect-free read (for datapath visualisation). */
  peekLoad(addr: number, n: number): number {
    addr >>>= 0;
    if (addr >= MMIO_BASE) {
      switch ((addr & ~3) >>> 0) {
        case MMIO.CONSOLE_RX_READY: return this.consoleIn.length ? 1 : 0;
        case MMIO.CONSOLE_RX: return this.consoleIn.length ? this.consoleIn.charCodeAt(0) & 0xff : 0;
        case MMIO.KEY_READY: return this.keys.length ? 1 : 0;
        case MMIO.KEY_CODE: return this.keys[0] ?? 0;
        case MMIO.MTIME: return this.mtime | 0;
        case MMIO.MTIMEH: return Math.floor(this.mtime / 2 ** 32) | 0;
        case MMIO.MTIMECMP: return this.mtimecmp % 2 ** 32 | 0;
        case MMIO.MTIMECMPH: return Math.floor(this.mtimecmp / 2 ** 32) | 0;
        case MMIO.RANDOM: { let s = this.rng; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; }
      }
      return 0;
    }
    return this.mem.readN(addr, n as 1 | 2 | 4);
  }

  /** Side-effect-free CSR read (unknown CSRs read as 0). */
  csrPeek(addr: number): number {
    try { return this.csrRead(addr); } catch { return 0; }
  }

  /**
   * Run up to `max` instructions, stopping at breakpoints (after the first
   * step) or when the status changes. Returns the number executed.
   */
  run(max: number, breakpoints?: Set<number>): number {
    let n = 0;
    while (n < max && this.status === 'ready') {
      if (n > 0 && breakpoints && breakpoints.size && breakpoints.has(this.pc)) break;
      this.step();
      n++;
      if (this.sleepMs) break;
    }
    return n;
  }

  // ------------------------------------------------------------ reverse
  setReg(rd: number, v: number): void { this.x[rd] = v; }
  setMem(addr: number, w: number, v: number): void {
    this.mem.writeN(addr, w as 1 | 2 | 4, v);
    this.icache.delete(addr & ~3);
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const ok = this.history.pop({
      setPc: pc => { this.pc = pc; this.nextPc = pc; },
      setReg: (r, v) => this.setReg(r, v),
      setMem: (a, w, v) => this.setMem(a, w, v),
      setCounters: (i, c) => { this.instret = i; this.cycles = c; },
    });
    if (ok) {
      if (this.status !== 'waiting') { this.status = 'ready'; this.message = ''; }
      this.lastRegWrite = -1; this.lastMemWrite = null; this.lastMemRead = null; this.lastTrap = null;
    }
    return ok;
  }
}
