/** Full-page datapath: the diagram plus the current instruction, its control word and the selected block. */
import { h, clear, append } from '../ui/h.ts';
import type { Child } from '../ui/h.ts';

const set = (el: Element, ...kids: Child[]) => { clear(el); append(el, kids); };
import { effect } from '../ui/reactive.ts';
import { icon } from '../ui/icons.ts';
import { session } from '../app/session.ts';
import { controls, statusPill } from '../lab/toolbar.ts';
import { mountDatapathPanel } from './panel.ts';
import { bitfield } from '../ui/components/bitfield.ts';
import { findSpec } from '../isa/decode.ts';
import { disassemble } from '../asm/disasm.ts';
import { SingleCycleEngine } from '../hw/cpu/single.ts';
import { CONTROL_FIELDS, IMMSEL_NAMES, ASEL_NAMES, BRTYPE_NAMES, WBSEL_NAMES, SYS_NAMES } from '../hw/lib/control.ts';
import { ALU_OP_NAMES } from '../hw/lib/alu.ts';
import { fmtVal } from './renderer.ts';

const DECODE: Record<string, (v: number) => string> = {
  immSel: v => IMMSEL_NAMES[v] ?? '?',
  aSel: v => ASEL_NAMES[v] ?? '?',
  bSel: v => (v ? 'imm' : 'rs2'),
  aluOp: v => ALU_OP_NAMES[v] ?? '?',
  brType: v => BRTYPE_NAMES[v] ?? '?',
  wbSel: v => WBSEL_NAMES[v] ?? '?',
  csrOp: v => ['none', 'rw', 'rs', 'rc'][v] ?? '?',
  sys: v => SYS_NAMES[v] ?? '?',
};

export function mount(el: HTMLElement): void {
  const dpHost = h('section', { class: 'panel dp-panel' });
  const insn = h('div', { class: 'panel-body dpv-insn' });
  const ctl = h('div', { class: 'panel-body' });
  const sel = h('div', { class: 'panel-body dpv-sel' });
  const cons = h('div', { class: 'panel-body dpv-console' });
  const side = h('aside', { class: 'dpv-side' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('code'), 'Current instruction'), insn),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('chip'), 'Control word'), ctl),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('layers'), 'Selected block'), sel),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('list'), 'Console'), cons));
  const toolbar = h('div', { class: 'dpv-toolbar' }, controls(), h('div', { class: 'tb-spacer' }), statusPill(),
    h('a', { class: 'btn small ghost', href: '#/lab' }, icon('code'), 'Edit program'));
  el.append(h('div', { class: 'dpv' }, toolbar, h('div', { class: 'dpv-main' }, dpHost, side)));

  const handle = mountDatapathPanel(dpHost, { docked: false });
  const m = session.machine;

  effect(() => {
    session.tick.track();
    session.mode.value;
    const eng = session.engine instanceof SingleCycleEngine ? session.engine : null;
    const word = m.peekLoad(m.pc, 4) >>> 0;
    const spec = findSpec(word | 0);
    const asm = session.loaded.peek();
    const line = asm?.addrToLine.get(m.pc);
    const src = line !== undefined ? session.source.peek().split('\n')[line]?.trim() : undefined;
    set(insn, 
      h('div', { class: 'pc' }, `pc = 0x${(m.pc >>> 0).toString(16).padStart(8, '0')}  ·  cycle ${m.cycles}`),
      h('div', { class: 'mn' }, disassemble(word, m.pc).text),
      src ? h('div', { class: 'src', title: `line ${line! + 1}` }, `${line! + 1}: ${src}`) : null,
      spec ? bitfield(spec, { word, compact: true }) : h('p', null, 'Not a valid instruction: the control unit raises illegal.'),
      spec ? h('p', null, spec.summary) : null,
      m.status === 'halted' ? h('p', null, `Program exited with code ${m.exitCode}.`) : m.status === 'error' ? h('p', null, m.message) : null);
    if (!eng) { ctl.replaceChildren(h('p', { class: 'faint' }, 'Switch to a hardware mode to see control signals.')); return; }
    const s = eng.structure;
    const rows = CONTROL_FIELDS.map(f => {
      const v = s.net(f.name)?.value ?? 0;
      const dec = DECODE[f.name]?.(v) ?? String(v);
      const off = v === 0 && !['aluOp', 'immSel', 'aSel', 'wbSel'].includes(f.name);
      return h('tr', { class: off ? 'off' : '', title: f.doc }, h('td', null, f.name), h('td', { class: 'v' }, dec), h('td', { class: 'm' }, f.doc.split('.')[0]));
    });
    ctl.replaceChildren(h('table', { class: 'ctl-table' }, h('tbody', null, ...rows)));
    cons.textContent = m.consoleOut.slice(-2000) || '(no output yet)';
    cons.scrollTop = cons.scrollHeight;
    renderSel();
  });

  function renderSel(): void {
    const inst = handle.selected.value;
    if (!inst) {
      set(sel, h('p', null, 'Click a block to see what it does. Double-click to dive inside it, or drag the abstraction slider to fly from the system bus down to the logic gates.'));
      return;
    }
    const d = inst.def;
    set(sel, 
      h('h4', null, d.name, d.level ? h('span', { class: 'faint' }, `  ·  ${d.level}`) : null),
      d.doc ? h('p', null, d.doc) : null,
      h('div', { class: 'ports' },
        ...d.inputs.flatMap((p, i) => [h('span', { class: 'n' }, `in ${p.name}`), h('span', null, fmtVal(inst.inVals[i] >>> 0, p.width))]),
        ...d.outputs.flatMap((p, i) => [h('span', { class: 'n' }, `out ${p.name}`), h('span', null, fmtVal(inst.outVals[i] >>> 0, p.width))])),
      (inst.hasStructure || d.interior) ? (() => {
        const b = h('button', { class: 'btn small', style: 'margin-top:10px' }, 'Look inside');
        b.addEventListener('click', () => handle.focusOn(inst));
        return b;
      })() : null);
  }
  effect(() => { handle.selected.value; renderSel(); });
}
