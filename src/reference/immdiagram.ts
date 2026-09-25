/**
 * "Where does each immediate bit come from?" An SVG with the 32 instruction
 * bits on top and the 32 immediate bits below, joined by wires. Hovering a
 * bit traces its wire; the sign-extension fan-out from bit 31 is highlighted.
 */
import { h } from '../ui/h.ts';
import { immBitMap } from '../hw/lib/state.ts';
import type { Format } from '../isa/formats.ts';
import { FORMAT_FIELDS } from '../isa/formats.ts';

const W = 720, CELL = W / 32, TOP = 34, BOT = 176, H = 214;

export function immDiagram(format: Format, word?: number): SVGElement | null {
  const fmt = format === 'CSRI' || format === 'SYS' || format === 'CSR' || format === 'FENCE' ? null : format;
  if (!fmt || fmt === 'R') return null;
  const map = immBitMap(fmt);
  const x = (bit: number) => (31 - bit + 0.5) * CELL;
  const fieldOf = (bit: number) => FORMAT_FIELDS[fmt].find(f => bit <= f.hi && bit >= f.lo);
  const svg = h('svg', { class: 'immdiag', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `How the ${fmt}-type immediate is assembled from instruction bits` }) as SVGSVGElement;
  const wires = h('g', { class: 'wires' });
  const used = new Set<number>();
  for (let j = 0; j < 32; j++) {
    const s = map[j];
    if (s < 0) continue;
    used.add(s);
    const sign = s === 31 && j > (fmt === 'U' ? 31 : fmt === 'J' ? 20 : fmt === 'B' ? 12 : 11);
    const x0 = x(s), x1 = x(j), my = (TOP + BOT) / 2 + 12;
    wires.append(h('path', {
      d: `M${x0} ${TOP + CELL * 0.5} C${x0} ${my} ${x1} ${my - 24} ${x1} ${BOT - CELL * 0.5}`,
      class: `w${sign ? ' sign' : ''}`, 'data-src': String(s), 'data-dst': String(j),
    }));
  }
  svg.append(wires);
  const cell = (bit: number, y: number, label: string, cls: string, role: 'src' | 'dst') => {
    const g = h('g', { class: `cell ${cls}`, 'data-bit': String(bit), 'data-role': role, transform: `translate(${(31 - bit) * CELL} ${y - CELL / 2})` });
    g.append(h('rect', { width: String(CELL - 2), height: String(CELL), x: '1', rx: '3' }), h('text', { x: String(CELL / 2), y: String(CELL / 2 + 4) }, label));
    return g;
  };
  for (let b = 0; b < 32; b++) {
    const f = fieldOf(b);
    const v = word !== undefined ? String((word >>> b) & 1) : '';
    svg.append(cell(b, TOP, v, `k-${f?.kind ?? 'fixed'} ${used.has(b) ? 'used' : ''}`, 'src'));
    const out = map[b] < 0 ? '0' : word !== undefined ? String((word >>> map[b]) & 1) : '';
    svg.append(cell(b, BOT, out, map[b] < 0 ? 'zero' : map[b] === 31 && b > 11 ? 'signext' : 'k-imm used', 'dst'));
  }
  for (const b of [31, 24, 20, 15, 12, 7, 0]) {
    svg.append(h('text', { class: 'num', x: String(x(b)), y: String(TOP - CELL * 0.75) }, String(b)));
    svg.append(h('text', { class: 'num', x: String(x(b)), y: String(BOT + CELL * 1.25) }, String(b)));
  }
  svg.append(h('text', { class: 'lbl', x: String(W), y: String(TOP - CELL * 0.75), 'text-anchor': 'end' }, 'instruction'));
  svg.append(h('text', { class: 'lbl', x: String(W), y: String(BOT + CELL * 1.25), 'text-anchor': 'end' }, 'immediate'));

  // hover tracing
  const setHi = (bit: number | null, role: string | null) => {
    svg.classList.toggle('tracing', bit !== null);
    for (const p of wires.children) {
      const on = bit !== null && (role === 'src' ? p.getAttribute('data-src') === String(bit) : p.getAttribute('data-dst') === String(bit));
      p.classList.toggle('hi', on);
    }
    for (const c of svg.querySelectorAll('.cell')) {
      const b = Number(c.getAttribute('data-bit'));
      const r = c.getAttribute('data-role');
      let on = false;
      if (bit !== null) {
        if (role === 'src') on = r === 'src' ? b === bit : map[b] === bit;
        else on = r === 'dst' ? b === bit : map[bit] === b;
      }
      c.classList.toggle('hi', on);
    }
  };
  svg.addEventListener('mouseover', e => {
    const c = (e.target as Element).closest('.cell');
    if (c) setHi(Number(c.getAttribute('data-bit')), c.getAttribute('data-role'));
  });
  svg.addEventListener('mouseleave', () => setHi(null, null));
  return svg;
}
