/** CSR panel: trap-related registers with bit breakdowns. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import { hex } from '../isa/bits.ts';
import { CAUSE_NAMES, CSRS } from '../isa/csr.ts';

const SHOWN = ['mstatus', 'mie', 'mip', 'mtvec', 'mepc', 'mcause', 'mtval', 'mscratch', 'cycle', 'instret', 'time'];

export function csrPanel(): HTMLElement {
  const m = session.machine;
  const body = h('div', { class: 'csrs' });
  function bits(v: number, names: [number, string][]) {
    return names.map(([b, n]) => `<span class="cb ${(v >>> b) & 1 ? 'on' : ''}">${n}</span>`).join('');
  }
  function render() {
    let html = '';
    for (const name of SHOWN) {
      const info = CSRS.find(c => c.name === name)!;
      const v = m.csrRead(info.addr);
      let extra = '';
      if (name === 'mstatus') extra = bits(v, [[3, 'MIE'], [7, 'MPIE']]);
      else if (name === 'mie' || name === 'mip') extra = bits(v, [[7, 'MTI'], [11, 'MEI']]);
      else if (name === 'mcause' && (m.mcause || m.mepc)) extra = `<span class="faint">${CAUSE_NAMES[v >>> 0] ?? ''}</span>`;
      html += `<div class="csr" title="${info.description.replace(/"/g, '&quot;')}"><span class="cn">${name}</span><span class="ca faint">${hex(info.addr, 3)}</span><span class="cv mono">${hex(v)}</span><span class="cx">${extra}</span></div>`;
    }
    html += `<div class="csr"><span class="cn">mtimecmp</span><span class="ca faint">mmio</span><span class="cv mono">${m.mtimecmp >= 0xffffffff ? 'disarmed' : String(m.mtimecmp)}</span><span class="cx"></span></div>`;
    body.innerHTML = html;
  }
  effect(() => { session.tick.track(); render(); });
  return body;
}
