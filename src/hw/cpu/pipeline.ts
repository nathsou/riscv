/**
 * Classic 5-stage in-order pipeline (IF ID EX MEM WB) with full forwarding,
 * a load-use hazard unit (one-cycle stall) and branches resolved in EX
 * (predict not-taken, two-cycle flush on a redirect).
 *
 * Timing is modelled cycle by cycle. Each instruction's architectural effect
 * is applied when it is in EX, through the shared machine's own step(): every
 * older instruction has already executed by then and no younger one has, so
 * architectural state is exactly the ISA simulator's, traps are precise, and
 * results are available to forward from the moment they are computed. The
 * later stages carry the instruction to MEM and WB for display.
 */
import type { Machine } from '../../sim/machine.ts';
import type { Engine } from '../../app/session.ts';
import { decode } from '../../isa/decode.ts';
import type { DecodedInsn } from '../../isa/decode.ts';
import { disassemble } from '../../asm/disasm.ts';

export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
export type StageName = typeof STAGES[number];

export type Fwd = 'none' | 'mem' | 'wb';

export interface Slot {
  /** Program-order sequence number (unique per fetch). */
  seq: number;
  pc: number;
  word: number;
  d: DecodedInsn | null;
  text: string;
  /** Squashed by a redirect (branch taken, jump, trap). */
  flushed?: boolean;
  /** Results, filled in EX. */
  done?: boolean;
  rdVal?: number;
  aluOut?: number;
  mem?: { addr: number; w: number; write: boolean; value: number };
  fwdA?: Fwd;
  fwdB?: Fwd;
  /** Operand values as seen by EX (after forwarding). */
  opA?: number;
  opB?: number;
  redirect?: number;
  trap?: string;
}

export interface PipeState {
  stages: (Slot | null)[];
  fetchPc: number;
  /** The hazard unit is stalling IF/ID this cycle (a load in EX feeds ID). */
  stall: boolean;
  /** EX redirected the fetch this cycle (the IF and ID slots are flushed). */
  flush: boolean;
}

/** One column of the pipeline chart: which instruction was in each stage. */
export interface ChartCycle { cycle: number; stages: (number | null)[]; flushed: boolean[]; stalled: boolean }

export function readsRegs(d: DecodedInsn | null): number[] {
  if (!d) return [];
  switch (d.spec.format) {
    case 'R': case 'S': case 'B': return [d.rs1, d.rs2];
    case 'I': case 'Ish': case 'CSR': return [d.rs1];
    default: return [];
  }
}

export function writesReg(d: DecodedInsn | null): number {
  if (!d || !d.spec.control.regWrite) return 0;
  return d.rd;
}

const isLoad = (s: Slot | null) => !!s && !s.flushed && !!s.d?.spec.control.memRead;
const live = (s: Slot | null): s is Slot => !!s && !s.flushed;

export class PipelineEngine implements Engine {
  readonly kind = 'pipeline' as const;
  m: Machine;
  state: PipeState;
  chart: ChartCycle[] = [];
  /** Instructions by seq, for the chart (recent only). */
  slots = new Map<number, Slot>();
  version = 0;
  private seq = 0;
  private lastRetired = false;
  private undoRing: { state: PipeState; executed: boolean; cycles: number; chartLen: number; seq: number; retired: boolean }[] = [];

  constructor(m: Machine) {
    this.m = m;
    this.state = this.empty();
  }

  private empty(): PipeState {
    return { stages: [null, null, null, null, null], fetchPc: this.m.pc >>> 0, stall: false, flush: false };
  }

  sync(): void {
    this.state = this.empty();
    this.chart = [];
    this.slots.clear();
    this.undoRing = [];
    this.version++;
  }

  /** In-flight instructions in IF/ID have not executed; EX and later already have. Nothing to drain. */
  detach(): void { this.sync(); }

  retired(): boolean { return this.lastRetired; }

  private fetch(pc: number): Slot {
    const word = this.m.peekLoad(pc, 4) >>> 0;
    const d = decode(word | 0) ?? null;
    const s: Slot = { seq: this.seq++, pc, word, d, text: d ? disassemble(word, pc).text : `.word 0x${word.toString(16)}` };
    this.slots.set(s.seq, s);
    if (this.slots.size > 256) this.slots.delete(this.slots.keys().next().value!);
    return s;
  }

  step(): void {
    const m = this.m;
    if (m.status === 'halted' || m.status === 'error') return;
    const old = this.state;
    const [oIF, oID, oEX, oMEM] = old.stages;
    const snapshot = { state: old, executed: false, cycles: m.cycles, chartLen: this.chart.length, seq: this.seq, retired: this.lastRetired };

    // Load-use hazard: ID needs the register a load in EX is still fetching.
    const loadUse = isLoad(oEX) && live(oID) && writesReg(oEX!.d) !== 0 && readsRegs(oID.d).includes(writesReg(oEX!.d));
    const WB = oMEM, MEM = oEX;
    let EX: Slot | null, ID: Slot | null, IF: Slot | null;
    let fetchPc = old.fetchPc;
    if (loadUse) {
      EX = null; ID = oID; IF = oIF;
    } else {
      EX = live(oID) ? { ...oID } : null;
      ID = live(oIF) ? oIF : null;
      IF = this.fetch(fetchPc);
      fetchPc = (fetchPc + 4) >>> 0;
    }

    // Execute the instruction entering EX.
    let flush = false;
    if (EX) {
      if (m.pc >>> 0 !== EX.pc) {
        // Wrong path (should not happen after a correct flush): squash and refetch.
        EX = { ...EX, flushed: true };
        flush = true;
      } else {
        const instret = m.instret;
        const rr = readsRegs(EX.d);
        EX.opA = rr.length > 0 ? m.x[rr[0]] >>> 0 : undefined;
        EX.opB = rr.length > 1 ? m.x[rr[1]] >>> 0 : undefined;
        m.step();
        const st = m.status as string;
        if (st === 'waiting') return; // blocked on input: the cycle does not happen
        snapshot.executed = true;
        m.cycles = snapshot.cycles; // the pipeline owns the cycle count
        const d = EX.d;
        const rd = writesReg(d);
        EX.done = true;
        if (m.instret === instret && m.lastTrap) {
          EX.trap = m.lastTrap.message;
          if (m.lastTrap.cause < 0 || (m.lastTrap.cause >>> 31)) EX.flushed = true; // interrupted before executing
        }
        if (rd && !EX.trap) EX.rdVal = m.x[rd] >>> 0;
        if (m.lastMemWrite) EX.mem = { addr: m.lastMemWrite.addr >>> 0, w: m.lastMemWrite.w, write: true, value: m.peekLoad(m.lastMemWrite.addr, m.lastMemWrite.w) >>> 0 };
        else if (m.lastMemRead) EX.mem = { addr: m.lastMemRead.addr >>> 0, w: m.lastMemRead.w, write: false, value: EX.rdVal ?? 0 };
        // forwarding sources for the operands (for display)
        const fwd = (r: number): Fwd => {
          if (!r) return 'none';
          if (live(MEM) && writesReg(MEM.d) === r) return 'mem';
          if (live(WB) && writesReg(WB.d) === r) return 'wb';
          return 'none';
        };
        const regs = readsRegs(d);
        EX.fwdA = regs.length > 0 ? fwd(regs[0]) : 'none';
        EX.fwdB = regs.length > 1 ? fwd(regs[1]) : 'none';
        if (m.pc >>> 0 !== ((EX.pc + 4) >>> 0)) { EX.redirect = m.pc >>> 0; flush = true; }
        this.slots.set(EX.seq, EX);
      }
    }
    if (flush) {
      if (ID) ID = { ...ID, flushed: true };
      if (IF) IF = { ...IF, flushed: true };
      fetchPc = m.pc >>> 0;
    }
    const stages = [IF, ID, EX, MEM, WB];
    const next: PipeState = { stages, fetchPc, stall: false, flush };
    next.stall = !flush && isLoad(EX) && live(ID) && writesReg(EX!.d) !== 0 && readsRegs(ID.d).includes(writesReg(EX!.d));
    this.state = next;
    m.cycles = snapshot.cycles + 1;
    this.lastRetired = live(WB) && !!WB.done;
    this.chart.push({ cycle: m.cycles, stages: stages.map(s => (s ? s.seq : null)), flushed: stages.map(s => !!s?.flushed), stalled: loadUse });
    if (this.chart.length > 400) this.chart.splice(0, 100);
    this.undoRing.push(snapshot);
    if (this.undoRing.length > 20000) this.undoRing.splice(0, 5000);
    // A halted program drains: nothing more to fetch.
    this.version++;
  }

  undo(): boolean {
    const u = this.undoRing.pop();
    if (!u) return false;
    if (u.executed && !this.m.undo()) return false;
    this.state = u.state;
    this.m.cycles = u.cycles;
    if (this.chart.length >= u.chartLen) this.chart.length = u.chartLen;
    this.seq = u.seq;
    this.lastRetired = u.retired;
    this.version++;
    return true;
  }
}
