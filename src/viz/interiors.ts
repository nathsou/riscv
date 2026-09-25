/**
 * Custom interiors for blocks whose insides are clearer as a picture than as
 * a netlist (the control PLA, memories, the CSR file, immediate rewiring),
 * and the system-level view around the CPU: memory, devices and the bus.
 */
import type { Instance } from '../hw/netlist.ts';
import type { Theme } from './theme.ts';
import { alpha } from './theme.ts';
import { roundRect } from './shapes.ts';
import type { Machine } from '../sim/machine.ts';
import { INSTRUCTIONS } from '../isa/spec/index.ts';
import { findSpec } from '../isa/decode.ts';
import { CONTROL_FIELDS } from '../hw/lib/control.ts';
import { CSRS } from '../isa/csr.ts';
import { disassemble } from '../asm/disasm.ts';
import { FB_BASE, FB_W, FB_H, MMIO, MMIO_BASE, DATA_BASE, STACK_TOP } from '../sim/memmap.ts';

interface Rect { x: number; y: number; w: number; h: number }

/** World rect of the CPU inside the system view. */
export const CPU_RECT: Rect = { x: 30, y: 30, w: 1250, h: 740 };
/** Bounds of the whole system view. */
export const SYSTEM: Rect = { x: 0, y: 0, w: 1640, h: 1010 };

const hex8 = (v: number) => (v >>> 0).toString(16).padStart(8, '0');

// ------------------------------------------------------------------ text helper
function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, sc: number, color: string,
  align: CanvasTextAlign = 'left', font = 'mono', weight = 500, th?: Theme): boolean {
  if (size * sc < 4.5) return false;
  ctx.font = `${weight} ${size}px ${font === 'mono' ? th?.mono ?? 'monospace' : th?.font ?? 'sans-serif'}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  return true;
}

/** Content area of a block's interior (below the header). */
function area(r: Rect): Rect {
  const head = Math.min(r.h * 0.1, 26, r.w * 0.08);
  const pad = Math.min(r.w, r.h) * 0.04;
  return { x: r.x + pad, y: r.y + head + pad * 0.5, w: r.w - 2 * pad, h: r.h - head - pad * 1.5 };
}

export function drawInterior(ctx: CanvasRenderingContext2D, inst: Instance, r: Rect, camK: number, th: Theme, machine: Machine, t: number): void {
  const a = area(r);
  switch (inst.def.interior) {
    case 'pla': return drawPLA(ctx, inst, a, camK, th);
    case 'imem': return drawIMem(ctx, inst, a, camK, th, machine);
    case 'dmem': return drawDMem(ctx, inst, a, camK, th, machine);
    case 'csr': return drawCSR(ctx, inst, a, camK, th, machine);
    case 'rewire': return drawRewire(ctx, inst, a, camK, th, t);
  }
}

// ------------------------------------------------------------------ PLA
const PLA_COLS = (() => {
  const used: number[] = [];
  for (let i = 31; i >= 0; i--) if (INSTRUCTIONS.some(s => (s.mask >>> i) & 1)) used.push(i);
  const outs: { field: number; bit: number; label: string }[] = [];
  CONTROL_FIELDS.forEach((f, fi) => {
    for (let k = f.width - 1; k >= 0; k--) outs.push({ field: fi, bit: k, label: f.width > 1 ? `${f.name}${k}` : f.name });
  });
  return { used, outs };
})();

function drawPLA(ctx: CanvasRenderingContext2D, inst: Instance, a: Rect, sc: number, th: Theme): void {
  const w = inst.inVals[0] | 0;
  const active = findSpec(w);
  const { used, outs } = PLA_COLS;
  const labelW = a.w * 0.1;
  const headH = a.h * 0.1;
  const gap = a.w * 0.02;
  const cols = used.length + outs.length;
  const cw = (a.w - labelW - gap) / cols;
  const rh = (a.h - headH) / INSTRUCTIONS.length;
  const x0 = a.x + labelW, y0 = a.y + headH;
  const xo = x0 + used.length * cw + gap;
  const fs = Math.min(rh * 0.8, cw * 1.6, 9);

  // planes
  ctx.fillStyle = alpha(th.data, 0.05);
  ctx.fillRect(x0, y0, used.length * cw, rh * INSTRUCTIONS.length);
  ctx.fillStyle = alpha(th.ctrl, 0.05);
  ctx.fillRect(xo, y0, outs.length * cw, rh * INSTRUCTIONS.length);
  txt(ctx, 'AND plane: one product term per instruction', x0, a.y + headH * 0.18, Math.min(headH * 0.26, 10), sc, th.dim, 'left', 'sans', 600, th);
  txt(ctx, 'OR plane: control outputs', xo, a.y + headH * 0.18, Math.min(headH * 0.26, 10), sc, th.dim, 'left', 'sans', 600, th);

  // input columns: vertical lines coloured by the instruction bit
  used.forEach((bit, i) => {
    const x = x0 + (i + 0.5) * cw;
    const v = (w >>> bit) & 1;
    ctx.strokeStyle = alpha(v ? th.one : th.zero, 0.55);
    ctx.lineWidth = Math.max(0.6 / sc, cw * 0.08);
    ctx.beginPath(); ctx.moveTo(x, y0 - headH * 0.2); ctx.lineTo(x, y0 + rh * INSTRUCTIONS.length); ctx.stroke();
    txt(ctx, String(bit), x, y0 - headH * 0.35, Math.min(cw * 0.7, 7), sc, v ? th.one : th.faint, 'center', 'mono', 500, th);
  });
  // output columns
  const ctl = active ? CONTROL_FIELDS.map(f => f.enc(active.control)) : null;
  outs.forEach((o, i) => {
    const x = xo + (i + 0.5) * cw;
    const on = ctl ? (ctl[o.field] >> o.bit) & 1 : 0;
    ctx.strokeStyle = alpha(on ? th.ctrl : th.zero, on ? 0.9 : 0.45);
    ctx.lineWidth = Math.max(0.6 / sc, cw * (on ? 0.14 : 0.08));
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + rh * INSTRUCTIONS.length + headH * 0.2); ctx.stroke();
    // rotated labels
    const ls = Math.min(cw * 0.75, 7);
    if (ls * sc >= 4.5) {
      ctx.save();
      ctx.translate(x, y0 - headH * 0.1);
      ctx.rotate(-Math.PI / 2);
      txt(ctx, o.label, 0, 0, ls, sc, on ? th.ctrl : th.faint, 'left', 'mono', 500, th);
      ctx.restore();
    }
  });

  // rows
  INSTRUCTIONS.forEach((s, j) => {
    const y = y0 + (j + 0.5) * rh;
    const act = s === active;
    if (act) {
      ctx.fillStyle = alpha(th.ctrl, 0.18);
      ctx.fillRect(a.x, y - rh / 2, a.w, rh);
    }
    ctx.strokeStyle = act ? th.ctrl : alpha(th.line3, 0.5);
    ctx.lineWidth = act ? Math.max(1 / sc, rh * 0.12) : Math.max(0.5 / sc, rh * 0.05);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xo + outs.length * cw, y); ctx.stroke();
    txt(ctx, s.mnemonic, x0 - cw * 0.4, y, fs, sc, act ? th.ctrl : th.dim, 'right', 'mono', act ? 700 : 500, th);
    // AND plane connections: filled dot = bit must be 1, ring = bit must be 0
    const dr = Math.min(cw, rh) * 0.28;
    used.forEach((bit, i) => {
      if (!((s.mask >>> bit) & 1)) return;
      const x = x0 + (i + 0.5) * cw;
      const want = (s.match >>> bit) & 1;
      const ok = ((w >>> bit) & 1) === want;
      ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2);
      const c = act ? th.ctrl : ok ? alpha(th.text, 0.55) : alpha(th.err, 0.55);
      if (want) { ctx.fillStyle = c; ctx.fill(); }
      else { ctx.strokeStyle = c; ctx.lineWidth = dr * 0.45; ctx.stroke(); }
    });
    // OR plane connections
    const c = CONTROL_FIELDS.map(f => f.enc(s.control));
    outs.forEach((o, i) => {
      if (!((c[o.field] >> o.bit) & 1)) return;
      const x = xo + (i + 0.5) * cw;
      ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2);
      ctx.fillStyle = act ? th.ctrl : alpha(th.dim, 0.6);
      ctx.fill();
    });
  });
  if (!active) txt(ctx, 'no row matches → illegal instruction', a.x + a.w / 2, a.y + a.h - rh, Math.min(12, a.h * 0.03), sc, th.err, 'center', 'sans', 650, th);
}

// ------------------------------------------------------------------ memories
function rowList(ctx: CanvasRenderingContext2D, a: Rect, sc: number, th: Theme, rows: { addr: string; val: string; note: string; hl: number; tag?: string }[]): void {
  const rh = a.h / rows.length;
  const fs = Math.min(rh * 0.55, a.w * 0.045, 12);
  rows.forEach((row, i) => {
    const y = a.y + (i + 0.5) * rh;
    if (row.hl) {
      ctx.beginPath();
      roundRect(ctx, a.x, y - rh * 0.45, a.w, rh * 0.9, rh * 0.2);
      ctx.fillStyle = alpha(row.hl === 2 ? th.pink : th.addr, 0.2);
      ctx.fill();
      ctx.strokeStyle = row.hl === 2 ? th.pink : th.addr;
      ctx.lineWidth = 1 / sc;
      ctx.stroke();
    }
    txt(ctx, row.addr, a.x + a.w * 0.03, y, fs, sc, row.hl ? th.addr : th.faint, 'left', 'mono', 500, th);
    txt(ctx, row.val, a.x + a.w * 0.3, y, fs, sc, row.hl ? th.text : th.dim, 'left', 'mono', 600, th);
    txt(ctx, row.note, a.x + a.w * 0.58, y, fs, sc, row.hl ? th.data : th.faint, 'left', 'mono', 500, th);
    if (row.tag) txt(ctx, row.tag, a.x + a.w * 0.97, y, fs * 0.85, sc, row.hl === 2 ? th.pink : th.addr, 'right', 'sans', 700, th);
  });
}

function drawIMem(ctx: CanvasRenderingContext2D, inst: Instance, a: Rect, sc: number, th: Theme, m: Machine): void {
  const pc = inst.inVals[0] >>> 0;
  const n = 11;
  const rows = [];
  for (let i = -5; i <= 5; i++) {
    const addr = (pc + i * 4) >>> 0;
    const w = m.peekLoad(addr, 4) >>> 0;
    rows.push({ addr: hex8(addr), val: hex8(w), note: disassemble(w, addr).text, hl: i === 0 ? 1 : 0, tag: i === 0 ? '◀ pc' : undefined });
  }
  void n;
  rowList(ctx, a, sc, th, rows);
}

const WIDTH_NAMES = ['lb', 'lh', 'lw', '?', 'lbu', 'lhu', '?', '?'];
const SWIDTH_NAMES = ['sb', 'sh', 'sw', '?', '?', '?', '?', '?'];

function drawDMem(ctx: CanvasRenderingContext2D, inst: Instance, a: Rect, sc: number, th: Theme, m: Machine): void {
  const [addr, wdata, rd, wr, f3] = inst.inVals;
  const active = rd || wr;
  const base = ((addr >>> 0) & ~3) >>> 0;
  const size = [1, 2, 4, 4, 1, 2, 4, 4][f3];
  const headH = a.h * 0.14;
  const fs = Math.min(headH * 0.4, 12);
  const status = !active ? 'idle — no memory access this cycle'
    : wr ? `${SWIDTH_NAMES[f3]}  [${hex8(addr)}] ← ${hex8(wdata)}` : `${WIDTH_NAMES[f3]}  [${hex8(addr)}] → ${hex8(inst.outVals[0])}`;
  txt(ctx, status, a.x + a.w / 2, a.y + headH * 0.4, fs, sc, !active ? th.faint : wr ? th.pink : th.addr, 'center', 'mono', 650, th);
  if (inst.outVals[1]) txt(ctx, 'misaligned: fault', a.x + a.w / 2, a.y + headH * 0.85, fs * 0.9, sc, th.err, 'center', 'sans', 700, th);
  const la: Rect = { x: a.x, y: a.y + headH, w: a.w, h: a.h - headH };
  const rows = [];
  for (let i = -3; i <= 3; i++) {
    const wa = (base + i * 4) >>> 0;
    const bytes: string[] = [];
    for (let b = 3; b >= 0; b--) {
      const v = m.peekLoad((wa + b) >>> 0, 1) & 0xff;
      bytes.push(v.toString(16).padStart(2, '0'));
    }
    const hit = active && i === 0;
    const note = hit ? `bytes ${addr & 3}..${(addr & 3) + size - 1}` : '';
    rows.push({ addr: hex8(wa), val: bytes.join(' '), note, hl: hit ? (wr ? 2 : 1) : 0, tag: hit ? (wr ? 'write' : 'read') : undefined });
  }
  ctx.globalAlpha *= active ? 1 : 0.55;
  rowList(ctx, la, sc, th, rows);
}

function drawCSR(ctx: CanvasRenderingContext2D, inst: Instance, a: Rect, sc: number, th: Theme, m: Machine): void {
  const [csr, , op] = inst.inVals;
  const list = CSRS.filter(c => c.addr < 0xb00 || c.addr === 0xb00 || c.addr === 0xb02);
  const rows = list.map(c => {
    const hit = !!op && c.addr === csr;
    const v = m.csrPeek(c.addr) >>> 0;
    return {
      addr: '0x' + c.addr.toString(16).padStart(3, '0'), val: c.name, note: hex8(v),
      hl: hit ? (op === 1 ? 2 : 1) : c.addr === 0x305 || c.addr === 0x341 ? 0 : 0,
      tag: hit ? ['', 'rw', 'rs', 'rc'][op] + ' → ' + hex8(inst.outVals[1]) : c.addr === 0x305 ? 'mtvec →' : c.addr === 0x341 ? 'mepc →' : undefined,
    };
  });
  rowList(ctx, a, sc, th, rows);
}

// ------------------------------------------------------------------ immediate rewiring
function drawRewire(ctx: CanvasRenderingContext2D, inst: Instance, a: Rect, sc: number, th: Theme, t: number): void {
  const map = inst.def.bitMap ?? [];
  const w = inst.inVals[0] >>> 0;
  const out = inst.outVals[0] >>> 0;
  const lane = a.w / 32;
  const topY = a.y + a.h * 0.16, botY = a.y + a.h * 0.84;
  const fs = Math.min(lane * 0.8, a.h * 0.07, 9);
  const bx = (i: number) => a.x + (31 - i + 0.5) * lane;
  txt(ctx, 'instruction bits', a.x, a.y + a.h * 0.03, fs * 1.1, sc, th.dim, 'left', 'sans', 600, th);
  txt(ctx, 'immediate bits', a.x, a.y + a.h * 0.97, fs * 1.1, sc, th.dim, 'left', 'sans', 600, th);
  const cell = (x: number, y: number, v: number, used: boolean) => {
    ctx.beginPath();
    roundRect(ctx, x - lane * 0.42, y - lane * 0.42, lane * 0.84, lane * 0.84, lane * 0.15);
    ctx.fillStyle = used ? alpha(v ? th.one : th.zero, v ? 0.4 : 0.25) : alpha(th.line, 0.4);
    ctx.fill();
    txt(ctx, String(v), x, y, lane * 0.55, sc, used ? th.text : th.faint, 'center', 'mono', 600, th);
  };
  // wires first
  const settled = t >= 1;
  for (let j = 0; j < 32; j++) {
    const src = map[j];
    const x1 = bx(j);
    if (src < 0) continue;
    const x0 = bx(src);
    const v = (w >>> src) & 1;
    const sign = src === 31 && j > 11 && !(inst.def.type === 'ImmU' || inst.def.type === 'ImmJ' && j < 20);
    ctx.strokeStyle = alpha(sign ? th.pink : v ? th.one : th.data, settled ? (sign ? 0.5 : 0.75) : 0.3);
    ctx.lineWidth = Math.max(0.6 / sc, lane * (v ? 0.12 : 0.07));
    ctx.beginPath();
    ctx.moveTo(x0, topY + lane * 0.5);
    const my = (topY + botY) / 2;
    ctx.bezierCurveTo(x0, my, x1, my, x1, botY - lane * 0.5);
    ctx.stroke();
  }
  const usedIn = new Set(map.filter(s => s >= 0));
  for (let i = 0; i < 32; i++) {
    cell(bx(i), topY, (w >>> i) & 1, usedIn.has(i));
    cell(bx(i), botY, (out >>> i) & 1, map[i] >= 0);
    if (i % 4 === 3 || i === 0) {
      txt(ctx, String(i), bx(i), topY - lane * 0.85, fs * 0.8, sc, th.faint, 'center', 'mono', 500, th);
      txt(ctx, String(i), bx(i), botY + lane * 0.85, fs * 0.8, sc, th.faint, 'center', 'mono', 500, th);
    }
  }
}

// ------------------------------------------------------------------ system view
interface Device { id: string; title: string; sub: string; r: Rect; lo: number; hi: number }

const DEVICES: Device[] = [
  { id: 'ram', title: 'RAM', sub: 'program, data, heap and stack', r: { x: 30, y: 830, w: 470, h: 165 }, lo: 0, hi: 0xfeffffff },
  { id: 'timer', title: 'Timer (CLINT)', sub: '0xffff0020', r: { x: 530, y: 830, w: 250, h: 165 }, lo: MMIO.MTIME, hi: MMIO.MTIMECMPH + 3 },
  { id: 'console', title: 'Console UART', sub: '0xffff0000', r: { x: 810, y: 830, w: 300, h: 165 }, lo: MMIO.CONSOLE_TX, hi: MMIO.CONSOLE_RX + 3 },
  { id: 'keys', title: 'Keyboard', sub: '0xffff0014', r: { x: 1140, y: 830, w: 140, h: 165 }, lo: MMIO.KEY_READY, hi: MMIO.KEY_CODE + 3 },
  { id: 'fb', title: 'Framebuffer', sub: '64×64 · 0xff000000', r: { x: 1330, y: 30, w: 280, h: 340 }, lo: FB_BASE, hi: FB_BASE + FB_W * FB_H - 1 },
  { id: 'map', title: 'Memory map', sub: 'physical address space', r: { x: 1330, y: 410, w: 280, h: 360 }, lo: -1, hi: -1 },
];

let fbCanvas: HTMLCanvasElement | null = null;
let fbVersion = -1;

function framebuffer(m: Machine): HTMLCanvasElement {
  if (!fbCanvas) {
    fbCanvas = document.createElement('canvas');
    fbCanvas.width = FB_W; fbCanvas.height = FB_H;
  }
  const v = m.mem.version;
  if (v !== fbVersion) {
    fbVersion = v;
    const c = fbCanvas.getContext('2d')!;
    const img = c.createImageData(FB_W, FB_H);
    const px = m.mem.readBytes(FB_BASE, FB_W * FB_H);
    for (let i = 0; i < px.length; i++) {
      const b = px[i];
      img.data[i * 4] = ((b >> 5) & 7) * 255 / 7;
      img.data[i * 4 + 1] = ((b >> 2) & 7) * 255 / 7;
      img.data[i * 4 + 2] = (b & 3) * 255 / 3;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  return fbCanvas;
}

function inDev(d: Device, addr: number): boolean {
  if (d.id === 'ram') return addr >>> 0 < FB_BASE >>> 0;
  return addr >>> 0 >= d.lo >>> 0 && addr >>> 0 <= d.hi >>> 0;
}

export function drawSystem(ctx: CanvasRenderingContext2D, sc: number, th: Theme, m: Machine, cpu: Instance): void {
  void cpu;
  const px = 1 / sc;
  const busY = 800;
  const acc = m.lastMemWrite ?? m.lastMemRead;
  const accW = !!m.lastMemWrite;
  const activeDev = acc ? DEVICES.find(d => d.lo >= 0 && inDev(d, acc.addr)) : undefined;

  // bus
  const busC = alpha(th.addr, 0.55);
  ctx.strokeStyle = busC;
  ctx.lineWidth = 7 * Math.max(px, 0.5);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(40, busY); ctx.lineTo(1470, busY); ctx.lineTo(1470, 790); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = alpha(th.addr, 0.25);
  ctx.beginPath(); ctx.moveTo(1470, busY); ctx.lineTo(1470, 770); ctx.stroke();
  txt(ctx, 'SYSTEM BUS', 50, busY + 17, 15, sc, th.dim, 'left', 'sans', 650, th);
  // CPU link
  link(ctx, 655, CPU_RECT.y + CPU_RECT.h, 655, busY, !!acc, accW, th, px);

  for (const d of DEVICES) {
    const r = d.r;
    const hot = activeDev === d;
    const cx = r.x + r.w / 2;
    if (d.id === 'fb') link(ctx, 1470, r.y + r.h, 1470, busY, hot, accW, th, px);
    else if (d.id === 'map') { /* diagram only */ }
    else link(ctx, cx, busY, cx, r.y, hot, accW, th, px);
    ctx.beginPath();
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = th.panel;
    ctx.fill();
    ctx.lineWidth = hot ? 2.2 : 1.2;
    ctx.strokeStyle = hot ? (accW ? th.pink : th.addr) : th.line3;
    ctx.stroke();
    txt(ctx, d.title, r.x + 16, r.y + 24, 22, sc, th.text, 'left', 'sans', 700, th);
    txt(ctx, d.sub, r.x + 16, r.y + 50, 14, sc, th.faint, 'left', 'mono', 500, th);
    const ia: Rect = { x: r.x + 16, y: r.y + 70, w: r.w - 32, h: r.h - 82 };
    switch (d.id) {
      case 'ram': drawRamSummary(ctx, ia, sc, th, m, acc, accW); break;
      case 'timer': {
        const mt = m.mtime, cmp = m.mtimecmp;
        txt(ctx, `mtime    ${mt}`, ia.x, ia.y + 10, 16, sc, th.data, 'left', 'mono', 600, th);
        txt(ctx, `mtimecmp ${cmp >= 0xffffffff ? '∞' : cmp}`, ia.x, ia.y + 34, 16, sc, th.dim, 'left', 'mono', 600, th);
        const pend = mt >= cmp;
        txt(ctx, pend ? 'MTIP ● pending' : 'MTIP ○', ia.x, ia.y + 60, 16, sc, pend ? th.warn : th.faint, 'left', 'mono', 700, th);
        break;
      }
      case 'console': {
        const lines = m.consoleOut.split('\n').slice(-4);
        lines.forEach((l, i) => txt(ctx, l.slice(0, 26) || ' ', ia.x, ia.y + 8 + i * 21, 16, sc, th.ok, 'left', 'mono', 500, th));
        break;
      }
      case 'keys': {
        txt(ctx, `queued ${m.keys.length}`, ia.x, ia.y + 10, 16, sc, th.dim, 'left', 'mono', 600, th);
        if (m.keys.length) txt(ctx, `next 0x${m.keys[0].toString(16)}`, ia.x, ia.y + 34, 16, sc, th.data, 'left', 'mono', 600, th);
        break;
      }
      case 'fb': {
        const s = Math.min(ia.w, ia.h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(framebuffer(m), ia.x + (ia.w - s) / 2, ia.y + (ia.h - s) / 2, s, s);
        ctx.imageSmoothingEnabled = true;
        ctx.strokeStyle = th.line2;
        ctx.lineWidth = px;
        ctx.strokeRect(ia.x + (ia.w - s) / 2, ia.y + (ia.h - s) / 2, s, s);
        break;
      }
      case 'map': drawMemMap(ctx, ia, sc, th, acc?.addr ?? -1, accW); break;
    }
  }
}

function link(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, hot: boolean, write: boolean, th: Theme, px: number): void {
  ctx.strokeStyle = hot ? (write ? th.pink : th.addr) : alpha(th.addr, 0.35);
  ctx.lineWidth = (hot ? 5 : 3.5) * Math.max(px, 0.5);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function drawRamSummary(ctx: CanvasRenderingContext2D, a: Rect, sc: number, th: Theme, m: Machine, acc: { addr: number; w: number } | null, write: boolean): void {
  if (acc && acc.addr >>> 0 < FB_BASE >>> 0) {
    const base = ((acc.addr >>> 0) & ~3) >>> 0;
    txt(ctx, `${write ? 'store' : 'load'} ${acc.w}B @ 0x${hex8(acc.addr)}`, a.x, a.y + 10, 16, sc, write ? th.pink : th.addr, 'left', 'mono', 700, th);
    for (let i = -1; i <= 1; i++) {
      const wa = (base + i * 4) >>> 0;
      txt(ctx, `${hex8(wa)}  ${hex8(m.peekLoad(wa, 4))}`, a.x + 260, a.y + 10 + (i + 1) * 22, 15, sc, i === 0 ? th.text : th.faint, 'left', 'mono', 600, th);
    }
  } else {
    txt(ctx, 'no RAM access this step', a.x, a.y + 10, 16, sc, th.faint, 'left', 'sans', 500, th);
    txt(ctx, `sp ${hex8(m.x[2])}   gp ${hex8(m.x[3])}`, a.x, a.y + 40, 15, sc, th.dim, 'left', 'mono', 600, th);
  }
}

function drawMemMap(ctx: CanvasRenderingContext2D, a: Rect, sc: number, th: Theme, addr: number, write: boolean): void {
  const regions: [string, number, number, string][] = [
    ['MMIO', MMIO_BASE, 0xffffffff, th.warn],
    ['framebuffer', FB_BASE, FB_BASE + FB_W * FB_H, th.pink],
    ['stack ↓', 0x70000000, STACK_TOP, th.ok],
    ['heap / data', DATA_BASE, 0x20000000, th.data],
    ['text', 0, 0x01000000, th.addr],
  ];
  const n = regions.length;
  const bh = a.h / n;
  regions.forEach(([name, lo, hi, c], i) => {
    const y = a.y + i * bh;
    const hot = addr >= 0 && addr >>> 0 >= lo >>> 0 && addr >>> 0 <= hi >>> 0;
    ctx.beginPath();
    roundRect(ctx, a.x, y + 3, a.w * 0.5, bh - 6, 5);
    ctx.fillStyle = alpha(c, hot ? 0.4 : 0.14);
    ctx.fill();
    ctx.strokeStyle = hot ? (write ? th.pink : th.text) : alpha(c, 0.6);
    ctx.lineWidth = hot ? 2 : 1;
    ctx.stroke();
    txt(ctx, name, a.x + a.w * 0.25, y + bh / 2, 15, sc, th.text, 'center', 'sans', 650, th);
    txt(ctx, '0x' + hex8(lo), a.x + a.w * 0.55, y + bh / 2, 14, sc, th.dim, 'left', 'mono', 500, th);
  });
}
