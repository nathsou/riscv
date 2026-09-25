/**
 * Canvas renderer for the hierarchical datapath with semantic zoom: blocks
 * that grow large on screen fade into their internal structure, all the way
 * down to logic gates. Values are live; wires light up as signals settle.
 */
import type { Instance, Net, Node, Structure } from '../hw/netlist.ts';
import { delays } from '../hw/netlist.ts';
import { layout, sourceOf, terminalPos, portPos } from './geometry.ts';
import { shapePath, roundRect, glyph } from './shapes.ts';
import { theme, alpha } from './theme.ts';
import type { Theme } from './theme.ts';
import { drawInterior as drawCustomInterior, drawSystem, SYSTEM, CPU_RECT } from './interiors.ts';
import type { Machine } from '../sim/machine.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Xf { ox: number; oy: number; k: number }

export interface HitNode { inst: Instance; node: Node | null; rect: Rect; world: Rect; depth: number }
export interface HitNet { net: Net; pts: number[]; depth: number; s: Structure }

/** Reveal a block's interior as its expanded rect grows from this fraction of the view to that. */
const REVEAL_START = 0.5;
const REVEAL_END = 0.8;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function interiorXf(s: Structure, r: Rect): Xf {
  const head = Math.min(r.h * 0.1, 26, r.w * 0.08);
  const pad = Math.min(r.w, r.h) * 0.025;
  const aw = r.w - 2 * pad, ah = r.h - head - 2 * pad;
  const k = Math.max(1e-6, Math.min(aw / s.w, ah / s.h));
  return { ox: r.x + pad + (aw - s.w * k) / 2, oy: r.y + head + pad + (ah - s.h * k) / 2, k };
}

export function fmtVal(v: number, width: number): string {
  if (width === 1) return String(v & 1);
  if (width <= 5) return String(v);
  if (width <= 12) return '0x' + v.toString(16);
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

export interface RendererEnv {
  machine: Machine | null;
  /** Current animation time in gate delays, or Infinity when settled. */
  time(): number;
  /** Seconds since the last clock edge (for pulses). */
  showValues(): boolean;
  /** Reduce detail for small, decorative diagrams. */
  compact?: boolean;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cpu: Instance;
  env: RendererEnv;
  cam = { x: 0, y: 0, k: 0.5 };
  vw = 800;
  vh = 600;
  dpr = 1;
  hover: { net: Net | null; inst: Instance | null } = { net: null, inst: null };
  selected: Instance | null = null;
  pinned = new Set<Net>();
  hitNodes: HitNode[] = [];
  hitNets: HitNet[] = [];
  private th!: Theme;
  private t = Infinity;

  /** World rect of the root block. */
  rootRect: Rect;
  /** Root is a whole CPU: draw the system around it, control nets as tunnels, dim unused paths. */
  cpuMode: boolean;

  constructor(canvas: HTMLCanvasElement, cpu: Instance, env: RendererEnv, opts: { rootRect?: Rect; cpuMode?: boolean } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.cpu = cpu;
    this.env = env;
    this.cpuMode = opts.cpuMode ?? true;
    this.rootRect = opts.rootRect ?? CPU_RECT;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = w;
    this.vh = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  // ------------------------------------------------------------ coordinates
  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.k, (wy - this.cam.y) * this.cam.k];
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [sx / this.cam.k + this.cam.x, sy / this.cam.k + this.cam.y];
  }
  screenRect(r: Rect): Rect {
    const [x, y] = this.toScreen(r.x, r.y);
    return { x, y, w: r.w * this.cam.k, h: r.h * this.cam.k };
  }

  /** Camera that fits a world rect in the view. */
  fitCamera(r: Rect, margin = 0.06): { x: number; y: number; k: number } {
    const k = Math.min(this.vw / (r.w * (1 + 2 * margin)), this.vh / (r.h * (1 + 2 * margin)));
    return { k, x: r.x + r.w / 2 - this.vw / 2 / k, y: r.y + r.h / 2 - this.vh / 2 / k };
  }

  /** World rect of an instance when it and all its ancestors are fully revealed. */
  worldRect(inst: Instance): Rect {
    if (inst === this.cpu || !inst.parent) return this.rootRect;
    const pr = this.worldRect(inst.parent);
    const ps = inst.parent.structure!;
    layout(ps);
    const xf = interiorXf(ps, pr);
    const node = ps.nodes.find(n => n.inst === inst)!;
    const r = { x: xf.ox + node.x * xf.k, y: xf.oy + node.y * xf.k, w: node.w * xf.k, h: node.h * xf.k };
    return expandedRect(inst, r, { x: xf.ox, y: xf.oy, w: ps.w * xf.k, h: ps.h * xf.k });
  }

  /** How revealed (0..1) a block is whose fully-expanded world rect is `e`. */
  revealOf(e: Rect): number {
    const k = this.cam.k;
    const c = Math.max((e.w * k) / this.vw, (e.h * k) / this.vh);
    if (c < REVEAL_START) return 0;
    // Only the block under the centre of the view opens up.
    const [cx, cy] = this.toWorld(this.vw / 2, this.vh / 2);
    const d = Math.max(Math.abs(cx - (e.x + e.w / 2)) / (e.w / 2), Math.abs(cy - (e.y + e.h / 2)) / (e.h / 2));
    return smoothstep(REVEAL_START, REVEAL_END, c) * (1 - smoothstep(0.75, 1.05, d));
  }

  // ------------------------------------------------------------ drawing
  draw(): void {
    this.th = theme();
    this.t = this.env.time();
    const { ctx, th } = this;
    this.hitNodes = [];
    this.hitNets = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.cam.k * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.cam.x * k, -this.cam.y * k);
    this.drawGrid();
    if (this.cpuMode && this.env.machine) drawSystem(ctx, this.sc(1), th, this.env.machine, this.cpu);
    this.drawBlock(this.cpu, this.rootRect, null, 1, 1, null);
  }

  private sc(localK: number): number { return this.cam.k * localK; }

  private drawGrid(): void {
    const { ctx, th } = this;
    let step = 20;
    while (step * this.cam.k < 14) step *= 4;
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.vw, this.vh);
    ctx.fillStyle = th.grid;
    const r = 1.1 / this.cam.k;
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step)
      for (let y = Math.floor(y0 / step) * step; y < y1; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }

  /**
   * Draw an instance occupying world rect `r`. `node` is its node in the
   * parent structure (null for the CPU). `live` = drawn at full emphasis.
   */
  private drawBlock(inst: Instance, r0: Rect, node: Node | null, depth: number, emphasis: number, parentR: Rect | null): void {
    const { ctx, th } = this;
    const def = inst.def;
    const expandable = inst.hasStructure || !!def.interior;
    let reveal = 0, r = r0;
    if (inst === this.cpu) reveal = 1;
    else if (expandable && depth < 10) {
      const e = expandedRect(inst, r0, parentR);
      reveal = this.revealOf(e);
      if (reveal > 0) r = lerpRect(r0, e, reveal);
    }
    const sr = this.screenRect(r);
    if (sr.x > this.vw || sr.y > this.vh || sr.x + sr.w < 0 || sr.y + sr.h < 0) return;
    if (reveal > 0.01 && node) {
      // lift the lens above its neighbours
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 24 * reveal;
      ctx.fillStyle = th.panel;
      ctx.beginPath();
      roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.04);
      ctx.fill();
      ctx.restore();
    }
    this.hitNodes.push({ inst, node, rect: sr, world: r, depth });
    const kind = node ? blockColor(node, th) : th.line3;
    const hovered = this.hover.inst === inst;
    const selected = this.selected === inst;
    const px = 1 / this.cam.k;

    // body
    if (node && reveal < 0.5) {
      const saved = { x: node.x, y: node.y, w: node.w, h: node.h };
      node.x = r.x; node.y = r.y; node.w = r.w; node.h = r.h;
      shapePath(ctx, node);
      node.x = saved.x; node.y = saved.y; node.w = saved.w; node.h = saved.h;
    } else if (node) {
      ctx.beginPath();
      roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.04);
    } else {
      ctx.beginPath();
      roundRect(ctx, r.x, r.y, r.w, r.h, 10 * px);
    }
    const isWiring = def.wiring;
    const fillA = reveal > 0 ? 0.55 + 0.45 * (1 - reveal) : 1;
    ctx.fillStyle = alpha(isWiring ? th.bg2 : th.panel, fillA * emphasis + (1 - emphasis) * 0.4);
    ctx.fill();
    ctx.lineWidth = (hovered || selected ? 2 : node && node.inst.def.shape && ['split', 'join'].includes(node.inst.def.shape) ? 0 : 1.2) * px;
    ctx.strokeStyle = selected ? th.data : hovered ? th.text : alpha(kind, 0.35 + 0.65 * emphasis);
    ctx.lineJoin = 'round';
    if (ctx.lineWidth) ctx.stroke();
    if (def.shape === 'split' || def.shape === 'join') {
      ctx.fillStyle = alpha(th.dim, 0.8);
      ctx.fill();
    }
    if (def.shape === 'reg' && node) this.clockMark(r);

    // interior
    if (reveal > 0.01) {
      ctx.save();
      ctx.globalAlpha *= reveal;
      this.header(inst, r, sr);
      if (def.interior) {
        drawCustomInterior(ctx, inst, r, this.cam.k, th, this.env.machine, this.t);
      } else {
        const s = inst === this.cpu ? inst.structure! : inst.ensureEvaluated()!;
        layout(s);
        this.drawStructure(s, interiorXf(s, r), depth, inst === this.cpu && this.cpuMode);
      }
      ctx.restore();
    }
    // face
    if (reveal < 0.99) {
      ctx.save();
      ctx.globalAlpha *= (1 - reveal) * (0.5 + 0.5 * emphasis);
      this.face(inst, r, sr, node);
      ctx.restore();
    }
  }

  private clockMark(r: Rect): void {
    const { ctx, th } = this;
    const s = Math.min(r.w, r.h) * 0.16;
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 2 - s, r.y + r.h);
    ctx.lineTo(r.x + r.w / 2, r.y + r.h - s);
    ctx.lineTo(r.x + r.w / 2 + s, r.y + r.h);
    ctx.strokeStyle = alpha(th.clock, 0.6);
    ctx.lineWidth = 1 / this.cam.k;
    ctx.stroke();
  }

  private text(str: string, x: number, y: number, worldSize: number, color: string, align: CanvasTextAlign = 'center', mono = false, weight = 500): boolean {
    const px = worldSize * this.cam.k;
    if (px < (this.env.compact ? 11 : 8)) return false;
    const { ctx } = this;
    ctx.font = `${weight} ${worldSize}px ${mono ? this.th.mono : this.th.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
    return true;
  }

  private header(inst: Instance, r: Rect, sr: Rect): void {
    if (inst === this.cpu && this.cpuMode) {
      const size = Math.min(22, r.h * 0.04);
      this.text(inst.def.name, r.x + 14 / this.cam.k + size * 0.3, r.y + size, size, this.th.dim, 'left', false, 650);
      return;
    }
    const head = Math.min(r.h * 0.1, 26, r.w * 0.08);
    const size = Math.min(head * 0.62, 15 / this.cam.k);
    if (size * this.cam.k < 6) return;
    const lvl = inst.def.level ? `  ·  ${inst.def.level}` : '';
    this.text(inst.def.name + lvl, r.x + head * 0.4, r.y + head * 0.55, size, this.th.dim, 'left', false, 600);
    void sr;
  }

  private face(inst: Instance, r: Rect, sr: Rect, node: Node | null): void {
    const { th } = this;
    const def = inst.def;
    if (def.wiring) {
      if (def.shape === 'const') {
        const l = def.label?.(inst) ?? '';
        this.text(l, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.h * 0.7, 12), th.dim, 'center', true);
      } else if (def.shape === 'wire') {
        this.text(def.name, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.h * 0.55, r.w / Math.max(3, def.name.length) * 1.5, 11), th.faint, 'center', true);
      }
      return;
    }
    const gl = node ? glyph(node) : null;
    const gate = ['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not', 'buf'].includes(def.shape ?? '');
    if (gate) {
      if (sr.w > 40) this.text(def.type.replace(/\d+$/, ''), r.x + r.w * 0.42, r.y + r.h / 2, Math.min(r.h * 0.26, 9), th.faint, 'center', false, 600);
      return;
    }
    if (def.shape === 'mux') {
      const l = def.label?.(inst);
      if (l) this.text(l, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w * 0.34, 11), th.ctrl, 'center', true, 600);
      if (sr.h > 70) this.inputLabels(inst, r, node!);
      return;
    }
    const title = gl ?? shortName(inst);
    // wrap long titles onto two lines when that makes them larger
    const words = title.split(' ');
    const lines = title.length > 10 && words.length > 1 && r.h > r.w * 0.5
      ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [title];
    const longest = Math.max(...lines.map(x => x.length));
    const baseSize = Math.min(r.h * 0.2, r.w / Math.max(4, longest) * 1.5, 18);
    // Keep the names of major blocks legible in a docked or mobile overview.
    const readable = sr.w >= longest * 5.4 + 8 && sr.h >= 22;
    const tsize = readable ? Math.max(baseSize, 9.5 / this.cam.k) : baseSize;
    const cy = r.y + r.h / 2;
    const l = def.label?.(inst);
    const ty = (l ? cy - tsize * 0.45 : cy) - (lines.length - 1) * tsize * 0.55;
    lines.forEach((ln, i) => this.text(ln, r.x + r.w / 2, ty + i * tsize * 1.1, tsize, th.text, 'center', false, 650));
    if (l) this.text(l, r.x + r.w / 2, cy + tsize * 0.75 + (lines.length - 1) * tsize * 0.55, tsize * 0.7, th.ctrl, 'center', true, 600);
    if (node && sr.w > 110 && sr.h > 50) this.portLabels(inst, r, node);
  }

  private inputLabels(inst: Instance, r: Rect, node: Node): void {
    const def = inst.def;
    const sel = inst.inVals[def.inputs.length - 1];
    def.inputs.slice(0, -1).forEach((p, i) => {
      const pp = portPos({ ...node, x: r.x, y: r.y, w: r.w, h: r.h } as Node, 'in', i);
      this.text(p.name, pp.x + 3 / this.cam.k, pp.y, Math.min(r.w * 0.2, 7), i === sel ? this.th.ctrl : this.th.faint, 'left', true);
    });
  }

  private portLabels(inst: Instance, r: Rect, node: Node): void {
    const def = inst.def;
    const size = Math.min(10, r.h * 0.09, r.w * 0.09);
    const n2 = { ...node, x: r.x, y: r.y, w: r.w, h: r.h } as Node;
    const lab = (name: string, dir: 'in' | 'out', i: number) => {
      const p = portPos(n2, dir, i);
      const off = 4 / this.cam.k;
      const [dx, dy, al] = p.side === 'l' ? [off, 0, 'left'] : p.side === 'r' ? [-off, 0, 'right'] : p.side === 't' ? [0, size * 0.9, 'center'] : [0, -size * 0.9, 'center'];
      this.text(name, p.x + dx, p.y + dy, size, this.th.faint, al as CanvasTextAlign, true);
    };
    def.inputs.forEach((p, i) => { if (!p.quiet) lab(p.name, 'in', i); });
    def.outputs.forEach((p, i) => { if (!p.quiet) lab(p.name, 'out', i); });
  }

  // ------------------------------------------------------------ structures
  private drawStructure(s: Structure, xf: Xf, depth: number, top: boolean): void {
    const { ctx, th } = this;
    ctx.save();
    ctx.translate(xf.ox, xf.oy);
    ctx.scale(xf.k, xf.k);
    const sc = this.cam.k * xf.k;
    const px = 1 / sc;
    // terminals
    if (!top) {
      s.inputs.forEach((n, i) => this.terminal(s, 'in', i, n, sc));
      s.outputs.forEach((n, i) => this.terminal(s, 'out', i, n, sc));
    }
    // wires
    for (const net of s.nets) this.drawNet(net, s, xf, sc, depth, top);
    // nodes
    ctx.restore();
    const ownR = { x: xf.ox, y: xf.oy, w: s.w * xf.k, h: s.h * xf.k };
    const items = [];
    for (const node of s.nodes) {
      if (!node.w) continue;
      const r = { x: xf.ox + node.x * xf.k, y: xf.oy + node.y * xf.k, w: node.w * xf.k, h: node.h * xf.k };
      const big = (node.inst.hasStructure || !!node.inst.def.interior) ? this.revealOf(expandedRect(node.inst, r, ownR)) : 0;
      items.push({ node, r, big });
    }
    items.sort((a, b) => a.big - b.big);
    const drawItem = ({ node, r }: { node: Node; r: Rect }) => {
      const emph = top ? (node.outs.some(o => o.live) || node.ins.some(i => i.live) ? 1 : 0.35) : 1;
      this.drawBlock(node.inst, r, node, depth + 1, emph, ownR);
    };
    const lenses = items.filter(i => i.big > 0.01);
    for (const it of items) if (it.big <= 0.01) drawItem(it);
    // value chips above the blocks, but below any opened lens
    if (this.env.showValues()) {
      ctx.save();
      ctx.translate(xf.ox, xf.oy);
      ctx.scale(xf.k, xf.k);
      for (const net of s.nets) this.valueChip(net, sc, top);
      ctx.restore();
    }
    if (lenses.length) {
      // veil the surrounding context so the opened block stands out
      const [x0, y0] = this.toWorld(0, 0);
      ctx.fillStyle = alpha(th.bg, 0.55 * Math.max(...lenses.map(l => l.big)));
      ctx.fillRect(x0, y0, this.vw / this.cam.k, this.vh / this.cam.k);
      for (const it of lenses) drawItem(it);
    }
    void px; void th;
  }

  private terminal(s: Structure, dir: 'in' | 'out', i: number, net: Net, sc: number): void {
    const p = terminalPos(s, dir, i);
    const port = (dir === 'in' ? s.owner.def.inputs : s.owner.def.outputs)[i];
    const { ctx, th } = this;
    const r = 3.5 / sc;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = wireColor(net, net.value, th, true);
    ctx.fill();
    const size = Math.min(11, 13 / sc * 1.0);
    if (size * sc >= 6) {
      ctx.font = `600 ${size}px ${th.mono}`;
      ctx.fillStyle = th.dim;
      ctx.textBaseline = 'middle';
      const lbl = port.width > 1 ? `${port.name}[${port.width - 1}:0]` : port.name;
      if (p.side === 'r') { ctx.textAlign = 'left'; ctx.fillText(lbl, p.x + 6 / sc, p.y - 8 / sc); }
      else if (p.side === 'l') { ctx.textAlign = 'right'; ctx.fillText(lbl, p.x - 6 / sc, p.y - 8 / sc); }
      else { ctx.textAlign = 'center'; ctx.fillText(lbl, p.x, p.y + (p.side === 'b' ? 10 : -10) / sc); }
    }
  }

  private isTunnel(net: Net, top: boolean): boolean {
    return !!net.tunnel || (top && !!net.driver && net.driver.node.inst.name === 'control');
  }

  private drawNet(net: Net, s: Structure, xf: Xf, sc: number, depth: number, top: boolean): void {
    const tunnel = this.isTunnel(net, top);
    if (!net.routes.length && !tunnel) return;
    const { ctx, th } = this;
    const settled = this.t >= net.arrival;
    const v = settled ? net.value : net.prev;
    const live = !top || net.live;
    const bus = net.width > 1;
    const color = wireColor(net, v, th, live);
    const px = 1 / sc;
    const hovered = this.hover.net === net;
    const pinned = this.pinned.has(net);
    let lw = (bus ? 2.2 : 1.4) * px;
    if (sc < 0.6) lw = (bus ? 1.6 : 1) * px;
    const paths = tunnel ? this.tunnelPaths(net, s) : net.routes;
    // glow for fresh transitions / logic-1
    const fresh = settled && net.value !== net.prev && this.t - net.arrival < 6 && Number.isFinite(this.t);
    if ((fresh || hovered || pinned) && live) {
      ctx.strokeStyle = alpha(hovered ? th.text : color, hovered ? 0.25 : 0.35);
      ctx.lineWidth = lw * 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const pts of paths) strokePts(ctx, pts);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = hovered ? lw * 1.8 : lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (!settled) ctx.setLineDash([4 * px, 3 * px]);
    for (const pts of paths) strokePts(ctx, pts);
    ctx.setLineDash([]);
    // fan-out dot
    if (net.routes.length > 1 && sc > 0.5 && !tunnel) {
      const src = net.routes[0];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(src[2] ?? src[0], src[3] ?? src[1], 2.2 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    // tunnel labels
    const tfs = Math.min(12, 10 / sc);
    if (tunnel && !this.env.compact && sc * tfs > 8) {
      ctx.font = `600 ${tfs}px ${th.mono}`;
      ctx.fillStyle = alpha(th.ctrl, live ? 1 : 0.45);
      ctx.textBaseline = 'middle';
      const lbl = `${net.name}${this.env.showValues() && (top || net.width > 1) ? '=' + net.value : ''}`;
      const sinkStubs = paths.slice(1).filter(p => p.length >= 4);
      const label = (px: number, py: number, dx: number, dy: number) => {
        // text just beyond the free end of a stub pointing (dx, dy) away from its port
        if (Math.abs(dx) > Math.abs(dy)) { ctx.textAlign = dx < 0 ? 'right' : 'left'; ctx.fillText(lbl, px + Math.sign(dx) * 2, py); }
        else { ctx.textAlign = 'center'; ctx.fillText(lbl, px, py + Math.sign(dy) * tfs * 0.7); }
      };
      for (const pts of sinkStubs) label(pts[0], pts[1], pts[0] - pts[2], pts[1] - pts[3]);
      const s0 = paths[0];
      if (!sinkStubs.length && s0.length >= 4) label(s0[2], s0[3], s0[2] - s0[0], s0[3] - s0[1]);
    }
    // hit testing (screen space)
    for (const pts of paths) {
      const sp: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = this.toScreen(xf.ox + pts[i] * xf.k, xf.oy + pts[i + 1] * xf.k);
        sp.push(x, y);
      }
      this.hitNets.push({ net, pts: sp, depth, s });
    }
  }

  /** Control signals are drawn as short labelled stubs (net labels) instead of long wires. */
  private tunnelPaths(net: Net, s: Structure): number[][] {
    const out: number[][] = [];
    const src = sourceOf(s, net)!;
    // The first path is the source stub (unlabelled); a hidden driver has none.
    const sd = src.side === 'l' ? [-14, 0] : src.side === 't' ? [0, -14] : src.side === 'b' ? [0, 14] : [14, 0];
    out.push(net.driver && !net.driver.node.w ? [] : [src.x, src.y, src.x + sd[0], src.y + sd[1]]);
    for (const k of net.sinks) {
      if (!k.node.w) continue;
      const p = portPos(k.node, 'in', k.port);
      const len = 16;
      const d = p.side === 'l' ? [-len, 0] : p.side === 'r' ? [len, 0] : p.side === 't' ? [0, -len] : [0, len];
      out.push([p.x + d[0], p.y + d[1], p.x, p.y]);
    }
    return out;
  }

  private valueChip(net: Net, sc: number, top: boolean): void {
    if (net.width <= 1 || !net.routes.length) return;
    if (this.isTunnel(net, top)) return;
    const fs = 9.5;
    if (fs * sc < 7.5) return;
    const settled = this.t >= net.arrival;
    const v = settled ? net.value : net.prev;
    const txt = fmtVal(v, net.width);
    // longest horizontal segment of the first route
    const pts = net.routes.reduce((a, b) => (routeLen(b) > routeLen(a) ? b : a));
    let best = -1, bx = 0, by = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const len = Math.abs(pts[i + 2] - pts[i]);
      if (Math.abs(pts[i + 3] - pts[i + 1]) < 0.1 && len > best) { best = len; bx = (pts[i] + pts[i + 2]) / 2; by = pts[i + 1]; }
    }
    const { ctx, th } = this;
    ctx.font = `600 ${fs}px ${th.mono}`;
    const w = ctx.measureText(txt).width + 8;
    if (best < w * 0.6 && best >= 0) return;
    if (best < 0) return;
    const live = !top || net.live;
    ctx.beginPath();
    roundRect(ctx, bx - w / 2, by - 7, w, 14, 4);
    ctx.fillStyle = alpha(th.bg2, 0.92);
    ctx.fill();
    ctx.strokeStyle = alpha(wireColor(net, v, th, live), live ? 0.8 : 0.3);
    ctx.lineWidth = 1 / sc;
    ctx.stroke();
    ctx.fillStyle = live ? (settled ? th.text : th.faint) : th.faint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx, by + 0.5);
  }

  // ------------------------------------------------------------ hit testing
  hitTest(sx: number, sy: number): { net: Net | null; node: HitNode | null } {
    let bestNet: HitNet | null = null, bestD = 5;
    for (const h of this.hitNets) {
      for (let i = 0; i + 3 < h.pts.length; i += 2) {
        const d = segDist(sx, sy, h.pts[i], h.pts[i + 1], h.pts[i + 2], h.pts[i + 3]);
        if (d < bestD || (d <= bestD + 0.01 && bestNet && h.depth > bestNet.depth)) { bestD = d; bestNet = h; }
      }
    }
    let node: HitNode | null = null;
    for (const h of this.hitNodes) {
      const r = h.rect;
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h && (!node || h.depth >= node.depth)) node = h;
    }
    return { net: bestNet?.net ?? null, node };
  }
}

/** Aspect ratio (w/h) a block's interior wants. */
const CUSTOM_ASPECT: Record<string, number> = { pla: 1.45, imem: 2.3, dmem: 2.3, csr: 1.9, rewire: 2.6 };

export function interiorAspect(inst: Instance): number {
  const d = inst.def;
  if (d.interior) return CUSTOM_ASPECT[d.interior] ?? 1.5;
  const s = inst.structure!;
  layout(s);
  return s.w / (s.h * 1.14);
}

/**
 * The rect a block grows into when revealed: centred on the block, matching
 * its interior's aspect ratio, and nudged to stay inside its parent.
 */
export function expandedRect(inst: Instance, r: Rect, parent: Rect | null): Rect {
  const a = interiorAspect(inst);
  let w = Math.max(r.w, r.h * a), h = Math.max(r.h, r.w / a);
  if (parent) {
    const f = Math.min(1, (parent.w * 0.96) / w, (parent.h * 0.96) / h);
    if (f < 1 && Math.max(r.w / w, r.h / h) <= f) { w *= f; h *= f; }
  }
  let x = r.x + r.w / 2 - w / 2, y = r.y + r.h / 2 - h / 2;
  if (parent) {
    x = Math.max(parent.x + parent.w * 0.02, Math.min(x, parent.x + parent.w * 0.98 - w));
    y = Math.max(parent.y + parent.h * 0.02, Math.min(y, parent.y + parent.h * 0.98 - h));
  }
  return { x, y, w, h };
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

function routeLen(p: number[]): number {
  let l = 0;
  for (let i = 0; i + 3 < p.length; i += 2) l += Math.abs(p[i + 2] - p[i]) + Math.abs(p[i + 3] - p[i + 1]);
  return l;
}

function strokePts(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function wireColor(net: Net, v: number, th: Theme, live: boolean): string {
  const base = net.kind === 'ctrl' ? th.ctrl : net.kind === 'addr' ? th.addr : net.kind === 'clk' ? th.clock : th.data;
  if (net.width === 1) {
    if (!live) return alpha(v ? base : th.zero, 0.35);
    return v ? base : th.zero;
  }
  return live ? base : alpha(base, 0.22);
}

function blockColor(node: Node, th: Theme): string {
  const s = node.inst.def.shape;
  if (s === 'mem') return th.addr;
  if (s === 'reg') return th.clock;
  if (s && ['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not', 'buf'].includes(s)) return th.ctrl;
  if (node.inst.def.type === 'Control') return th.ctrl;
  return th.line3;
}

function shortName(inst: Instance): string {
  const d = inst.def;
  const map: Record<string, string> = {
    RegFile: 'Registers', IMem: 'Instruction memory', DMem: 'Data memory', Control: 'Control', ImmGen: 'Imm gen',
    BranchComp: 'Branch comp', NextPC: 'Next PC', Exception: 'Exceptions', MulDiv: 'Mul / Div', CSRFile: 'CSRs',
    ALUDecode: 'ALU ctrl', BarrelShifter32: 'Shifter', LCU8: 'Lookahead', PG4: 'P/G', Sum4: 'Σ4',
  };
  if (map[d.type]) return map[d.type];
  if (d.type.startsWith('Register')) return inst.name === 'pc' ? 'PC' : inst.name;
  if (d.type.startsWith('Decoder')) return d.name;
  if (d.type.startsWith('RippleAdder') || d.type === 'CLAAdder32') return 'Adder';
  if (d.type.startsWith('Mux')) return 'MUX';
  return d.name.length > 18 ? inst.name : d.name;
}

export { delays, SYSTEM };
