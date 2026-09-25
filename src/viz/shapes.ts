/** Canvas paths for schematic symbols (IEEE distinctive shapes and blocks). */
import type { Node } from '../hw/netlist.ts';

export function shapePath(ctx: CanvasRenderingContext2D, node: Node): void {
  const { x, y, w, h } = node;
  const shape = node.inst.def.shape ?? 'box';
  const br = Math.min(w, h) * 0.09; // inversion bubble radius
  ctx.beginPath();
  switch (shape) {
    case 'and': case 'nand': {
      const bw = shape === 'nand' ? w - br * 2.2 : w;
      const r = h / 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + bw - r, y);
      ctx.arc(x + bw - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      if (shape === 'nand') bubble(ctx, x + bw + br, y + h / 2, br);
      break;
    }
    case 'or': case 'nor': case 'xor': case 'xnor': {
      const bw = shape === 'nor' || shape === 'xnor' ? w - br * 2.2 : w;
      const off = shape === 'xor' || shape === 'xnor' ? w * 0.12 : 0;
      const x0 = x + off;
      ctx.moveTo(x0, y);
      ctx.quadraticCurveTo(x0 + bw * 0.55, y, x + bw, y + h / 2);
      ctx.quadraticCurveTo(x0 + bw * 0.55, y + h, x0, y + h);
      ctx.quadraticCurveTo(x0 + bw * 0.25, y + h / 2, x0, y);
      ctx.closePath();
      if (off) {
        ctx.moveTo(x, y + h);
        ctx.quadraticCurveTo(x + bw * 0.25, y + h / 2, x, y);
      }
      if (bw !== w) bubble(ctx, x + bw + br, y + h / 2, br);
      break;
    }
    case 'not': case 'buf': {
      const bw = shape === 'not' ? w - br * 2.2 : w;
      ctx.moveTo(x, y);
      ctx.lineTo(x + bw, y + h / 2);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      if (shape === 'not') bubble(ctx, x + bw + br, y + h / 2, br);
      break;
    }
    case 'mux': {
      const inset = h * 0.12;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + inset);
      ctx.lineTo(x + w, y + h - inset);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    }
    case 'alu': {
      const n = w * 0.28;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h * 0.22);
      ctx.lineTo(x + w, y + h * 0.78);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + h * 0.6);
      ctx.lineTo(x + n, y + h / 2);
      ctx.lineTo(x, y + h * 0.4);
      ctx.closePath();
      break;
    }
    case 'split': case 'join':
      ctx.rect(x, y, w, h);
      break;
    case 'const': case 'wire':
      roundRect(ctx, x, y, w, h, Math.min(h / 2, 6));
      break;
    default:
      roundRect(ctx, x, y, w, h, Math.min(8, w / 8, h / 8));
  }
}

function bubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Short glyph drawn inside small block symbols. */
export function glyph(node: Node): string | null {
  const d = node.inst.def;
  switch (d.type) {
    case 'FullAdder': return 'FA';
    case 'HalfAdder': return 'HA';
    case 'PCPlus4': return '+4';
    case 'DFF': return 'D  Q';
  }
  if (d.shape === 'adder') return '+';
  if (d.shape === 'alu') return 'ALU';
  return null;
}
