import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portPos } from '../src/viz/geometry.ts';
import { shapePath } from '../src/viz/shapes.ts';
import type { Node, Shape } from '../src/hw/netlist.ts';

test('curved gate wires end on the drawn outline and inversion bubbles meet outputs', () => {
  for (const shape of ['or', 'xor', 'nor', 'xnor'] as Shape[]) {
    const node = { x: 20, y: 30, w: 80, h: 40,
      inst: { def: { shape, inputs: [{ name: 'a' }, { name: 'b' }], outputs: [{ name: 'y' }] } } } as Node;
    const curves: number[][] = [];
    const arcs: number[][] = [];
    const ctx = {
      beginPath() {}, moveTo() {}, closePath() {},
      quadraticCurveTo(...args: number[]) { curves.push(args); },
      arc(...args: number[]) { arcs.push(args); },
    } as unknown as CanvasRenderingContext2D;
    shapePath(ctx, node);
    // The third curve is the rear edge of the body, from bottom to top.
    const [cx, , endX] = curves[2];
    for (let i = 0; i < 2; i++) {
      const p = portPos(node, 'in', i);
      const u = 1 - (p.y - node.y) / node.h;
      const outlineX = (1 - u) ** 2 * endX + 2 * (1 - u) * u * cx + u ** 2 * endX;
      assert.ok(Math.abs(p.x - outlineX) < 1e-8, `${shape} input ${i}: ${p.x} vs ${outlineX}`);
    }
    if (shape === 'nor' || shape === 'xnor') {
      const [bx, , radius] = arcs.at(-1)!;
      assert.ok(Math.abs(bx + radius - portPos(node, 'out', 0).x) < 1e-8);
    }
  }
  for (const shape of ['nand', 'not'] as Shape[]) {
    const node = { x: 20, y: 30, w: 80, h: 40,
      inst: { def: { shape, inputs: [{ name: 'a' }], outputs: [{ name: 'y' }] } } } as Node;
    const arcs: number[][] = [];
    const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      arc(...args: number[]) { arcs.push(args); } } as unknown as CanvasRenderingContext2D;
    shapePath(ctx, node);
    const [bx, , radius] = arcs.at(-1)!;
    assert.ok(Math.abs(bx + radius - portPos(node, 'out', 0).x) < 1e-8);
  }
});
