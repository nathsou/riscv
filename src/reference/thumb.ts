/**
 * A static datapath thumbnail for one instruction: its Try-it program runs on
 * a private machine up to that instruction, and the single-cycle CPU is drawn
 * with the paths it uses lit and everything else dimmed.
 */
import { h } from '../ui/h.ts';
import { Machine } from '../sim/machine.ts';
import { assemble } from '../asm/assembler.ts';
import { SingleCycleEngine } from '../hw/cpu/single.ts';
import { Renderer } from '../viz/renderer.ts';
import { CPU_RECT } from '../viz/interiors.ts';
import type { InsnSpec } from '../isa/spec/index.ts';
import { tryItProgram } from './tryit.ts';

export function datapathThumb(spec: InsnSpec): HTMLElement {
  const canvas = h('canvas', { class: 'thumb-canvas', 'aria-label': `Single-cycle datapath executing ${spec.mnemonic}` });
  const wrap = h('div', { class: 'thumb' }, canvas);
  const { source, line } = tryItProgram(spec);
  const r = assemble(source);
  if (!r.ok) return wrap;
  const m = new Machine();
  m.loadProgram(r.image);
  const target = r.lineToAddrs.get(line)?.[0];
  for (let i = 0; i < 200 && m.pc !== target && m.status === 'ready'; i++) m.step();
  m.history.clear();
  const eng = new SingleCycleEngine(m);
  const ren = new Renderer(canvas, eng.cpu, { machine: m, time: () => Infinity, showValues: () => false });
  const draw = () => {
    const w = wrap.clientWidth;
    if (!w) return;
    const hgt = Math.round(w * 0.56);
    ren.resize(w, hgt);
    ren.cam = ren.fitCamera(CPU_RECT, 0.01);
    ren.draw();
  };
  const ro = new ResizeObserver(draw);
  ro.observe(wrap);
  window.addEventListener('themechange', () => requestAnimationFrame(draw));
  return wrap;
}
