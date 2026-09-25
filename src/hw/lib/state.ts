/** Registers, flip-flops, register file, memories and other stateful units. */
import type { Def, Structure, Instance } from '../netlist.ts';
import { NAND, NOT, AND, SPLIT, JOIN, CONST, OR as ORN } from './gates.ts';
import { memo, MUX2, MUXN, DECODER } from './blocks.ts';
import { decodeImm } from '../../isa/formats.ts';
import type { Format } from '../../isa/formats.ts';
import { ABI_NAMES } from '../../isa/regs.ts';

const stateOf = (i: Instance) => (i.opts.state ? i.opts.state() >>> 0 : 0);

/**
 * Positive-edge master–slave D flip-flop from NAND gates. It is drawn in the
 * clock-low phase at the end of a cycle: the master latch is transparent and
 * already holds the next value; the slave holds the current output Q.
 */
export const DFF: Def = {
  type: 'DFF', name: 'D flip-flop', shape: 'reg',
  inputs: [{ name: 'd', width: 1, kind: 'ctrl' }, { name: 'clk', width: 1, kind: 'clk', side: 'b' }],
  outputs: [{ name: 'q', width: 1, kind: 'ctrl' }],
  behave: (_, inst) => [stateOf(inst) & 1],
  deps: [[]],
  delay: 2,
  sequential: true,
  build(b) {
    const d = b.in('d'), clk = b.in('clk');
    const nclk = b.add(NOT, [clk], { name: 'nclk', netNames: ['¬clk'] })[0];
    const nd = b.add(NOT, [d], { name: 'nd', netNames: ['¬d'] })[0];
    const s1 = b.add(NAND(), [d, nclk], { name: 'ms', netNames: ['S̄m'] })[0];
    const r1 = b.add(NAND(), [nd, nclk], { name: 'mr', netNames: ['R̄m'] })[0];
    const qmL = b.late(1, 'Qm', 'ctrl'), qmnL = b.late(1, 'Q̄m', 'ctrl');
    const qm = b.add(NAND(), [s1, qmnL], { name: 'mq', netNames: ['Qm'] })[0];
    const qmn = b.add(NAND(), [r1, qmL], { name: 'mqn', netNames: ['Q̄m'] })[0];
    b.bind(qmL, qm); b.bind(qmnL, qmn);
    const nqm = b.add(NOT, [qm], { name: 'nqm', netNames: ['¬Qm'] })[0];
    const s2 = b.add(NAND(), [qm, clk], { name: 'ss', netNames: ['S̄s'] })[0];
    const r2 = b.add(NAND(), [nqm, clk], { name: 'sr', netNames: ['R̄s'] })[0];
    const qL = b.late(1, 'Q', 'ctrl'), qnL = b.late(1, 'Q̄', 'ctrl');
    const q = b.add(NAND(), [s2, qnL], { name: 'sq', netNames: ['Q'] })[0];
    const qn = b.add(NAND(), [r2, qL], { name: 'sqn', netNames: ['Q̄'] })[0];
    b.bind(qL, q); b.bind(qnL, qn);
    b.out('q', q);
  },
  seed(s: Structure, inst: Instance) {
    const v = stateOf(inst) & 1;
    for (const n of s.nets) {
      if (n.name === 'Q') { n.value = v; n.prev = v; }
      if (n.name === 'Q̄') { n.value = v ^ 1; n.prev = v ^ 1; }
      if (n.name === 'Qm' || n.name === 'Q̄m') { n.value = 0; n.prev = 0; }
    }
  },
  doc: 'Stores one bit. Two latches in series (master and slave), each two cross-coupled NAND gates: while the clock is low the master follows D; on the rising edge the slave copies the master, so Q changes exactly once per cycle.',
  level: 'gates',
};

/** w-bit register with write enable. */
export const REGISTER = (w: number) => memo('reg' + w, () => ({
  type: `Register${w}`, name: `${w}-bit register`, shape: 'reg' as const,
  inputs: [{ name: 'd', width: w }, { name: 'en', width: 1, kind: 'ctrl' as const, side: 'b' as const }],
  outputs: [{ name: 'q', width: w }],
  behave: (_: number[], inst: Instance) => [stateOf(inst)],
  deps: [[]],
  delay: 2,
  sequential: true,
  build(b, inst) {
    const clk = b.add(CONST(1, 0), [], { name: 'clk', netNames: ['clk'] })[0];
    b.name(clk, 'clk', 'clk');
    const ds = b.add(SPLIT(w), [b.in('d')], { name: 'splitD' });
    const qs = [];
    for (let i = 0; i < w; i++) {
      const qL = b.late(1, `q${i}`, 'ctrl');
      const m = b.add(MUX2, [qL, ds[i], b.in('en')], { name: `mux${i}` })[0];
      const q = b.add(DFF, [m, clk], { name: `dff${i}`, state: () => (stateOf(inst) >>> i) & 1, netNames: [`q${i}`] })[0];
      b.bind(qL, q);
      qs.push(q);
    }
    b.out('q', b.add(JOIN(w), qs, { name: 'join' })[0]);
  },
  liveIn: (inp: number[]) => [!!inp[1], true],
  label: (i: Instance) => '0x' + (stateOf(i)).toString(16),
  doc: `Holds a ${w}-bit value. Each bit is a D flip-flop; a multiplexer in front of it either reloads the current value (enable = 0) or takes the new input (enable = 1).`,
  level: 'flip-flops',
}));

/** 32 × 32-bit register file with two read ports and one write port. */
export const REGFILE: Def = {
  type: 'RegFile', name: 'Register file', shape: 'box',
  inputs: [
    { name: 'ra1', width: 5, kind: 'ctrl' }, { name: 'ra2', width: 5, kind: 'ctrl' }, { name: 'wa', width: 5, kind: 'ctrl' },
    { name: 'wd', width: 32 }, { name: 'we', width: 1, kind: 'ctrl', side: 't' },
  ],
  outputs: [{ name: 'rd1', width: 32 }, { name: 'rd2', width: 32 }],
  behave: ([ra1, ra2], inst) => {
    const r = (inst.opts.regs as () => Int32Array)();
    return [r[ra1] >>> 0, r[ra2] >>> 0];
  },
  deps: [[0], [1]],
  delay: [12, 12],
  build(b, inst) {
    const regs = inst.opts.regs as () => Int32Array;
    const dec = b.add(DECODER(5), [b.in('wa')], { name: 'wdec', netNames: ['write select'] })[0];
    const lines = b.add(SPLIT(32), [dec], { name: 'lines' });
    const outs = [];
    for (let i = 0; i < 32; i++) {
      if (i === 0) { outs.push(b.add(CONST(32, 0), [], { name: 'x0', netNames: ['x0 = 0'] })[0]); continue; }
      const en = b.add(AND(), [b.in('we'), lines[i]], { name: `we${i}` })[0];
      outs.push(b.add(REGISTER(32), [b.in('wd'), en], { name: `x${i}`, state: () => regs()[i], netNames: [`x${i} ${ABI_NAMES[i]}`] })[0]);
    }
    const names = Array.from({ length: 32 }, (_, i) => `x${i}`);
    b.out('rd1', b.add(MUXN(32, 32, names), [...outs, b.in('ra1')], { name: 'read1', netNames: ['rd1'] })[0]);
    b.out('rd2', b.add(MUXN(32, 32, names), [...outs, b.in('ra2')], { name: 'read2', netNames: ['rd2'] })[0]);
  },
  liveIn: ([, , , , we], live) => [live[0], live[1], !!we, !!we, true],
  label: i => `x${i.inVals[0]}, x${i.inVals[1]}`,
  doc: '32 registers of 32 bits (x0 is wired to zero). Two read ports select registers with 32:1 multiplexers; the write port decodes rd into one enable line so only that register loads at the clock edge.',
  level: 'registers',
};

// ------------------------------------------------------------------ immediate generator
/** Bit-level description of each immediate format (for the rewiring diagram). */
export function immBitMap(fmt: Format): number[] {
  // For output bit j, the instruction bit it comes from (-1 = constant 0).
  const m: number[] = [];
  for (let j = 0; j < 32; j++) {
    let src = -1;
    switch (fmt) {
      case 'I': src = j < 11 ? 20 + j : 31; break;
      case 'S': src = j < 5 ? 7 + j : j < 11 ? 20 + j : 31; break;
      case 'B': src = j === 0 ? -1 : j < 5 ? 7 + j : j < 11 ? 20 + j : j === 11 ? 7 : 31; break;
      case 'U': src = j < 12 ? -1 : j; break;
      case 'J': src = j === 0 ? -1 : j < 11 ? 20 + j : j === 11 ? 20 : j < 20 ? j : 31; break;
      case 'Ish': src = j < 5 ? 20 + j : -1; break;
      default: src = -1;
    }
    m.push(src);
  }
  return m;
}

const IMM_WIRE = (fmt: Format, label: string) => memo('imm' + fmt, () => ({
  type: `Imm${label}`, name: `${label}-type immediate`, wiring: true, shape: 'wire' as const,
  inputs: [{ name: 'inst', width: 32, quiet: true }], outputs: [{ name: 'imm', width: 32, quiet: true }],
  behave: ([w]: number[]) => [(fmt === 'Ish' ? (w >>> 20) & 31 : decodeImm(fmt, w | 0)) >>> 0],
  size: [60, 26] as [number, number],
  interior: 'rewire',
  bitMap: immBitMap(fmt),
  doc: `Wires only: rearranges instruction bits into a 32-bit ${label} immediate${fmt === 'U' || fmt === 'Ish' ? '' : ' and copies bit 31 into the upper bits (sign extension)'}.`,
}));

export const IMMGEN: Def = {
  type: 'ImmGen', name: 'Immediate generator',
  inputs: [{ name: 'inst', width: 32 }, { name: 'immSel', width: 3, kind: 'ctrl', side: 't' }],
  outputs: [{ name: 'imm', width: 32 }],
  behave: ([w, sel]) => {
    const fmts: Format[] = ['I', 'S', 'B', 'U', 'J', 'Ish'];
    const f = fmts[sel];
    if (!f) return [0];
    return [(f === 'Ish' ? (w >>> 20) & 31 : decodeImm(f, w | 0)) >>> 0];
  },
  build(b) {
    const inst = b.in('inst');
    const fmts: [Format, string][] = [['I', 'I'], ['S', 'S'], ['B', 'B'], ['U', 'U'], ['J', 'J'], ['Ish', 'shamt']];
    const vals = fmts.map(([f, l]) => b.add(IMM_WIRE(f, l), [inst], { name: `imm${l}`, netNames: [`${l} imm`] })[0]);
    b.out('imm', b.add(MUXN(32, 6, fmts.map(f => f[1])), [...vals, b.in('immSel')], { name: 'select' })[0]);
  },
  label: i => ['I', 'S', 'B', 'U', 'J', 'shamt'][i.inVals[1]] ?? null,
  doc: 'Every format scatters the immediate differently across the instruction. The generator wires out all of them at once and a multiplexer picks the one for this format. The sign bit is always instruction bit 31, so sign extension needs no decoding.',
  level: 'wiring',
};

// ------------------------------------------------------------------ memories & units
export const IMEM: Def = {
  type: 'IMem', name: 'Instruction memory', shape: 'mem',
  inputs: [{ name: 'addr', width: 32, kind: 'addr' }],
  outputs: [{ name: 'inst', width: 32 }],
  behave: ([a], inst) => [(inst.opts.peek as (a: number) => number)(a) >>> 0],
  delay: 30,
  interior: 'imem',
  label: i => '0x' + i.inVals[0].toString(16),
  doc: 'Holds the program. Given the PC it returns the 32-bit instruction word stored there (little-endian). In this simulator it shares storage with data memory.',
};

export const DMEM: Def = {
  type: 'DMem', name: 'Data memory', shape: 'mem',
  inputs: [
    { name: 'addr', width: 32, kind: 'addr' }, { name: 'wdata', width: 32 },
    { name: 'read', width: 1, kind: 'ctrl', side: 't' }, { name: 'write', width: 1, kind: 'ctrl', side: 't' }, { name: 'funct3', width: 3, kind: 'ctrl', side: 'b' },
  ],
  outputs: [{ name: 'rdata', width: 32 }, { name: 'fault', width: 1, kind: 'ctrl', side: 'b' }],
  behave: ([addr, , rd, wr, f3], inst) => {
    const size = [1, 2, 4, 4, 1, 2, 4, 4][f3];
    const fault = (rd || wr) && addr % size !== 0 ? 1 : 0;
    if (!rd || fault) return [0, fault];
    const v = (inst.opts.peekLoad as (a: number, n: number) => number)(addr, size);
    const signed = f3 < 4;
    const x = size === 1 ? (signed ? (v << 24) >> 24 : v & 0xff) : size === 2 ? (signed ? (v << 16) >> 16 : v & 0xffff) : v;
    return [x >>> 0, fault];
  },
  deps: [[0, 2, 4], [0, 2, 3, 4]],
  delay: 30,
  interior: 'dmem',
  liveIn: ([, , rd, wr], live) => [!!(rd || wr), !!wr, true, true, !!(rd || wr) || live[0]],
  label: i => (i.inVals[3] ? 'write' : i.inVals[2] ? 'read' : null),
  doc: 'Loads and stores. funct3 gives the width (byte, half, word) and whether loads sign- or zero-extend. Writes happen at the clock edge; misaligned accesses raise a fault.',
};

export const MULDIV: Def = {
  type: 'MulDiv', name: 'Multiply / divide unit',
  inputs: [{ name: 'a', width: 32 }, { name: 'b', width: 32 }, { name: 'funct3', width: 3, kind: 'ctrl', side: 'b' }],
  outputs: [{ name: 'y', width: 32 }],
  behave: ([a, b, f], inst) => [(inst.opts.muldiv as (a: number, b: number, f: number) => number)(a, b, f) >>> 0],
  delay: 40,
  label: i => ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'][i.inVals[2]],
  doc: 'The M extension. Shown as a single-cycle combinational block; real designs use an array multiplier (a grid of full adders) and an iterative divider that takes many cycles.',
};

export const CSRFILE: Def = {
  type: 'CSRFile', name: 'Control & status registers', shape: 'box',
  inputs: [
    { name: 'csr', width: 12, kind: 'ctrl' }, { name: 'src', width: 32 }, { name: 'op', width: 2, kind: 'ctrl', side: 't' },
  ],
  outputs: [{ name: 'rdata', width: 32 }, { name: 'wval', width: 32 }, { name: 'mtvec', width: 32, kind: 'addr' }, { name: 'mepc', width: 32, kind: 'addr' }],
  behave: ([csr, src, op], inst) => {
    const read = inst.opts.csrPeek as (a: number) => number;
    const old = op ? read(csr) >>> 0 : 0;
    const w = op === 1 ? src : op === 2 ? old | src : op === 3 ? old & ~src : old;
    return [old, w >>> 0, read(0x305) >>> 0, read(0x341) >>> 0];
  },
  deps: [[0, 2], [0, 1, 2], [], []],
  delay: [8, 10, 2, 2],
  interior: 'csr',
  liveIn: ([, , op]) => [!!op, !!op, true],
  doc: 'Machine-mode CSRs (mstatus, mtvec, mepc, mcause…). csrrw/csrrs/csrrc read the old value into rd and write back a new one computed here. mtvec and mepc feed the next-PC multiplexer for traps and mret.',
};

export const NEXTPC: Def = {
  type: 'NextPC', name: 'Branch & next-PC logic',
  inputs: [
    { name: 'brType', width: 3, kind: 'ctrl' }, { name: 'jump', width: 1, kind: 'ctrl' },
    { name: 'eq', width: 1, kind: 'ctrl' }, { name: 'lt', width: 1, kind: 'ctrl' }, { name: 'ltu', width: 1, kind: 'ctrl' },
    { name: 'trap', width: 1, kind: 'ctrl' }, { name: 'mret', width: 1, kind: 'ctrl' },
  ],
  outputs: [{ name: 'pcSel', width: 2, kind: 'ctrl' }, { name: 'taken', width: 1, kind: 'ctrl' }],
  behave: ([bt, j, eq, lt, ltu, trap, mret]) => {
    const taken = [0, eq, eq ^ 1, lt, lt ^ 1, ltu, ltu ^ 1, 0][bt] ?? 0;
    const redirect = taken | j;
    const s1 = trap | mret;
    const s0 = (trap ^ 1) & (mret | redirect);
    return [(s1 << 1) | s0, taken];
  },
  build(b) {
    const lines = b.add(SPLIT(8), [b.add(DECODER(3), [b.in('brType')], { name: 'dec' })[0]], { name: 'lines' });
    const eq = b.in('eq'), lt = b.in('lt'), ltu = b.in('ltu');
    const neq = b.add(NOT, [eq], { name: 'neq' })[0], nlt = b.add(NOT, [lt], { name: 'nlt' })[0], nltu = b.add(NOT, [ltu], { name: 'nltu' })[0];
    const conds = [eq, neq, lt, nlt, ltu, nltu];
    const hits = conds.map((c, i) => b.add(AND(), [lines[i + 1], c], { name: `c${i}` })[0]);
    const taken = b.add(ORN(6), hits, { name: 'taken', netNames: ['taken'] })[0];
    const redirect = b.add(ORN(2), [taken, b.in('jump')], { name: 'redirect', netNames: ['redirect'] })[0];
    const trap = b.in('trap'), mret = b.in('mret');
    const s1 = b.add(ORN(2), [trap, mret], { name: 's1' })[0];
    const ntrap = b.add(NOT, [trap], { name: 'ntrap' })[0];
    const s0 = b.add(AND(), [ntrap, b.add(ORN(2), [mret, redirect], { name: 'm_or_r' })[0]], { name: 's0' })[0];
    b.out('pcSel', b.add(JOIN(2), [s0, s1], { name: 'join' })[0]);
    b.out('taken', taken);
  },
  label: i => ['pc+4', 'target', 'mtvec', 'mepc'][i.outVals[0]] ?? null,
  doc: 'Decides where the next instruction comes from: pc + 4, the ALU’s branch/jump target (if the branch condition holds or it is a jump), mtvec on a trap, or mepc for mret.',
  level: 'gates',
};


export const EXCEPTION: Def = {
  type: 'Exception', name: 'Exception unit',
  inputs: [
    { name: 'illegal', width: 1, kind: 'ctrl' }, { name: 'memFault', width: 1, kind: 'ctrl' }, { name: 'fetchFault', width: 1, kind: 'ctrl' },
    { name: 'irq', width: 1, kind: 'ctrl' }, { name: 'sys', width: 3, kind: 'ctrl' }, { name: 'handler', width: 1, kind: 'ctrl' },
  ],
  outputs: [{ name: 'trap', width: 1, kind: 'ctrl' }],
  behave: ([ill, mf, ff, irq, sys, hnd]) => [(ill | mf | ff | irq | (sys === 2 && hnd ? 1 : 0)) ? 1 : 0],
  build(b) {
    const sb = b.add(SPLIT(3), [b.in('sys')], { name: 'sysBits' });
    const ns0 = b.add(NOT, [sb[0]], { name: 'ns0' })[0], ns2 = b.add(NOT, [sb[2]], { name: 'ns2' })[0];
    const brk = b.add(AND(4), [ns0, sb[1], ns2, b.in('handler')], { name: 'ebreak', netNames: ['ebreak & handler'] })[0];
    b.out('trap', b.add(ORN(5), [b.in('illegal'), b.in('memFault'), b.in('fetchFault'), b.in('irq'), brk], { name: 'any', netNames: ['trap'] })[0]);
  },
  doc: 'Raises a trap for an illegal instruction, a misaligned access, a pending enabled interrupt, or ebreak when a handler is installed. (ecall is serviced by the simulated OS.)',
  level: 'gates',
};

export const PC_PLUS: Def = {
  type: 'PCPlus4', name: 'PC + 4 adder', shape: 'adder',
  inputs: [{ name: 'pc', width: 32, kind: 'addr' }],
  outputs: [{ name: 'pc4', width: 32, kind: 'addr' }],
  behave: ([pc]) => [(pc + 4) >>> 0],
  delay: 16,
  size: [50, 40],
  doc: 'An adder with one input tied to the constant 4: the address of the next sequential instruction.',
};

/** Clear bit 0 (jalr target alignment) — wiring. */
export const CLEAR_LSB: Def = {
  type: 'ClearLSB', name: '& ~1', wiring: true, shape: 'wire',
  inputs: [{ name: 'in', width: 32, quiet: true, kind: 'addr' }], outputs: [{ name: 'out', width: 32, quiet: true, kind: 'addr' }],
  behave: ([v]) => [(v & ~1) >>> 0], size: [34, 16],
  doc: 'Wires only: bit 0 of a jump target is forced to 0 (the jalr rule).',
};
