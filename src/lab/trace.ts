/** A readable account of the last architectural step and its datapath. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import { disassemble } from '../asm/disasm.ts';
import { findSpec } from '../isa/decode.ts';
import { REGS } from '../isa/regs.ts';
import { hex } from '../isa/bits.ts';

const paths: Record<string, string> = {
  arith: 'Instruction memory → registers → ALU → register file',
  logic: 'Instruction memory → registers → ALU → register file',
  shift: 'Instruction memory → registers → ALU → register file',
  compare: 'Instruction memory → registers → ALU → register file',
  upper: 'Instruction memory → immediate generator → register file',
  branch: 'Instruction memory → registers → branch decision → PC',
  jump: 'Instruction memory → next PC selection → PC and link register',
  load: 'Instruction memory → registers → address ALU → data memory → register file',
  store: 'Instruction memory → registers → address ALU → data memory',
  muldiv: 'Instruction memory → registers → multiply/divide unit → register file',
  csr: 'Instruction memory → registers → CSR file → register file',
  system: 'Instruction memory → system control',
};

export function tracePanel(): HTMLElement {
  const body = h('div', { class: 'trace', 'aria-label': 'Last executed instruction and state changes' });
  effect(() => {
    session.tick.track();
    const m = session.machine;
    const last = m.history.latest();
    if (!last) {
      body.replaceChildren(h('p', { class: 'trace-empty' }, 'Step an instruction to see what it did, what changed, and which hardware path it used.'));
      return;
    }
    const word = m.peekLoad(last.pc, 4) >>> 0;
    const spec = findSpec(word | 0);
    const line = session.loaded.peek()?.addrToLine.get(last.pc);
    const src = line !== undefined && !session.stale.peek() ? session.source.peek().split('\n')[line]?.trim() : undefined;
    const changes: HTMLElement[] = [];
    if (last.reg >= 0) changes.push(h('li', null, `${REGS[last.reg].abi} (x${last.reg}): ${hex(last.regOld)} → ${hex(m.x[last.reg])}`));
    if (last.memW) {
      const value = m.mem.readN(last.memAddr, last.memW as 1 | 2 | 4);
      changes.push(h('li', null, `${last.memW * 8}-bit memory at ${hex(last.memAddr)}: ${hex(last.memOld)} → ${hex(value)}`));
    } else if (m.lastMemWrite) changes.push(h('li', null, `Device write at ${hex(m.lastMemWrite.addr)}`));
    if (m.lastMemRead) changes.push(h('li', null, `Read ${m.lastMemRead.w * 8} bits from ${hex(m.lastMemRead.addr)}`));
    const redirected = m.pc !== ((last.pc + 4) >>> 0);
    changes.push(h('li', null, `PC: ${hex(last.pc)} → ${hex(m.pc)}${redirected ? ' (redirected)' : ''}`));
    if (m.lastTrap) changes.push(h('li', null, `Trap: ${m.lastTrap.message}`));
    const path = spec ? paths[spec.category] : 'Instruction memory → illegal instruction trap';
    body.replaceChildren(
      h('div', { class: 'trace-heading' }, h('span', null, 'Last executed'), h('strong', { class: 'mono' }, disassemble(word, last.pc).text)),
      src ? h('div', { class: 'trace-source mono' }, `Line ${line! + 1}: ${src}`) : '',
      spec ? h('p', { class: 'trace-summary' }, spec.summary) : '',
      h('div', { class: 'trace-label' }, 'Hardware path'),
      h('div', { class: 'trace-path' }, path),
      h('div', { class: 'trace-label' }, 'State changes'),
      h('ul', { class: 'trace-changes' }, changes),
      h('p', { class: 'trace-note' }, session.mode.peek() === 'pipeline'
        ? 'The pipeline diagram shows the instructions currently in each stage.'
        : 'The datapath diagram shows the next instruction at the current PC.'));
  });
  return body;
}
