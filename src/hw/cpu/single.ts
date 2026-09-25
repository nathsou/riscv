/**
 * Single-cycle RV32IM datapath (CS61C / Patterson & Hennessy style), built
 * from the module library, plus the engine that clocks it against the
 * shared architectural machine.
 */
import { Instance, evalRoot, SOURCE } from '../netlist.ts';
import type { Def, Net, Structure } from '../netlist.ts';
import { SLICE, OR, SPLIT, CONST } from '../lib/gates.ts';
import { MUXN } from '../lib/blocks.ts';
import { ALU, BRANCH_COMP } from '../lib/alu.ts';
import { CONTROL, IMMSEL_NAMES, ASEL_NAMES, WBSEL_NAMES } from '../lib/control.ts';
import { REGISTER, REGFILE, IMMGEN, IMEM, DMEM, MULDIV, CSRFILE, NEXTPC, EXCEPTION, PC_PLUS, CLEAR_LSB } from '../lib/state.ts';
import type { Machine } from '../../sim/machine.ts';
import { Trap } from '../../sim/machine.ts';
import { EXIT_ADDR, MMIO_BASE } from '../../sim/memmap.ts';
import { evalBin } from '../../isa/dsl/ast.ts';
import { CSR_BY_ADDR, CAUSE } from '../../isa/csr.ts';
import { findSpec } from '../../isa/decode.ts';
import { hex } from '../../isa/bits.ts';
import type { Engine } from '../../app/session.ts';

const MD_OPS = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'] as const;

export function machineOpts(m: Machine) {
  return {
    regs: () => m.x,
    peek: (a: number) => m.peekLoad(a, 4),
    peekLoad: (a: number, n: number) => m.peekLoad(a, n),
    csrPeek: (a: number) => m.csrPeek(a),
    muldiv: (a: number, b: number, f: number) => evalBin(MD_OPS[f], a | 0, b | 0),
  };
}

/** Hand-placed layout of the top-level datapath. */
const LAYOUT: Record<string, [number, number, number?, number?]> = {
  pcMux: [40, 300, 28, 110],
  pc: [110, 318, 64, 74],
  pc4: [240, 150, 56, 44],
  fetchFault: [230, 470, 30, 20],
  imem: [240, 290, 120, 130],
  f_rd: [420, 262], f_rs1: [420, 300], f_rs2: [420, 330], f_f3: [420, 480], f_csr: [420, 560], f_zimm: [420, 590],
  control: [470, 16, 140, 230],
  regfile: [480, 280, 140, 150],
  immgen: [490, 470, 120, 60],
  exception: [1040, 60, 100, 100],
  irq: [960, 120],
  handler: [960, 150],
  bcomp: [690, 180, 100, 76],
  nextpc: [850, 150, 110, 110],
  aMux: [720, 300, 26, 80],
  bMux: [720, 400, 26, 60],
  alu: [800, 300, 90, 150],
  clr: [930, 250],
  csrSrc: [700, 560, 26, 60],
  muldiv: [800, 490, 90, 70],
  csr: [800, 590, 110, 90],
  dmem: [960, 300, 130, 150],
  wbMux: [1160, 290, 30, 170],
};

export const SINGLE_CPU: Def = {
  type: 'SingleCycleCPU', name: 'Single-cycle RV32IM CPU', shape: 'box',
  // Feedback paths (next PC, write-back) are late-bound: iterate to a fixed point.
  sequential: true,
  inputs: [], outputs: [],
  behave: () => [],
  build(b, inst) {
    const m = inst.opts.machine as Machine;
    const mo = machineOpts(m);
    const pcSelL = b.late(2, 'pcSel', 'ctrl');
    const aluL = b.late(32, 'alu', 'data');
    const wbL = b.late(32, 'wb', 'data');
    const mtvecL = b.late(32, 'mtvec', 'addr');
    const mepcL = b.late(32, 'mepc', 'addr');
    const clrL = b.late(32, 'target', 'addr');
    const one = b.add(CONST(1, 1), [], { name: 'one' })[0];

    // ---- fetch
    const pcNextL = b.late(32, 'pcNext', 'addr');
    const [pc] = b.add(REGISTER(32), [pcNextL, one], { name: 'pc', state: () => m.pc, netNames: ['pc'] });
    b.name(pc, 'pc', 'addr');
    const [pc4] = b.add(PC_PLUS, [pc], { name: 'pc4', netNames: ['pc+4'] });
    const [inst32] = b.add(IMEM, [pc], { name: 'imem', netNames: ['inst'], ...mo });
    const pcLow = b.add(SPLIT(32), [pc], { name: 'pcbits' });
    const [fetchFault] = b.add(OR(), [pcLow[0], pcLow[1]], { name: 'fetchFault', netNames: ['misaligned pc'] });
    const [pcNext] = b.add(MUXN(32, 4, ['pc+4', 'target', 'mtvec', 'mepc']), [pc4, clrL, mtvecL, mepcL, pcSelL], { name: 'pcMux', netNames: ['next pc'] });
    b.bind(pcNextL, pcNext);

    // ---- decode
    const [rd] = b.add(SLICE(32, 11, 7), [inst32], { name: 'f_rd', netNames: ['rd'] });
    const [rs1] = b.add(SLICE(32, 19, 15), [inst32], { name: 'f_rs1', netNames: ['rs1'] });
    const [rs2] = b.add(SLICE(32, 24, 20), [inst32], { name: 'f_rs2', netNames: ['rs2'] });
    const [f3] = b.add(SLICE(32, 14, 12), [inst32], { name: 'f_f3', netNames: ['funct3'] });
    const [csrA] = b.add(SLICE(32, 31, 20), [inst32], { name: 'f_csr', netNames: ['csr'] });
    const [zimm] = b.add(SLICE(32, 19, 15), [inst32], { name: 'f_zimm', netNames: ['uimm'] });
    const ctl = b.add(CONTROL, [inst32], {
      name: 'control',
      netNames: ['regWrite', 'immSel', 'aSel', 'bSel', 'aluOp', 'brType', 'jump', 'memRead', 'memWrite', 'wbSel', 'csrOp', 'csrImm', 'sys', 'illegal'],
    });
    const [regWrite, immSel, aSel, bSel, aluOp, brType, jump, memRead, memWrite, wbSel, csrOp, csrImm, sys, illegal] = ctl;
    const [rd1, rd2] = b.add(REGFILE, [rs1, rs2, rd, wbL, regWrite], { name: 'regfile', netNames: ['rs1 value', 'rs2 value'], regs: mo.regs });
    const [imm] = b.add(IMMGEN, [inst32, immSel], { name: 'immgen', netNames: ['imm'] });

    // ---- execute
    const [eq, lt, ltu] = b.add(BRANCH_COMP, [rd1, rd2], { name: 'bcomp', netNames: ['eq', 'lt', 'ltu'] });
    const zero32 = b.add(CONST(32, 0), [], { name: 'zero' })[0];
    const [A] = b.add(MUXN(32, 3, ASEL_NAMES), [rd1, pc, zero32, aSel], { name: 'aMux', netNames: ['A'] });
    const [B] = b.add(MUXN(32, 2, ['rs2', 'imm']), [rd2, imm, bSel], { name: 'bMux', netNames: ['B'] });
    const [alu] = b.add(ALU, [A, B, aluOp], { name: 'alu', netNames: ['alu result'] });
    b.bind(aluL, alu);
    const [target] = b.add(CLEAR_LSB, [alu], { name: 'clr', netNames: ['target'] });
    b.bind(clrL, target);
    const [md] = b.add(MULDIV, [rd1, rd2, f3], { name: 'muldiv', netNames: ['mul/div'], muldiv: mo.muldiv });
    const zimm32 = b.add(CONCATZ, [zimm], { name: 'zimmExt' })[0];
    const [csrSrc] = b.add(MUXN(32, 2, ['rs1', 'uimm']), [rd1, zimm32, csrImm], { name: 'csrSrc', netNames: ['csr source'] });
    const [csrOut, , mtvec, mepc] = b.add(CSRFILE, [csrA, csrSrc, csrOp], { name: 'csr', netNames: ['csr value', 'csr new', 'mtvec', 'mepc'], csrPeek: mo.csrPeek });
    b.bind(mtvecL, mtvec);
    b.bind(mepcL, mepc);

    // ---- memory
    const [mdata, memFault] = b.add(DMEM, [alu, rd2, memRead, memWrite, f3], { name: 'dmem', netNames: ['load data', 'mem fault'], peekLoad: mo.peekLoad });

    // ---- exceptions & next pc
    const [irq] = b.add(SOURCE('irq', 1, 'ctrl', 'An enabled interrupt is pending (mstatus.MIE and mie & mip).'), [], { name: 'irq', state: () => (m.pendingInterrupt() ? 1 : 0) });
    const [handler] = b.add(SOURCE('mtvec≠0', 1, 'ctrl', 'A trap handler is installed.'), [], { name: 'handler', state: () => (m.mtvec ? 1 : 0) });
    const [trap] = b.add(EXCEPTION, [illegal, memFault, fetchFault, irq, sys, handler], { name: 'exception', netNames: ['trap'] });
    const [isMret] = b.add(IS_MRET, [sys], { name: 'isMret', netNames: ['mret'] });
    const [pcSel] = b.add(NEXTPC, [brType, jump, eq, lt, ltu, trap, isMret], { name: 'nextpc', netNames: ['pcSel', 'taken'] });
    b.bind(pcSelL, pcSel);

    // ---- write back
    const [wb] = b.add(MUXN(32, 5, WBSEL_NAMES), [alu, mdata, pc4, md, csrOut, wbSel], { name: 'wbMux', netNames: ['write-back'] });
    b.bind(wbL, wb);
  },
  layout(s: Structure) {
    for (const n of s.nodes) {
      const p = LAYOUT[n.inst.name];
      if (!p) continue;
      n.x = p[0]; n.y = p[1];
      if (p[2]) n.w = p[2];
      if (p[3]) n.h = p[3];
    }
    const hide = new Set(['one', 'zero', 'pcbits', 'zimmExt', 'isMret']);
    for (const n of s.nodes) if (hide.has(n.inst.name)) { n.w = 0; n.h = 0; n.x = -999; }
    s.w = 1230;
    s.h = 700;
    s.laidOut = true;
  },
  doc: 'Every instruction completes in one long clock cycle: fetch, decode, execute, memory and write-back all happen combinationally, and the PC, register file and memory update together at the clock edge.',
  level: 'datapath',
};

const CONCATZ: Def = {
  type: 'ZeroExt5', name: 'zero-extend', wiring: true, shape: 'wire',
  inputs: [{ name: 'in', width: 5, quiet: true }], outputs: [{ name: 'out', width: 32, quiet: true }],
  behave: ([v]) => [v & 31], size: [20, 12],
};

const IS_MRET: Def = {
  type: 'IsMret', name: 'sys = mret', inputs: [{ name: 'sys', width: 3, kind: 'ctrl' }], outputs: [{ name: 'y', width: 1, kind: 'ctrl' }],
  behave: ([s]) => [s === 3 ? 1 : 0], delay: 1, size: [20, 14],
};

export interface Signals { [name: string]: number }

/** Read named top-level signals. */
export function signals(s: Structure): Signals {
  const out: Signals = {};
  for (const n of s.nets) out[n.name] = n.value;
  return out;
}

export class SingleCycleEngine implements Engine {
  readonly kind = 'single' as const;
  m: Machine;
  cpu: Instance;
  private lastRetired = true;
  /** Incremented after every evaluation (the visualiser watches it). */
  version = 0;

  constructor(m: Machine) {
    this.m = m;
    this.cpu = new Instance(SINGLE_CPU, 'cpu', null, { machine: m });
    this.evaluate();
  }

  get structure(): Structure { return this.cpu.structure!; }

  evaluate(): void {
    evalRoot(this.cpu);
    this.version++;
  }

  sync(): void { this.evaluate(); }
  detach(): void {}
  retired(): boolean { return this.lastRetired; }

  undo(): boolean {
    const ok = this.m.undo();
    this.evaluate();
    return ok;
  }

  step(): void {
    const m = this.m;
    const s = this.structure;
    const v = (name: string) => (s.net(name) as Net).value;
    this.lastRetired = false;
    m.runStep(() => {
      const pc = m.pc;
      if (pc === EXIT_ADDR) { m.halt(m.x[10]); m.message = `main returned ${m.x[10]}`; return; }
      const word = v('inst');
      const spec = findSpec(word | 0);
      if (v('trap')) {
        const irq = m.pendingInterrupt();
        let cause: number, tval = 0, msg: string;
        if (irq) { cause = irq; msg = 'Interrupt'; }
        else if (v('misaligned pc')) { cause = CAUSE.misalignedFetch; tval = pc; msg = `Jump to misaligned address ${hex(pc)}`; }
        else if (v('illegal')) { cause = CAUSE.illegalInstruction; tval = word; msg = `Illegal instruction ${hex(word)} at ${hex(pc)}`; }
        else if (v('mem fault')) { cause = v('memWrite') ? CAUSE.misalignedStore : CAUSE.misalignedLoad; tval = v('alu result'); msg = `Misaligned access to ${hex(tval)}`; }
        else { cause = CAUSE.breakpoint; tval = pc; msg = 'Breakpoint'; }
        if (irq) {
          m.lastTrap = { cause, tval, message: msg };
          m.enterTrap(cause, tval, pc);
          m.pc = m.nextPc;
          m.cycles++;
          return;
        }
        throw new Trap(cause, tval, msg);
      }
      if (pc >= MMIO_BASE) throw new Trap(1, pc, `Instruction fetch from device memory ${hex(pc)}`);
      m.nextPc = v('next pc');
      const sys = v('sys');
      const csrOp = v('csrOp');
      if (csrOp) {
        const addr = v('csr');
        const info = CSR_BY_ADDR.get(addr);
        if (!info) throw new Trap(CAUSE.illegalInstruction, addr, `Unknown CSR ${hex(addr, 3)}`);
        const src = v('csrImm') ? v('uimm') : v('rs1');
        if (csrOp === 1 || src !== 0) m.csrWrite(addr, v('csr new'));
      }
      if (sys === 1) m.ecall();
      else if (sys === 2) m.ebreak();
      else if (sys === 4) m.wfi();
      else if (sys === 3) m.mret();
      const f3 = v('funct3');
      const width = ([8, 16, 32, 32, 8, 16, 32, 32] as const)[f3];
      if (v('memWrite')) {
        const addr = v('alu result');
        m.checkStore(addr, width);
        m.store(addr, width, v('rs2 value'));
      }
      let wd = v('write-back');
      if (v('memRead')) {
        const addr = v('alu result');
        if (addr >= MMIO_BASE) {
          const real = m.load(addr, width, f3 < 4);
          if (v('wbSel') === 1) wd = real;
        } else m.lastMemRead = { addr, w: width >> 3 };
      }
      if (v('regWrite') && v('rd') && !(sys === 1)) m.writeReg(v('rd'), wd);
      m.pc = sys === 3 ? m.nextPc : v('next pc');
      m.instret++;
      m.cycles++;
      if (spec) m.mix[spec.id!]++;
      this.lastRetired = true;
    });
    if (m.status !== 'ready' && m.status !== 'break') this.lastRetired = true;
    this.evaluate();
  }
}

export const SIGNAL_NAMES = { immSel: IMMSEL_NAMES, aSel: ASEL_NAMES, wbSel: WBSEL_NAMES };
