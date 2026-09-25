/**
 * A small self-contained simulator for chapters: its own machine and engine,
 * a program, step / back / play controls and a choice of views (registers,
 * datapath, pipeline, stack, console, screen, CSRs).
 */
import { h, replace } from '../../ui/h.ts';
import { icon } from '../../ui/icons.ts';
import { onCleanup } from '../../ui/reactive.ts';
import { Machine } from '../../sim/machine.ts';
import { assemble } from '../../asm/assembler.ts';
import type { AsmResult } from '../../asm/assembler.ts';
import { SingleCycleEngine } from '../../hw/cpu/single.ts';
import { PipelineEngine } from '../../hw/cpu/pipeline.ts';
import { Renderer } from '../../viz/renderer.ts';
import { CPU_RECT } from '../../viz/interiors.ts';
import { pipelineView } from '../../viz/pipeline-view.ts';
import { netTip, instTip } from '../../viz/tips.ts';
import { showTip, hideTip } from '../../ui/components/tooltip.ts';
import { disassemble } from '../../asm/disasm.ts';
import { regIndex, ABI_NAMES } from '../../isa/regs.ts';
import { FB_BASE, FB_W, FB_H, STACK_TOP } from '../../sim/memmap.ts';
import { loadIntoLab } from '../../reference/lab-link.ts';

export type SimView = 'insn' | 'regs' | 'datapath' | 'pipeline' | 'stack' | 'console' | 'screen' | 'csrs';

export interface MiniSimOpts {
  source: string;
  title?: string;
  mode?: 'isa' | 'single' | 'pipeline';
  views: SimView[];
  regs?: string[];
  height?: number;
  input?: string;
  caption?: string;
  /** Steps per second when playing. */
  rate?: number;
}

interface Eng { step(): void; undo(): boolean; version?: number }

const hex8 = (v: number) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export function miniSim(o: MiniSimOpts): HTMLElement {
  const m = new Machine(1 << 15);
  const r: AsmResult = assemble(o.source);
  if (!r.ok) return h('div', { class: 'widget error' }, 'Example failed to assemble: ' + r.diagnostics.map(d => `${d.line + 1}: ${d.message}`).join('; '));
  const mode = o.mode ?? 'isa';
  let eng: Eng;
  let single: SingleCycleEngine | null = null;
  let pipe: PipelineEngine | null = null;
  const load = () => {
    m.loadProgram(r.image);
    if (o.input) m.provideInput(o.input);
    if (mode === 'single') { single = new SingleCycleEngine(m); eng = single; }
    else if (mode === 'pipeline') { pipe = new PipelineEngine(m); eng = pipe; }
    else eng = { step: () => m.step(), undo: () => m.undo() };
  };
  load();
  const lines = o.source.split('\n');
  const regsShown = (o.regs ?? ['a0', 'a1', 't0', 'sp', 'ra']).map(n => regIndex(n));
  const prevRegs = new Int32Array(32);

  // ---------------------------------------------------------------- controls
  const playBtn = h('button', { class: 'btn small primary' }, icon('play'), 'Play');
  const stepBtn = h('button', { class: 'btn small' }, icon('step'), mode === 'isa' ? 'Step' : 'Clock');
  const backBtn = h('button', { class: 'btn small' }, icon('back'), 'Back');
  const resetBtn = h('button', { class: 'btn small ghost' }, icon('reset'), 'Reset');
  const labBtn = h('button', { class: 'btn small ghost', title: 'Open this program in the Lab' }, icon('code'), 'Open in Lab');
  const status = h('span', { class: 'ms-status' });
  const bar = h('div', { class: 'ms-bar' }, playBtn, stepBtn, backBtn, resetBtn, h('span', { class: 'spacer' }), status, labBtn);

  // ---------------------------------------------------------------- views
  const parts: HTMLElement[] = [];
  const updaters: (() => void)[] = [];
  const has = (v: SimView) => o.views.includes(v);

  if (has('insn')) {
    const el = h('div', { class: 'ms-insn' });
    parts.push(el);
    updaters.push(() => {
      const w = m.peekLoad(m.pc, 4) >>> 0;
      const ln = r.addrToLine.get(m.pc);
      replace(el, h('span', { class: 'pc mono' }, hex8(m.pc)), h('span', { class: 'mn mono' }, disassemble(w, m.pc).text),
        ln !== undefined ? h('span', { class: 'src mono faint' }, lines[ln].trim()) : null);
    });
  }
  if (has('regs')) {
    const el = h('div', { class: 'ms-regs' });
    parts.push(el);
    updaters.push(() => {
      el.replaceChildren(...regsShown.map(i => {
        const v = m.x[i];
        const changed = v !== prevRegs[i];
        return h('div', { class: `ms-reg ${changed ? 'chg' : ''}` }, h('span', { class: 'rn mono' }, ABI_NAMES[i]), h('span', { class: 'rv mono' }, Math.abs(v) < 100000 && ![1, 2, 3, 4].includes(i) ? String(v) : hex8(v)));
      }));
    });
  }
  if (has('datapath') && single) {
    const s1 = single as SingleCycleEngine;
    const canvas = h('canvas', { class: 'ms-canvas' });
    const stage = h('div', { class: 'ms-stage', style: `height:${o.height ?? 330}px` }, canvas);
    parts.push(stage);
    let t0 = 0, dur = 0, tmax = 0, raf = 0;
    const ren = new Renderer(canvas, s1.cpu, {
      machine: m,
      time: () => { if (!dur) return Infinity; const e = performance.now() - t0; if (e >= dur) { dur = 0; return Infinity; } return (e / dur) * tmax; },
      showValues: () => true,
    });
    const draw = () => {
      raf = 0;
      const w = stage.clientWidth, hh = stage.clientHeight;
      if (!w) return;
      if (ren.vw !== w || ren.vh !== hh) { ren.resize(w, hh); ren.cam = ren.fitCamera(CPU_RECT, 0.01); }
      ren.draw();
      if (dur) raf = requestAnimationFrame(draw);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
    let lastV = -1;
    updaters.push(() => {
      if (s1.version !== lastV) {
        if (lastV >= 0 && !playing) {
          tmax = 0;
          for (const n of s1.structure.nets) if (Number.isFinite(n.arrival)) tmax = Math.max(tmax, n.arrival);
          t0 = performance.now(); dur = 1100;
        }
        lastV = s1.version;
      }
      kick();
    });
    const ro = new ResizeObserver(kick);
    ro.observe(stage);
    onCleanup(() => { ro.disconnect(); cancelAnimationFrame(raf); });
    canvas.addEventListener('pointermove', e => {
      const b = canvas.getBoundingClientRect();
      const hit = ren.hitTest(e.clientX - b.left, e.clientY - b.top);
      const ii = hit.net ? null : hit.node?.inst && hit.node.inst !== s1.cpu ? hit.node.inst : null;
      if (hit.net !== ren.hover.net || ii !== ren.hover.inst) { ren.hover = { net: hit.net, inst: ii }; kick(); }
      const t = hit.net ? netTip(hit.net) : ii ? instTip(ii) : null;
      if (t) showTip(t, e.clientX, e.clientY); else hideTip();
    });
    canvas.addEventListener('pointerleave', () => { hideTip(); ren.hover = { net: null, inst: null }; kick(); });
  }
  if (has('pipeline') && pipe) {
    const pv = pipelineView();
    parts.push(h('div', { class: 'ms-pipe' }, pv.el));
    updaters.push(() => pv.update(pipe!));
  }
  if (has('stack')) {
    const el = h('div', { class: 'ms-stack' });
    parts.push(h('div', { class: 'ms-stack-wrap' }, h('h5', null, 'Stack'), el));
    updaters.push(() => {
      const sp = m.x[2] >>> 0;
      const top = STACK_TOP >>> 0;
      const rows = [];
      const lo = Math.max(sp - 8, top - 4 * 24);
      for (let a = top - 4; a >= lo && rows.length < 24; a -= 4) {
        const v = m.peekLoad(a, 4) >>> 0;
        const line = r.addrToLine.get(v - 4);
        const isRa = line !== undefined && v !== 0;
        const below = a < sp;
        rows.push(h('div', { class: `ms-word ${below ? 'free' : ''} ${a === sp ? 'sp' : ''}` },
          h('span', { class: 'ad mono' }, hex8(a).slice(6)), h('span', { class: 'wv mono' }, below ? '' : Math.abs(v | 0) < 100000 ? String(v | 0) : hex8(v)),
          h('span', { class: 'an' }, a === sp ? '◀ sp' : isRa && !below ? `return address (line ${line! + 2})` : '')));
      }
      el.replaceChildren(...rows);
    });
  }
  if (has('csrs')) {
    const el = h('div', { class: 'ms-regs' });
    parts.push(el);
    const names: [string, number][] = [['mstatus', 0x300], ['mie', 0x304], ['mip', 0x344], ['mtvec', 0x305], ['mepc', 0x341], ['mcause', 0x342]];
    updaters.push(() => el.replaceChildren(...names.map(([n, a]) => h('div', { class: 'ms-reg' }, h('span', { class: 'rn mono' }, n), h('span', { class: 'rv mono' }, hex8(m.csrPeek(a)))))));
  }
  if (has('console')) {
    const el = h('pre', { class: 'ms-console' });
    parts.push(el);
    updaters.push(() => { el.textContent = m.consoleOut || ' '; el.scrollTop = el.scrollHeight; });
  }
  if (has('screen')) {
    const c = h('canvas', { class: 'ms-fb', width: FB_W, height: FB_H });
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(FB_W, FB_H);
    parts.push(h('div', { class: 'ms-fb-wrap' }, c));
    let ver = -1;
    updaters.push(() => {
      if (m.mem.version === ver) return;
      ver = m.mem.version;
      const px = m.mem.readBytes(FB_BASE, FB_W * FB_H);
      for (let i = 0; i < px.length; i++) {
        const b = px[i];
        img.data[i * 4] = ((b >> 5) & 7) * 255 / 7; img.data[i * 4 + 1] = ((b >> 2) & 7) * 255 / 7; img.data[i * 4 + 2] = (b & 3) * 255 / 3; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
  }

  // ---------------------------------------------------------------- behaviour
  let playing = false, raf = 0, last = 0, debt = 0;
  const running = () => m.status === 'ready' || m.status === 'break';
  const update = () => {
    for (const u of updaters) u();
    prevRegs.set(m.x);
    status.textContent = m.status === 'halted' ? `exited (${m.exitCode})` : m.status === 'error' ? m.message : m.status === 'waiting' ? 'waiting for input' : `${mode === 'isa' ? 'step' : 'cycle'} ${mode === 'isa' ? m.instret : m.cycles}`;
    stepBtn.disabled = !running();
    backBtn.disabled = !m.history.length && !(pipe && m.cycles > 0);
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Play');
  };
  const doStep = () => { if (!running()) return; prevRegs.set(m.x); eng.step(); m.sleepMs = 0; };
  stepBtn.addEventListener('click', () => { pause(); doStep(); update(); });
  backBtn.addEventListener('click', () => { pause(); eng.undo(); update(); });
  resetBtn.addEventListener('click', () => { pause(); load(); update(); });
  labBtn.addEventListener('click', () => loadIntoLab(o.source, o.title ?? 'example'));
  const rate = o.rate ?? 3;
  const frame = (t: number) => {
    if (!playing) return;
    debt += Math.min(0.25, (t - last) / 1000) * rate;
    last = t;
    let n = 0;
    while (debt >= 1 && n < 2000) { doStep(); debt -= 1; n++; }
    update();
    if (!running()) { pause(); return; }
    raf = requestAnimationFrame(frame);
  };
  function pause(): void { if (!playing) return; playing = false; cancelAnimationFrame(raf); update(); }
  playBtn.addEventListener('click', () => {
    if (playing) { pause(); return; }
    if (!running()) load();
    playing = true; last = performance.now(); debt = 1;
    raf = requestAnimationFrame(frame);
    update();
  });
  onCleanup(() => cancelAnimationFrame(raf));
  update();
  return h('figure', { class: 'widget minisim' }, bar, h('div', { class: `ms-views ${o.views.join(' ')}` }, ...parts), o.caption ? h('figcaption', null, o.caption) : null);
}
