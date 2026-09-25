/**
 * An interactive circuit: any module from the hardware library, drawn by the
 * same renderer as the CPU, with switches for its inputs, lamps for its
 * outputs, an animated wavefront on every change and an optional truth table.
 */
import { h } from '../../ui/h.ts';
import { Instance, evalTop } from '../../hw/netlist.ts';
import type { Def, InstOpts } from '../../hw/netlist.ts';
import { layout } from '../../viz/geometry.ts';
import { Renderer, interiorAspect } from '../../viz/renderer.ts';
import { netTip, instTip } from '../../viz/tips.ts';
import { showTip, hideTip } from '../../ui/components/tooltip.ts';
import { onCleanup } from '../../ui/reactive.ts';

const wrapped = new Map<Def, Def>();
/** Give a leaf gate a one-node structure so it can be drawn with its terminals. */
function drawable(def: Def): Def {
  if (def.build) return def;
  let w = wrapped.get(def);
  if (!w) {
    w = {
      ...def, type: def.type + 'View', name: def.name, shape: 'box', size: undefined,
      build(b) {
        const outs = b.add(def, def.inputs.map(p => b.in(p.name)), { name: def.type.toLowerCase() });
        def.outputs.forEach((p, i) => b.out(p.name, outs[i]));
      },
    };
    wrapped.set(def, w);
  }
  return w;
}

export interface CircuitOpts {
  def: Def;
  inputs?: number[];
  caption?: string;
  table?: boolean;
  /** Canvas height in CSS pixels (width follows the column). */
  height?: number;
  opts?: InstOpts;
  /** Called after every evaluation (e.g. to keep external state in sync). */
  onEval?: (inst: Instance) => void;
  /** Named input settings offered in a menu. */
  presets?: { label: string; values: number[] }[];
}

export function circuitWidget(o: CircuitOpts): HTMLElement {
  const def = drawable(o.def);
  const inst = new Instance(def, 'root', null, o.opts ?? {});
  const vals = def.inputs.map((_, i) => o.inputs?.[i] ?? 0);
  const s = inst.structure!;
  layout(s);
  const rootRect = def.interior ? { x: 0, y: 0, w: 1000, h: 1000 / interiorAspect(inst) * 1.12 } : { x: 0, y: 0, w: s.w * 1.04, h: s.h * 1.16 + 20 };
  const canvas = h('canvas', { class: 'cw-canvas', 'aria-label': `${o.def.name} circuit` });
  const stage = h('div', { class: 'cw-stage', style: `height:${o.height ?? 260}px` }, canvas);
  let t0 = 0, dur = 0, tmax = 0;
  const ren = new Renderer(canvas, inst, {
    machine: null,
    time: () => {
      if (!dur) return Infinity;
      const e = performance.now() - t0;
      if (e >= dur) { dur = 0; return Infinity; }
      return (e / dur) * tmax;
    },
    showValues: () => true,
  }, { rootRect, cpuMode: false });

  const inCtl = h('div', { class: 'cw-inputs' });
  const outCtl = h('div', { class: 'cw-outputs' });
  const table = o.table ? h('table', { class: 'truth' }) : null;
  const maxOf = (w: number) => (w >= 32 ? 0xffffffff : (1 << w) - 1);

  const controls = def.inputs.map((p, i) => {
    if (p.width === 1) {
      const b = h('button', { class: `sw ${p.kind === 'clk' ? 'clk' : ''}`, 'aria-label': `${p.name} input`, 'aria-pressed': 'false' }, h('span', { class: 'sw-name' }, p.name), h('span', { class: 'sw-val' }));
      b.addEventListener('click', () => set(i, vals[i] ^ 1));
      return { el: b, show: () => { b.classList.toggle('on', !!vals[i]); b.setAttribute('aria-pressed', String(!!vals[i])); b.querySelector('.sw-val')!.textContent = String(vals[i]); } };
    }
    const input = h('input', { class: 'input num', type: 'text', inputMode: 'numeric', 'aria-label': `${p.name} input`, value: String(vals[i]) });
    const bits = h('span', { class: 'cw-bits mono' });
    const dec = h('button', { class: 'iconbtn small', 'aria-label': `decrement ${p.name}` }, '−');
    const inc = h('button', { class: 'iconbtn small', 'aria-label': `increment ${p.name}` }, '+');
    dec.addEventListener('click', () => set(i, (vals[i] - 1) & maxOf(p.width)));
    inc.addEventListener('click', () => set(i, (vals[i] + 1) & maxOf(p.width)));
    input.addEventListener('change', () => {
      const v = input.value.trim();
      const n = /^-/.test(v) ? parseInt(v, 10) : Number(v);
      if (Number.isFinite(n)) set(i, (n >>> 0) & maxOf(p.width)); else input.value = String(vals[i]);
    });
    const el = h('label', { class: 'cw-num' }, h('span', { class: 'sw-name' }, p.name), dec, input, inc, p.width <= 8 ? bits : null);
    return { el, show: () => { input.value = String(vals[i]); bits.textContent = vals[i].toString(2).padStart(p.width, '0'); } };
  });
  inCtl.append(...controls.map(c => c.el));
  if (o.presets) {
    const sel = h('select', { class: 'select small', 'aria-label': 'Preset inputs' }, h('option', { value: '' }, 'Try…'), ...o.presets.map((p, i) => h('option', { value: String(i) }, p.label)));
    sel.addEventListener('change', () => {
      const p = o.presets![Number(sel.value)];
      if (p) { p.values.forEach((v, j) => { vals[j] = v >>> 0; }); evaluate(true); }
    });
    inCtl.prepend(sel);
  }

  function evaluate(animate: boolean): void {
    evalTop(inst, [...vals]);
    o.onEval?.(inst);
    tmax = 0;
    for (const n of s.nets) if (Number.isFinite(n.arrival)) tmax = Math.max(tmax, n.arrival);
    if (animate && tmax > 0) { t0 = performance.now(); dur = Math.min(900, 240 + tmax * 40); }
    controls.forEach(c => c.show());
    outCtl.replaceChildren(...def.outputs.map((p, i) => {
      const v = s.outputs[i].value >>> 0;
      return p.width === 1
        ? h('span', { class: `lamp ${v ? 'on' : ''}` }, h('span', { class: 'lamp-dot' }), p.name, ' = ', String(v))
        : h('span', { class: 'cw-out mono' }, `${p.name} = ${v}`, p.width <= 8 ? h('span', { class: 'faint' }, `  ${v.toString(2).padStart(p.width, '0')}`) : h('span', { class: 'faint' }, `  0x${v.toString(16)}`));
    }));
    if (table) renderTable();
    kick();
  }

  function set(i: number, v: number): void { vals[i] = v >>> 0; evaluate(true); }

  function renderTable(): void {
    const bitsIn = def.inputs.reduce((a, p) => a + p.width, 0);
    if (bitsIn > 4 || def.sequential) { table!.replaceChildren(); return; }
    const rows = [];
    for (let k = 0; k < 1 << bitsIn; k++) {
      let off = bitsIn;
      const iv = def.inputs.map(p => { off -= p.width; return (k >> off) & maxOf(p.width); });
      const ov = o.def.behave(iv, inst);
      const cur = iv.every((v, j) => v === vals[j]);
      const tr = h('tr', { class: cur ? 'cur' : '' }, ...iv.map(v => h('td', null, String(v))), h('td', { class: 'sep' }), ...ov.map(v => h('td', { class: 'o' }, String(v))));
      tr.addEventListener('click', () => { iv.forEach((v, j) => { vals[j] = v; }); evaluate(true); });
      rows.push(tr);
    }
    table!.replaceChildren(h('thead', null, h('tr', null, ...def.inputs.map(p => h('th', null, p.name)), h('th', { class: 'sep' }), ...def.outputs.map(p => h('th', { class: 'o' }, p.name)))), h('tbody', null, ...rows));
  }

  // drawing
  let raf = 0;
  const draw = () => {
    raf = 0;
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    if (ren.vw !== w || ren.vh !== hh) { ren.resize(w, hh); ren.cam = ren.fitCamera(rootRect, 0.02); }
    ren.draw();
    if (dur) kick();
  };
  function kick(): void { if (!raf) raf = requestAnimationFrame(draw); }
  const ro = new ResizeObserver(() => kick());
  ro.observe(stage);
  const onTheme = () => requestAnimationFrame(() => kick());
  window.addEventListener('themechange', onTheme);
  onCleanup(() => { ro.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('themechange', onTheme); });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    const hit = ren.hitTest(e.clientX - r.left, e.clientY - r.top);
    const ii = hit.net ? null : hit.node?.inst && hit.node.inst !== inst ? hit.node.inst : null;
    if (hit.net !== ren.hover.net || ii !== ren.hover.inst) { ren.hover = { net: hit.net, inst: ii }; kick(); }
    const t = hit.net ? netTip(hit.net) : ii ? instTip(ii) : null;
    if (t) showTip(t, e.clientX, e.clientY); else hideTip();
  });
  canvas.addEventListener('pointerleave', () => { hideTip(); ren.hover = { net: null, inst: null }; kick(); });

  evaluate(false);
  return h('figure', { class: 'widget circuit' }, stage,
    h('div', { class: 'cw-controls' }, inCtl, h('span', { class: 'cw-arrow' }, '→'), outCtl),
    table ? h('div', { class: 'cw-table' }, table) : null,
    o.caption ? h('figcaption', null, o.caption) : null);
}
