/**
 * The interactive datapath: a canvas with semantic zoom, an abstraction
 * slider that flies from the whole system down to individual gates, live
 * values, a propagation wavefront after each clock edge, hover explanations
 * and a waveform viewer for pinned signals.
 */
import { h } from '../ui/h.ts';
import { effect, onCleanup, signal } from '../ui/reactive.ts';
import type { Signal } from '../ui/reactive.ts';
import { icon } from '../ui/icons.ts';
import { showTip, hideTip } from '../ui/components/tooltip.ts';
import { session, setMode } from '../app/session.ts';
import { loadJSON, saveJSON } from '../app/storage.ts';
import { SingleCycleEngine } from '../hw/cpu/single.ts';
import { PipelineEngine } from '../hw/cpu/pipeline.ts';
import { pipelineView } from './pipeline-view.ts';
import type { PipelineView } from './pipeline-view.ts';
import type { Instance, Net } from '../hw/netlist.ts';
import { clearDelayCache } from '../hw/netlist.ts';
import { ADDER_CHOICE } from '../hw/lib/blocks.ts';
import { layout } from './geometry.ts';
import { Renderer, fmtVal } from './renderer.ts';
import type { Rect } from './renderer.ts';
import { SYSTEM, CPU_RECT } from './interiors.ts';
import { theme, invalidateTheme } from './theme.ts';
import { netTip, instTip } from './tips.ts';
import { showCmos, isGate } from './cmos.ts';

interface Cam { x: number; y: number; k: number }
interface Level { inst: Instance | null; label: string }

export interface DatapathHandle {
  selected: Signal<Instance | null>;
  focusOn(inst: Instance): void;
}

/** Preferred child to descend into when the slider goes deeper than the focus. */
const PREFERRED: Record<string, string> = { SingleCycleCPU: 'alu', ALU: 'adder', RegFile: 'x1', ImmGen: 'immI', RippleAdder32: 'fa0', CLAAdder32: 'pg0' };

function expandable(i: Instance): boolean { return i.hasStructure || !!i.def.interior; }

function children(i: Instance): Instance[] {
  if (i.def.interior) return [];
  const s = i.parent ? i.ensureEvaluated() : i.structure;
  if (!s) return [];
  layout(s);
  return s.nodes.filter(n => n.w && expandable(n.inst) && !n.inst.def.wiring).map(n => n.inst);
}

function defaultChild(i: Instance): Instance | null {
  const kids = children(i);
  if (!kids.length) return null;
  const pref = PREFERRED[i.def.type];
  const p = pref ? kids.find(k => k.name === pref) : undefined;
  if (p) return p;
  const s = i.structure!;
  let best: Instance | null = null, area = -1;
  for (const n of s.nodes) if (kids.includes(n.inst) && n.w * n.h > area) { area = n.w * n.h; best = n.inst; }
  return best;
}

function levelLabel(i: Instance, cpu: Instance): string {
  if (i === cpu) return 'CPU';
  const map: Record<string, string> = { RegFile: 'Register file', ALU: 'ALU', Control: 'Control PLA', ImmGen: 'Imm gen', IMem: 'Instr. memory', DMem: 'Data memory', CSRFile: 'CSRs' };
  return map[i.def.type] ?? (i.def.name.length <= 16 ? i.def.name : i.name);
}

function lerpCam(a: Cam, b: Cam, f: number): Cam {
  if (f <= 0) return { ...a };
  if (f >= 1) return { ...b };
  const k = a.k * Math.pow(b.k / a.k, f);
  // Keep the zoom visually anchored: interpolate the view centre in 1/k space.
  const g = Math.abs(b.k - a.k) < 1e-9 ? f : (1 / a.k - 1 / k) / (1 / a.k - 1 / b.k);
  return { k, x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function mountDatapathPanel(el: HTMLElement, opts: { docked?: boolean }): DatapathHandle {
  const docked = !!opts.docked;
  const selected = signal<Instance | null>(null);
  const showValues = signal<boolean>(loadJSON('dp-values', true));
  const animate = signal<boolean>(loadJSON('dp-animate', true));
  const cla = signal<boolean>(loadJSON('dp-cla', false));
  showValues.subscribe(v => saveJSON('dp-values', v));
  animate.subscribe(v => saveJSON('dp-animate', v));

  // Visualising needs a hardware engine.
  if (session.mode.peek() === 'isa') setMode('single');
  let engine = session.engine instanceof SingleCycleEngine ? session.engine : null;

  // ---------------------------------------------------------------- DOM
  const canvas = h('canvas', { class: 'dp-canvas', tabIndex: 0, 'aria-label': 'CPU datapath diagram. Scroll to zoom, drag to pan, double-click a block to dive in.' });
  const stage = h('div', { class: 'dp-stage' }, canvas);
  const overlay = h('div', { class: 'dp-overlay hidden' });
  stage.append(overlay);
  const crumbs = h('nav', { class: 'dp-crumbs', 'aria-label': 'Abstraction path' });
  const slider = h('input', { type: 'range', class: 'dp-slider', min: '0', max: '1', step: '0.001', value: '1', 'aria-label': 'Abstraction level' });
  const sliderTicks = h('div', { class: 'dp-ticks' });
  const sliderWrap = h('div', { class: 'dp-abstraction' },
    h('span', { class: 'dp-ab-end' }, icon('layers')), h('div', { class: 'dp-slider-box' }, slider, sliderTicks));
  const toggle = (label: string, title: string, sig: Signal<boolean>) => {
    const b = h('button', { class: 'btn small ghost toggle', title, 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => { sig.value = !sig.value; });
    effect(() => { b.classList.toggle('on', sig.value); b.setAttribute('aria-pressed', String(sig.value)); });
    return b;
  };
  const fitBtn = h('button', { class: 'iconbtn', title: 'Fit (0)', 'aria-label': 'Fit view' }, icon('fit'));
  const zoomIn = h('button', { class: 'iconbtn', title: 'Deeper (+)', 'aria-label': 'Zoom in one level' }, icon('zoomIn'));
  const zoomOut = h('button', { class: 'iconbtn', title: 'Higher (−)', 'aria-label': 'Zoom out one level' }, icon('zoomOut'));
  const hwTools = [
    toggle('Values', 'Show bus values', showValues),
    toggle('Wavefront', 'Animate signal propagation after each clock edge', animate),
    toggle('CLA', 'Use a carry-lookahead adder instead of ripple-carry (faster, more gates)', cla),
    zoomOut, zoomIn, fitBtn];
  const title = h('span', null, 'Datapath');
  const head = h('div', { class: 'panel-head dp-head' },
    icon('cpu'), title, crumbs, h('span', { class: 'spacer' }), ...hwTools);
  const wave = h('div', { class: 'dp-wave hidden' });
  const legend = h('div', { class: 'dp-legend' },
    h('span', { class: 'lg data' }, 'data'), h('span', { class: 'lg ctrl' }, 'control'), h('span', { class: 'lg addr' }, 'address'),
    h('span', { class: 'lg zero' }, '0'), h('span', { class: 'faint' }, docked ? 'scroll zoom · drag pan · dbl-click dive · shift-click pin' : 'Scroll to zoom · drag to pan · double-click a block to dive in · shift-click a wire to pin it to the waveform'));
  const bottom = h('div', { class: 'dp-bottom' }, sliderWrap, legend);
  const pipeHost = h('div', { class: 'dp-pipe hidden' });
  const body = h('div', { class: 'dp-body' }, stage, pipeHost, bottom, wave);
  el.classList.add('dp-root');
  el.append(head, body);

  // ---------------------------------------------------------------- renderer
  let cpu = engine?.cpu ?? null;
  let waveStart = 0, waveDur = 0, waveMax = 0;
  const now = () => performance.now();
  let renderer: Renderer | null = null;
  const env = {
    machine: session.machine,
    time: () => {
      if (!waveDur) return Infinity;
      const e = now() - waveStart;
      if (e >= waveDur) { waveDur = 0; return Infinity; }
      return (e / waveDur) * waveMax;
    },
    showValues: () => showValues.peek(),
  };

  let levels: Level[] = [];
  let focus: Instance | null = null;
  let pos = 1;
  let camAnim: { from: Cam; to: Cam; t0: number; dur: number; pos0: number; pos1: number } | null = null;
  let dirty = true;
  let lastVersion = -1;

  function levelRect(l: Level): Rect {
    if (!l.inst) return SYSTEM;
    return renderer!.worldRect(l.inst);
  }
  function levelCam(i: number): Cam {
    const l = levels[i];
    return renderer!.fitCamera(levelRect(l), !l.inst ? 0.01 : l.inst === cpu ? 0.015 : 0.04);
  }
  function camAt(p: number): Cam {
    const i = Math.max(0, Math.min(levels.length - 1, Math.floor(p)));
    const f = p - i;
    if (i >= levels.length - 1 || f < 1e-4) return levelCam(i);
    return lerpCam(levelCam(i), levelCam(i + 1), f);
  }

  function buildLevels(f: Instance): void {
    const chain: Instance[] = [];
    for (let i: Instance | null = f; i; i = i.parent) chain.unshift(i);
    let cur = chain[chain.length - 1];
    for (let guard = 0; guard < 12; guard++) {
      const c = defaultChild(cur);
      if (!c) break;
      chain.push(c);
      cur = c;
    }
    levels = [{ inst: null, label: 'System' }, ...chain.map(i => ({ inst: i, label: levelLabel(i, cpu!) }))];
    focus = f;
    slider.max = String(levels.length - 1);
    sliderTicks.replaceChildren(...levels.map((l, i) => {
      const b = h('button', { class: 'dp-tick', style: `left:${(100 * i) / Math.max(1, levels.length - 1)}%`, title: l.inst?.def.doc ?? 'The CPU with memory and devices on the system bus' }, l.label);
      b.addEventListener('click', () => flyTo(i));
      return b;
    }));
    renderCrumbs();
  }

  function renderCrumbs(): void {
    const cur = Math.round(pos);
    crumbs.replaceChildren(...levels.slice(0, cur + 1).flatMap((l, i) => {
      const a = h('button', { class: 'crumb' + (i === cur ? ' on' : '') }, l.label);
      a.addEventListener('click', () => flyTo(i));
      return i ? [h('span', { class: 'sep' }, '›'), a] : [a];
    }));
    [...sliderTicks.children].forEach((t, i) => t.classList.toggle('on', i === cur));
    sliderTicks.classList.toggle('compact', sliderTicks.clientWidth > 0 && sliderTicks.clientWidth < levels.length * 78);
  }

  function setPos(p: number, updateCam = true): void {
    pos = Math.max(0, Math.min(levels.length - 1, p));
    slider.value = String(pos);
    if (updateCam && renderer) renderer.cam = camAt(pos);
    renderCrumbs();
    dirty = true;
  }

  function flyTo(i: number, dur = 650): void {
    if (!renderer) return;
    const to = levelCam(Math.max(0, Math.min(levels.length - 1, i)));
    camAnim = { from: { ...renderer.cam }, to, t0: now(), dur, pos0: pos, pos1: i };
    dirty = true;
  }

  function focusOn(inst: Instance): void {
    if (!cpu) return;
    buildLevels(inst);
    const idx = levels.findIndex(l => l.inst === inst);
    flyTo(idx);
  }

  /** Derive the slider position from a free camera (after wheel zoom / pan). */
  function syncPosFromCam(): void {
    if (!renderer) return;
    // Refocus on the deepest block that fills most of the view.
    const cx = renderer.vw / 2, cy = renderer.vh / 2;
    let best: Instance | null = null, bestDepth = -1;
    for (const hn of renderer.hitNodes) {
      const r = hn.rect;
      const fill = Math.min(r.w / renderer.vw, r.h / renderer.vh);
      if (fill > 0.55 && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h && expandable(hn.inst) && hn.depth > bestDepth) { best = hn.inst; bestDepth = hn.depth; }
    }
    if (best && !levels.some(l => l.inst === best)) buildLevels(best);
    const k = renderer.cam.k;
    const ks = levels.map((_, i) => levelCam(i).k);
    let p = 0;
    if (k <= ks[0]) p = 0;
    else if (k >= ks[ks.length - 1]) p = ks.length - 1;
    else for (let i = 0; i + 1 < ks.length; i++) {
      if (k >= ks[i] && k <= ks[i + 1]) { p = i + Math.log(k / ks[i]) / Math.log(ks[i + 1] / ks[i]); break; }
    }
    setPos(p, false);
  }

  let pipe: PipelineEngine | null = null;
  let pview: PipelineView | null = null;
  let pipeVersion = -1;
  function attach(): void {
    pipe = session.engine instanceof PipelineEngine ? session.engine : null;
    for (const e of [stage, bottom, crumbs, ...hwTools]) e.classList.toggle('hidden', !!pipe);
    pipeHost.classList.toggle('hidden', !pipe);
    title.textContent = pipe ? '5-stage pipeline' : 'Datapath';
    if (pipe) {
      engine = null;
      if (!pview) { pview = pipelineView(); pipeHost.append(pview.el); }
      pipeVersion = -1;
      return;
    }
    engine = session.engine instanceof SingleCycleEngine ? session.engine : null;
    overlay.classList.toggle('hidden', !!engine);
    if (!engine) {
      overlay.replaceChildren(h('div', { class: 'dp-ov-card' },
        h('h4', null, 'The datapath is shown in hardware modes'),
        h('p', { class: 'dim' }, 'The fast ISA simulator executes whole instructions without modelling the hardware.'),
        (() => { const b = h('button', { class: 'btn primary' }, 'Switch to single-cycle'); b.addEventListener('click', () => setMode('single')); return b; })()));
      return;
    }
    if (engine.cpu === cpu && renderer) return;
    cpu = engine.cpu;
    renderer = new Renderer(canvas, cpu, env);
    const r = stage.getBoundingClientRect();
    renderer.resize(Math.max(50, r.width), Math.max(50, r.height));
    const start = loadJSON<string>('dp-focus', '');
    let f: Instance = cpu;
    if (start) for (const part of start.split('/').slice(1)) { const c = f.child(part); if (!c) break; f = c; }
    buildLevels(f);
    const p = loadJSON<number>('dp-pos', 1);
    setPos(Math.min(p, levels.length - 1));
    lastVersion = -1;
    dirty = true;
  }
  effect(() => { session.mode.value; attach(); });

  // CLA ⇄ ripple: rebuild the adders.
  cla.subscribe(v => {
    saveJSON('dp-cla', v);
    if (ADDER_CHOICE.cla === v) return;
    ADDER_CHOICE.cla = v;
    clearDelayCache();
    if (!cpu || !engine) return;
    for (const n of cpu.structure!.nodes) if (n.inst.hasStructure) n.inst.rebuild();
    engine.evaluate();
    buildLevels(focus && focus.parent === cpu ? focus : cpu);
    setPos(Math.min(pos, levels.length - 1));
  });
  if (cla.peek() !== ADDER_CHOICE.cla) { const v = cla.peek(); cla.value = !v; cla.value = v; }

  // ---------------------------------------------------------------- waveform
  const pins = new Map<Net, { owner: Instance; label: string; samples: { c: number; v: number }[] }>();
  const waveCanvas = h('canvas', { class: 'dp-wave-canvas' });
  const waveHead = h('div', { class: 'dp-wave-head' }, icon('wave'), h('span', null, 'Waveforms'), h('span', { class: 'faint' }, 'last 32 cycles · shift-click a wire to add/remove'));
  const clearPins = h('button', { class: 'btn small ghost' }, 'Clear');
  clearPins.addEventListener('click', () => { pins.clear(); renderer?.pinned.clear(); updateWave(); dirty = true; });
  waveHead.append(h('span', { class: 'spacer' }), clearPins);
  wave.append(waveHead, waveCanvas);

  function evalChain(i: Instance): void {
    if (i.parent) { evalChain(i.parent); i.ensureEvaluated(); }
  }
  function sample(): void {
    const c = session.machine.cycles;
    for (const p of pins.values()) {
      evalChain(p.owner);
      const net = [...pins.entries()].find(e => e[1] === p)![0];
      while (p.samples.length && p.samples[p.samples.length - 1].c >= c) p.samples.pop();
      p.samples.push({ c, v: net.value });
      if (p.samples.length > 64) p.samples.shift();
    }
  }
  function togglePin(net: Net, owner: Instance): void {
    if (pins.has(net)) { pins.delete(net); renderer?.pinned.delete(net); }
    else {
      const path = owner === cpu ? '' : owner.path.split('/').slice(1).join('/') + ' · ';
      pins.set(net, { owner, label: path + net.name, samples: [] });
      renderer?.pinned.add(net);
      sample();
    }
    updateWave();
    dirty = true;
  }
  function updateWave(): void {
    wave.classList.toggle('hidden', pins.size === 0);
    if (!pins.size) return;
    const th = theme();
    const rowH = 22, nameW = 150, N = 32;
    const w = Math.max(200, wave.clientWidth - 2);
    const hgt = pins.size * rowH + 18;
    const dpr = Math.min(2, devicePixelRatio || 1);
    waveCanvas.width = w * dpr; waveCanvas.height = hgt * dpr;
    waveCanvas.style.width = w + 'px'; waveCanvas.style.height = hgt + 'px';
    const ctx = waveCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const c1 = session.machine.cycles, c0 = c1 - N + 1;
    const cw = (w - nameW - 10) / N;
    const X = (c: number) => nameW + (c - c0) * cw;
    ctx.font = `500 10px ${th.mono}`;
    ctx.textBaseline = 'middle';
    for (let c = c0; c <= c1; c++) {
      if (c < 0) continue;
      ctx.fillStyle = c % 2 ? 'transparent' : th.grid;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(X(c), 0, cw, hgt - 16);
      ctx.globalAlpha = 1;
      if (c % 4 === 0) { ctx.fillStyle = th.faint; ctx.textAlign = 'left'; ctx.fillText(String(c), X(c) + 2, hgt - 8); }
    }
    let row = 0;
    for (const [net, p] of pins) {
      const y = row * rowH + 3, yh = rowH - 6;
      ctx.fillStyle = th.dim;
      ctx.textAlign = 'left';
      ctx.fillText(p.label.length > 22 ? '…' + p.label.slice(-21) : p.label, 6, y + yh / 2);
      const col = net.kind === 'ctrl' ? th.ctrl : net.kind === 'addr' ? th.addr : th.data;
      const samples = p.samples.filter(s => s.c >= c0 - 1);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const xa = Math.max(nameW, X(s.c)), xb = i + 1 < samples.length ? X(samples[i + 1].c) : X(c1 + 1);
        if (xb <= xa) continue;
        if (net.width === 1) {
          const yy = s.v ? y + 2 : y + yh - 2;
          ctx.beginPath();
          if (i > 0 && samples[i - 1].v !== s.v && X(s.c) >= nameW) { ctx.moveTo(xa, samples[i - 1].v ? y + 2 : y + yh - 2); ctx.lineTo(xa, yy); }
          else ctx.moveTo(xa, yy);
          ctx.lineTo(xb, yy);
          ctx.stroke();
        } else {
          const d = 3;
          ctx.beginPath();
          ctx.moveTo(xa, y + yh / 2); ctx.lineTo(xa + d, y + 1); ctx.lineTo(xb - d, y + 1); ctx.lineTo(xb, y + yh / 2);
          ctx.lineTo(xb - d, y + yh - 1); ctx.lineTo(xa + d, y + yh - 1); ctx.closePath();
          ctx.stroke();
          const t = fmtVal(s.v, net.width);
          if (ctx.measureText(t).width < xb - xa - 8) { ctx.fillStyle = th.text; ctx.textAlign = 'center'; ctx.fillText(t, (xa + xb) / 2, y + yh / 2); }
        }
      }
      row++;
    }
  }

  // ---------------------------------------------------------------- loop
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (pipe && pview && pipe.version !== pipeVersion && el.isConnected) { pipeVersion = pipe.version; pview.update(pipe); }
    if (!renderer || !engine || !el.isConnected) return;
    if (engine.version !== lastVersion) {
      const first = lastVersion < 0;
      lastVersion = engine.version;
      const speed = session.speed.peek();
      const fast = session.running.peek() && (speed === 0 || speed > 8);
      if (animate.peek() && !fast && !first) {
        waveStart = now();
        waveMax = 0;
        for (const n of engine.structure.nets) if (Number.isFinite(n.arrival)) waveMax = Math.max(waveMax, n.arrival);
        waveDur = session.running.peek() ? Math.min(900, 800 / Math.max(1, speed)) : 900;
      } else waveDur = 0;
      if (pins.size) { sample(); updateWave(); }
      dirty = true;
    }
    if (camAnim) {
      const f = Math.min(1, (now() - camAnim.t0) / camAnim.dur);
      const e = ease(f);
      renderer.cam = lerpCam(camAnim.from, camAnim.to, e);
      pos = camAnim.pos0 + (camAnim.pos1 - camAnim.pos0) * e;
      slider.value = String(pos);
      if (f >= 1) { pos = camAnim.pos1; camAnim = null; renderCrumbs(); persist(); }
      dirty = true;
    }
    if (waveDur) dirty = true;
    if (!dirty) return;
    dirty = false;
    renderer.draw();
  };
  raf = requestAnimationFrame(loop);
  onCleanup(() => cancelAnimationFrame(raf));

  let persistTimer = 0;
  function persist(): void {
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      saveJSON('dp-pos', pos);
      if (focus) saveJSON('dp-focus', focus.path);
    }, 300);
  }

  const ro = new ResizeObserver(() => {
    if (!renderer) return;
    const r = stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    renderer.resize(r.width, r.height);
    if (!camAnim) renderer.cam = camAt(pos);
    if (pins.size) updateWave();
    dirty = true;
  });
  ro.observe(stage);
  onCleanup(() => ro.disconnect());
  const onTheme = () => { invalidateTheme(); dirty = true; if (pins.size) updateWave(); };
  window.addEventListener('themechange', onTheme);
  onCleanup(() => window.removeEventListener('themechange', onTheme));
  effect(() => { showValues.value; dirty = true; });
  effect(() => { session.tick.track(); dirty = true; });

  // ---------------------------------------------------------------- input
  slider.addEventListener('input', () => { camAnim = null; setPos(Number(slider.value)); persist(); });
  fitBtn.addEventListener('click', () => flyTo(Math.round(pos)));
  zoomIn.addEventListener('click', () => flyTo(Math.min(levels.length - 1, Math.floor(pos + 1e-3) + 1)));
  zoomOut.addEventListener('click', () => flyTo(Math.max(0, Math.ceil(pos - 1e-3) - 1)));

  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const local = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('wheel', e => {
    if (!renderer) return;
    e.preventDefault();
    camAnim = null;
    const [sx, sy] = local(e);
    const [wx, wy] = renderer.toWorld(sx, sy);
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    const kMin = levelCam(0).k * 0.6, kMax = 400;
    const k = Math.max(kMin, Math.min(kMax, renderer.cam.k * f));
    renderer.cam = { k, x: wx - sx / k, y: wy - sy / k };
    renderer.draw();
    syncPosFromCam();
    persist();
    dirty = true;
  }, { passive: false });

  canvas.addEventListener('pointerdown', e => {
    if (!renderer || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (!renderer) return;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        camAnim = null;
        renderer.cam = { k: renderer.cam.k, x: drag.cx - dx / renderer.cam.k, y: drag.cy - dy / renderer.cam.k };
        canvas.style.cursor = 'grabbing';
        hideTip();
        dirty = true;
        return;
      }
    }
    const [sx, sy] = local(e);
    const hit = renderer.hitTest(sx, sy);
    const inst = hit.net ? null : hit.node?.inst ?? null;
    if (hit.net !== renderer.hover.net || inst !== renderer.hover.inst) {
      renderer.hover = { net: hit.net, inst };
      dirty = true;
    }
    canvas.style.cursor = hit.net ? 'crosshair' : inst && inst !== cpu ? 'pointer' : 'default';
    const tipEl = hit.net ? netTip(hit.net) : inst ? instTip(inst) : null;
    if (tipEl) showTip(tipEl, e.clientX, e.clientY); else hideTip();
  });
  canvas.addEventListener('pointerup', e => {
    if (!renderer) return;
    const wasDrag = drag?.moved;
    drag = null;
    canvas.style.cursor = 'default';
    if (wasDrag) { syncPosFromCam(); persist(); return; }
    const [sx, sy] = local(e);
    const hit = renderer.hitTest(sx, sy);
    if (hit.net && e.shiftKey) {
      const h2 = renderer.hitNets.find(x => x.net === hit.net);
      if (h2) togglePin(hit.net, h2.s.owner);
      return;
    }
    const inst = hit.node?.inst ?? null;
    renderer.selected = inst && inst !== cpu ? inst : null;
    selected.value = renderer.selected;
    dirty = true;
  });
  canvas.addEventListener('pointerleave', () => { hideTip(); if (renderer) { renderer.hover = { net: null, inst: null }; dirty = true; } });
  canvas.addEventListener('dblclick', e => {
    if (!renderer) return;
    const [sx, sy] = local(e);
    const hit = renderer.hitTest(sx, sy);
    const inst = hit.node?.inst;
    if (inst && isGate(inst) && renderer.revealOf(renderer.worldRect(inst)) === 0 && (hit.node!.rect.w > 60)) { showCmos(inst); return; }
    if (inst && expandable(inst)) focusOn(inst);
    else if (inst?.parent) focusOn(inst.parent);
  });
  canvas.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') { flyTo(Math.min(levels.length - 1, Math.floor(pos + 1e-3) + 1)); e.preventDefault(); }
    else if (e.key === '-') { flyTo(Math.max(0, Math.ceil(pos - 1e-3) - 1)); e.preventDefault(); }
    else if (e.key === '0') { flyTo(Math.round(pos)); e.preventDefault(); }
    else if (e.key === 'Escape') { renderer!.selected = null; selected.value = null; dirty = true; }
  });

  if (import.meta.env.DEV) (globalThis as unknown as { __dp: unknown }).__dp = { get renderer() { return renderer; }, get levels() { return levels; }, get pos() { return pos; }, levelCam, camAt };
  return { selected, focusOn };
}

export { CPU_RECT };
