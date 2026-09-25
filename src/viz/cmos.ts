/**
 * Below the gates: the CMOS transistor circuit of NOT, NAND and NOR (and
 * AND / OR as a NAND / NOR plus an inverter), with each transistor shown
 * conducting or off for the gate's current inputs.
 */
import { h } from '../ui/h.ts';
import type { Instance } from '../hw/netlist.ts';

type Kind = 'not' | 'nand' | 'nor';

function fet(x: number, y: number, p: boolean, on: boolean, label: string): string {
  const c = on ? 'on' : 'off';
  return `<g class="fet ${c}">
    <line x1="${x}" y1="${y - 22}" x2="${x}" y2="${y + 22}" class="ch"/>
    <line x1="${x - 10}" y1="${y - 16}" x2="${x - 10}" y2="${y + 16}" class="gt"/>
    ${p ? `<circle cx="${x - 15}" cy="${y}" r="4" class="bub"/>` : ''}
    <line x1="${x - (p ? 19 : 10)}" y1="${y}" x2="${x - 34}" y2="${y}" class="gw"/>
    <text x="${x - 38}" y="${y + 4}" class="gl">${label}</text>
    <text x="${x + 8}" y="${y + 4}" class="tl">${p ? 'P' : 'N'}</text>
  </g>`;
}

function stage(kind: Kind, a: number, b: number): { svg: string; out: number } {
  const out = kind === 'not' ? a ^ 1 : kind === 'nand' ? (a & b) ^ 1 : (a | b) ^ 1;
  const hi = out ? 'hi' : 'lo';
  let body = '';
  if (kind === 'not') {
    body = `<line x1="160" y1="30" x2="160" y2="48" class="w vdd"/>${fet(160, 70, true, !a, 'a')}
      <line x1="160" y1="92" x2="160" y2="148" class="w ${hi}"/>${fet(160, 170, false, !!a, 'a')}
      <line x1="160" y1="192" x2="160" y2="230" class="w gnd"/>`;
  } else if (kind === 'nand') {
    body = `<path d="M110 30V48M210 30V48" class="w vdd"/>${fet(110, 70, true, !a, 'a')}${fet(210, 70, true, !b, 'b')}
      <path d="M110 92V112H210V92M160 112V128" class="w ${hi}"/>${fet(160, 150, false, !!a, 'a')}
      <line x1="160" y1="172" x2="160" y2="182" class="w ${a ? hi : 'mid'}"/>${fet(160, 204, false, !!b, 'b')}
      <line x1="160" y1="226" x2="160" y2="230" class="w gnd"/>`;
  } else {
    body = `<line x1="160" y1="30" x2="160" y2="42" class="w vdd"/>${fet(160, 64, true, !a, 'a')}
      <line x1="160" y1="86" x2="160" y2="96" class="w ${!a ? 'hi' : 'mid'}"/>${fet(160, 118, true, !b, 'b')}
      <path d="M160 140V160M110 168V160H210V168" class="w ${hi}"/>${fet(110, 190, false, !!a, 'a')}${fet(210, 190, false, !!b, 'b')}
      <path d="M110 212V230M210 212V230" class="w gnd"/>`;
  }
  const outY = kind === 'not' ? 120 : kind === 'nand' ? 112 : 160;
  return {
    out,
    svg: `<line x1="20" y1="30" x2="300" y2="30" class="rail vdd"/><text x="24" y="24" class="rl">VDD (1)</text>
      <line x1="20" y1="230" x2="300" y2="230" class="rail gnd"/><text x="24" y="246" class="rl">GND (0)</text>
      ${body}
      <line x1="${kind === 'nand' ? 210 : 160}" y1="${outY}" x2="290" y2="${outY}" class="w ${hi}"/><circle cx="290" cy="${outY}" r="4" class="w ${hi}"/>
      <text x="284" y="${outY - 8}" class="ol">y = ${out}</text>`,
  };
}

/** Show the CMOS circuit for a gate instance in a modal. */
export function showCmos(inst: Instance): void {
  const shape = inst.def.shape ?? '';
  const a = inst.inVals[0] & 1, b = (inst.inVals[1] ?? 0) & 1;
  let kind: Kind | null = null, invert = false, note = '';
  if (shape === 'not') kind = 'not';
  else if (shape === 'nand') kind = 'nand';
  else if (shape === 'nor') kind = 'nor';
  else if (shape === 'and') { kind = 'nand'; invert = true; note = 'An AND gate is a NAND followed by an inverter: CMOS logic is naturally inverting.'; }
  else if (shape === 'or') { kind = 'nor'; invert = true; note = 'An OR gate is a NOR followed by an inverter.'; }
  else if (shape === 'buf') { kind = 'not'; invert = true; note = 'A buffer is two inverters in a row: it restores a weak signal.'; }
  const n = inst.def.inputs.length;
  if (kind && n > 2) note = `Drawn with two inputs; a ${n}-input ${shape.toUpperCase()} stacks ${n} transistors in each network.`;
  const body = kind
    ? (() => {
      const s1 = stage(kind, a, b);
      const s2 = invert ? stage('not', s1.out, 0) : null;
      return `<svg viewBox="0 0 320 260" class="cmos-svg">${s1.svg}</svg>${s2 ? `<div class="cmos-then">→ inverter →</div><svg viewBox="0 0 320 260" class="cmos-svg">${s2.svg.replace(/>a</g, '>x<')}</svg>` : ''}`;
    })()
    : `<p>An XOR in static CMOS takes 12 transistors (or 8 with transmission gates) — which is why the XOR gates in this CPU would be built from the gates you can open here.</p>`;
  const close = h('button', { class: 'iconbtn', 'aria-label': 'Close' }, '✕');
  const dialog = h('div', { class: 'cmos-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Transistor-level view' },
    h('div', { class: 'cmos-card' },
      h('div', { class: 'cmos-head' }, h('b', null, `Inside the ${inst.def.name}`), h('span', { class: 'spacer' }), close),
      h('p', { class: 'dim' }, `Inputs a = ${a}${n > 1 ? `, b = ${b}` : ''}. P-type transistors (top) conduct when their gate is 0 and pull the output up to VDD; N-type (bottom) conduct when their gate is 1 and pull it down to ground. Exactly one network conducts at a time, so no current flows except while switching.`),
      h('div', { class: 'cmos-body', html: body }),
      note ? h('p', { class: 'faint' }, note) : null,
      h('p', { class: 'faint small' }, 'You found the bottom of the abstraction stack: below this are electrons.')));
  const done = () => { dialog.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', done); };
  window.addEventListener('hashchange', done);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
  close.addEventListener('click', done);
  dialog.addEventListener('click', e => { if (e.target === dialog) done(); });
  document.addEventListener('keydown', onKey);
  document.body.append(dialog);
  close.focus();
}

export function isGate(inst: Instance): boolean {
  return ['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not', 'buf'].includes(inst.def.shape ?? '');
}
