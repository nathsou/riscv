/** Register file panel: 32 integer registers + pc, flashing on change. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { REGS } from '../isa/regs.ts';
import { hex } from '../isa/bits.ts';
import { session } from '../app/session.ts';
import { tip } from '../ui/components/tooltip.ts';

export type RegFormat = 'hex' | 'dec' | 'udec' | 'bin' | 'char';

export function fmtValue(v: number, f: RegFormat): string {
  switch (f) {
    case 'hex': return hex(v);
    case 'dec': return String(v | 0);
    case 'udec': return String(v >>> 0);
    case 'bin': return (v >>> 0).toString(2).padStart(32, '0').replace(/(.{8})(?!$)/g, '$1 ');
    case 'char': return v >= 32 && v < 127 ? `'${String.fromCharCode(v)}'` : '·';
  }
}

export function registersPanel(): HTMLElement {
  const m = session.machine;
  let format: RegFormat = 'hex';
  const fmtSel = h('select', { class: 'select tiny', 'aria-label': 'Number format' },
    ...(['hex', 'dec', 'udec', 'bin'] as RegFormat[]).map(f => h('option', { value: f }, f)));
  fmtSel.addEventListener('change', () => { format = fmtSel.value as RegFormat; render(); });

  const pcVal = h('span', { class: 'rv mono' });
  const pcRow = h('div', { class: 'reg pc' }, h('span', { class: 'rn' }, 'pc'), h('span', { class: 'ra' }, ''), pcVal);
  const cells = REGS.map(r => {
    const val = h('span', { class: 'rv mono' });
    const row = h('div', { class: `reg role-${r.role}` },
      h('span', { class: 'rn' }, 'x' + r.index), h('span', { class: 'ra' }, r.abi), val);
    tip(row, () => h('div', null,
      h('h4', null, `x${r.index} · ${r.abi}`),
      h('div', { class: 'faint' }, `${r.description}${r.saver !== '—' ? ` · ${r.saver}-saved` : ''}`),
      h('div', { class: 'tt-grid' },
        h('span', null, 'hex'), h('span', null, hex(m.x[r.index])),
        h('span', null, 'signed'), h('span', null, String(m.x[r.index])),
        h('span', null, 'unsigned'), h('span', null, String(m.x[r.index] >>> 0)),
        h('span', null, 'binary'), h('span', null, fmtValue(m.x[r.index], 'bin')))));
    if (r.index > 0) {
      val.addEventListener('dblclick', () => editReg(r.index, val));
      val.title = 'Double-click to edit';
    }
    return { row, val };
  });
  const prev = new Int32Array(32);
  let prevPc = -1;

  function render() {
    for (let i = 0; i < 32; i++) {
      const v = m.x[i];
      cells[i].val.textContent = fmtValue(v, format);
      if (v !== prev[i]) {
        cells[i].row.classList.remove('flash');
        void cells[i].row.offsetWidth;
        cells[i].row.classList.add('flash');
        prev[i] = v;
      }
      cells[i].row.classList.toggle('last', m.lastRegWrite === i);
      cells[i].row.classList.toggle('zero', v === 0);
    }
    pcVal.textContent = hex(m.pc);
    if (m.pc !== prevPc) { prevPc = m.pc; }
  }

  function editReg(i: number, el: HTMLElement) {
    const inp = h('input', { class: 'reg-edit mono', value: fmtValue(m.x[i], format === 'bin' ? 'hex' : format) });
    el.replaceChildren(inp);
    inp.focus();
    inp.select();
    const done = (commit: boolean) => {
      if (commit) {
        const s = inp.value.trim().replace(/_/g, '');
        const v = /^-?0x/i.test(s) ? parseInt(s, 16) : /^0b/i.test(s) ? parseInt(s.slice(2), 2) : parseInt(s, 10);
        if (!Number.isNaN(v)) m.x[i] = v | 0;
      }
      session.tick.fire();
      render();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }

  effect(() => { session.tick.track(); render(); });
  prev.set(m.x);

  return h('section', { class: 'panel regs-panel' },
    h('div', { class: 'panel-head' }, 'Registers', h('span', { class: 'spacer' }), fmtSel),
    h('div', { class: 'panel-body regs' }, pcRow, cells.map(c => c.row)));
}
