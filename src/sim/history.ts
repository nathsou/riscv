/**
 * Reverse-execution journal. Each step records the architectural state it
 * overwrote in fixed-size typed-array rings; rare effects (CSR writes, device
 * side effects, syscall memory writes) register undo closures instead.
 */
export class History {
  readonly cap: number;
  private pc: Int32Array;
  private reg: Int8Array;
  private regOld: Int32Array;
  private memAddr: Int32Array;
  private memOld: Int32Array;
  private memW: Int8Array;
  private counters: Float64Array; // instret, cycles
  private extra = new Map<number, (() => void)[]>();
  /** Sequence number of the next step to be recorded. */
  seq = 0;
  /** Oldest sequence number still available. */
  oldest = 0;
  enabled = true;
  /** Receives multi-write undos; set by the owning machine. */
  target: { setReg(rd: number, v: number): void; setMem(addr: number, w: number, v: number): void } | null = null;

  constructor(cap = 1 << 18) {
    this.cap = cap;
    this.pc = new Int32Array(cap);
    this.reg = new Int8Array(cap);
    this.regOld = new Int32Array(cap);
    this.memAddr = new Int32Array(cap);
    this.memOld = new Int32Array(cap);
    this.memW = new Int8Array(cap);
    this.counters = new Float64Array(cap * 2);
  }

  get length(): number { return this.seq - this.oldest; }

  begin(pc: number, instret: number, cycles: number): void {
    if (!this.enabled) return;
    const i = this.seq % this.cap;
    if (this.seq - this.oldest >= this.cap) {
      this.extra.delete(this.oldest);
      this.oldest++;
    }
    this.pc[i] = pc;
    this.reg[i] = -1;
    this.memW[i] = 0;
    this.counters[2 * i] = instret;
    this.counters[2 * i + 1] = cycles;
    this.seq++;
  }

  private cur(): number { return (this.seq - 1) % this.cap; }

  reg1(rd: number, old: number): void {
    if (!this.enabled || this.seq === this.oldest) return;
    const i = this.cur();
    if (this.reg[i] === -1) { this.reg[i] = rd; this.regOld[i] = old; }
    else { const t = this.target; this.addUndo(() => t?.setReg(rd, old)); }
  }

  mem1(addr: number, w: number, old: number): void {
    if (!this.enabled || this.seq === this.oldest) return;
    const i = this.cur();
    if (this.memW[i] === 0) { this.memAddr[i] = addr; this.memOld[i] = old; this.memW[i] = w; }
    else { const t = this.target; this.addUndo(() => t?.setMem(addr, w, old)); }
  }

  addUndo(fn: () => void): void {
    if (!this.enabled || this.seq === this.oldest) return;
    const k = this.seq - 1;
    const list = this.extra.get(k);
    if (list) list.push(fn); else this.extra.set(k, [fn]);
  }

  /** Pop the last step, handing its saved state to `restore`. Returns false if empty. */
  pop(restore: {
    setPc(pc: number): void;
    setReg(rd: number, v: number): void;
    setMem(addr: number, w: number, v: number): void;
    setCounters(instret: number, cycles: number): void;
  }): boolean {
    if (this.seq === this.oldest) return false;
    this.seq--;
    const i = this.seq % this.cap;
    const ex = this.extra.get(this.seq);
    if (ex) { for (let k = ex.length - 1; k >= 0; k--) ex[k](); this.extra.delete(this.seq); }
    if (this.memW[i]) restore.setMem(this.memAddr[i] >>> 0, this.memW[i], this.memOld[i]);
    if (this.reg[i] >= 0) restore.setReg(this.reg[i], this.regOld[i]);
    restore.setCounters(this.counters[2 * i], this.counters[2 * i + 1]);
    restore.setPc(this.pc[i] >>> 0);
    return true;
  }

  clear(): void {
    this.seq = 0;
    this.oldest = 0;
    this.extra.clear();
  }
}

