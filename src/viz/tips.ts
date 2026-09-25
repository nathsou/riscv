/** Hover explanations for nets and blocks in circuit views. */
import { h } from '../ui/h.ts';
import type { Instance, Net } from '../hw/netlist.ts';

export function netTip(net: Net): HTMLElement {
  const v = net.value >>> 0;
  const w = net.width;
  const signed = w === 32 ? (v | 0) : w > 1 && (v >>> (w - 1)) & 1 ? v - 2 ** w : v;
  const bin = w <= 32 ? v.toString(2).padStart(w, '0').replace(/(.{4})(?=.)/g, '$1_') : '';
  const kind = { data: 'data', ctrl: 'control', addr: 'address', clk: 'clock' }[net.kind];
  return h('div', null,
    h('h4', null, net.name, h('span', { class: 'faint' }, `  ${w} bit${w > 1 ? 's' : ''} · ${kind}`)),
    h('div', { class: 'tt-grid' },
      w > 1 ? [h('span', null, 'hex'), h('span', null, '0x' + v.toString(16).padStart(Math.ceil(w / 4), '0'))] : null,
      h('span', null, 'dec'), h('span', null, w > 1 && signed !== v ? `${v}  (signed ${signed})` : String(v)),
      w > 1 && w <= 32 ? [h('span', null, 'bin'), h('span', null, bin)] : null,
      Number.isFinite(net.arrival) ? [h('span', null, 'settles'), h('span', null, `after ${net.arrival} gate delays`)] : null),
    net.live ? null : h('div', { class: 'faint', style: 'margin-top:4px' }, 'Not used by this instruction.'),
    h('div', { class: 'faint', style: 'margin-top:4px;font-size:11px' }, 'Shift-click to pin to the waveform'));
}

export function instTip(inst: Instance): HTMLElement {
  const d = inst.def;
  const lab = d.label?.(inst);
  return h('div', null,
    h('h4', null, d.name, lab ? h('span', { class: 'mono' }, '  ' + lab) : null),
    d.doc ? h('div', { class: 'dim' }, d.doc) : null,
    (inst.hasStructure || d.interior || ['and', 'or', 'nand', 'nor', 'not', 'buf', 'xor', 'xnor'].includes(d.shape ?? '')) ? h('div', { class: 'faint', style: 'margin-top:4px;font-size:11px' }, 'Double-click to look inside') : null);
}

