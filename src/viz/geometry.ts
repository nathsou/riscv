/** Port placement, automatic layered layout and orthogonal wire routing. */
import type { Node, Structure, Net, Port, Side } from '../hw/netlist.ts';

export interface Pt { x: number; y: number }
export interface PortGeom extends Pt { side: Side }

const isBar = (n: Node) => (n.inst.def.shape === 'split' || n.inst.def.shape === 'join') && n.w > n.h * 2;

/** Position of an input/output port of a node, in structure coordinates. */
export function portPos(node: Node, dir: 'in' | 'out', idx: number): PortGeom {
  const def = node.inst.def;
  const ports = dir === 'in' ? def.inputs : def.outputs;
  const p = ports[idx];
  const shape = def.shape;
  // Horizontal bus bars: ports line up with their partner ports.
  if (isBar(node)) {
    if ((shape === 'split' && dir === 'out') || (shape === 'join' && dir === 'in')) {
      const net = dir === 'out' ? node.outs[idx] : node.ins[idx];
      const partner = dir === 'out' ? net.sinks[0] : net.driver;
      let x = node.x + node.w * (1 - (idx + 0.5) / ports.length);
      if (partner && partner.node !== node && partner.node.inst.def.shape !== 'split' && partner.node.inst.def.shape !== 'join') {
        const pp = portPos(partner.node, dir === 'out' ? 'in' : 'out', partner.port);
        x = Math.max(node.x, Math.min(node.x + node.w, pp.x));
      }
      return dir === 'out' ? { x, y: node.y + node.h, side: 'b' } : { x, y: node.y, side: 't' };
    }
    return dir === 'in' ? { x: node.x, y: node.y + node.h / 2, side: 'l' } : { x: node.x + node.w, y: node.y + node.h / 2, side: 'r' };
  }
  const side: Side = p.side ?? (dir === 'in' ? 'l' : 'r');
  const same = ports.map((q, i) => ({ q, i })).filter(({ q }) => (q.side ?? (dir === 'in' ? 'l' : 'r')) === side);
  const k = same.findIndex(s => s.i === idx);
  let t = p.pos ?? (k + 1) / (same.length + 1);
  // Gates: inputs spread over the body, output centred.
  if (isGate(shape) && dir === 'in') t = same.length === 1 ? 0.5 : 0.18 + 0.64 * (k / (same.length - 1));
  if (shape === 'mux' && dir === 'in' && side === 'l') t = 0.15 + 0.7 * ((k + 0.5) / same.length);
  switch (side) {
    case 'l': return { x: node.x, y: node.y + node.h * t, side };
    case 'r': return { x: node.x + node.w, y: node.y + node.h * t, side };
    case 't': return { x: node.x + node.w * t, y: node.y + (shape === 'mux' ? node.h * 0.12 * (1 - 2 * Math.abs(t - 0.5)) : 0), side };
    case 'b': return { x: node.x + node.w * t, y: node.y + node.h - (shape === 'mux' ? node.h * 0.12 : 0), side };
  }
}

export function isGate(shape: string | undefined): boolean {
  return shape === 'and' || shape === 'or' || shape === 'xor' || shape === 'nand' || shape === 'nor' || shape === 'xnor' || shape === 'not' || shape === 'buf';
}

/** Where a structure's external input/output terminals sit. */
export function terminalPos(s: Structure, dir: 'in' | 'out', idx: number): PortGeom {
  const ports: Port[] = dir === 'in' ? s.owner.def.inputs : s.owner.def.outputs;
  const p = ports[idx];
  const side: Side = p.side ?? (dir === 'in' ? 'l' : 'r');
  const same = ports.map((q, i) => ({ q, i })).filter(({ q }) => (q.side ?? (dir === 'in' ? 'l' : 'r')) === side);
  const k = same.findIndex(x => x.i === idx);
  const t = (k + 1) / (same.length + 1);
  switch (side) {
    case 'l': return { x: 0, y: s.h * t, side: 'r' };
    case 'r': return { x: s.w, y: s.h * t, side: 'l' };
    case 't': return { x: s.w * t, y: 0, side: 'b' };
    case 'b': return { x: s.w * t, y: s.h, side: 't' };
  }
}

// ------------------------------------------------------------------ auto layout
export function layout(s: Structure): void {
  if (s.laidOut) return;
  if (s.owner.def.layout) { s.owner.def.layout(s); if (!s.w) autoBounds(s); route(s); return; }
  const order = new Map<Node, number>();
  s.nodes.forEach((n, i) => order.set(n, i));
  const layer = new Map<Node, number>();
  for (const n of s.nodes) {
    let l = 0;
    for (const net of n.ins) {
      const d = net.driver?.node;
      if (d && order.get(d)! < order.get(n)!) l = Math.max(l, (layer.get(d) ?? 0) + 1);
    }
    layer.set(n, l);
  }
  // Pull constants and pure-fanout wiring next to their consumers.
  for (const n of s.nodes) {
    if (n.ins.length === 0) {
      const consumers = n.outs.flatMap(o => o.sinks.map(k => layer.get(k.node) ?? 1));
      if (consumers.length) layer.set(n, Math.max(0, Math.min(...consumers) - 1));
    }
  }
  const nL = Math.max(0, ...layer.values()) + 1;
  const layers: Node[][] = Array.from({ length: nL }, () => []);
  for (const n of s.nodes) layers[layer.get(n)!].push(n);
  // Barycentre ordering sweeps.
  const pos = new Map<Node, number>();
  const setPos = () => layers.forEach(L => L.forEach((n, i) => pos.set(n, i / Math.max(1, L.length - 1))));
  const inputPos = (i: number) => (i + 0.5) / Math.max(1, s.inputs.length);
  setPos();
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const L of layers) {
      const bc = new Map<Node, number>();
      for (const n of L) {
        const vals: number[] = [];
        for (const net of n.ins) {
          if (net.driver) vals.push(pos.get(net.driver.node) ?? 0.5);
          else if (net.inputIndex >= 0) vals.push(inputPos(net.inputIndex));
        }
        if (sweep % 2 === 1) for (const o of n.outs) for (const k of o.sinks) vals.push(pos.get(k.node) ?? 0.5);
        bc.set(n, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : pos.get(n)!);
      }
      L.sort((a, b) => bc.get(a)! - bc.get(b)! || order.get(a)! - order.get(b)!);
      L.forEach((n, i) => pos.set(n, i / Math.max(1, L.length - 1)));
    }
  }
  // Coordinates.
  const vgap = 14;
  const heights = layers.map(L => L.reduce((a, n) => a + n.h, 0) + vgap * Math.max(0, L.length - 1));
  const H = Math.max(80, ...heights) + 40;
  let x = 60;
  const channel = (i: number) => {
    // width of the routing channel after layer i: one track per net leaving it
    const nets = new Set<Net>();
    for (const n of layers[i]) for (const o of n.outs) if (o.sinks.length) nets.add(o);
    return 30 + nets.size * 5;
  };
  layers.forEach((L, i) => {
    const w = Math.max(...L.map(n => n.w));
    let y = (H - heights[i]) / 2;
    for (const n of L) {
      n.x = x + (w - n.w) / 2;
      n.y = y;
      y += n.h + vgap;
    }
    x += w + channel(i);
  });
  s.w = x + 30;
  s.h = H;
  s.laidOut = true;
  route(s);
}

function autoBounds(s: Structure): void {
  let w = 0, h = 0;
  for (const n of s.nodes) { w = Math.max(w, n.x + n.w); h = Math.max(h, n.y + n.h); }
  s.w = w + 60;
  s.h = h + 40;
  s.laidOut = true;
}

// ------------------------------------------------------------------ routing
const STUB = 8;

function dirOf(side: Side): Pt {
  switch (side) { case 'l': return { x: -1, y: 0 }; case 'r': return { x: 1, y: 0 }; case 't': return { x: 0, y: -1 }; case 'b': return { x: 0, y: 1 }; }
}

export function sourceOf(s: Structure, net: Net): PortGeom | null {
  if (net.driver) return portPos(net.driver.node, 'out', net.driver.port);
  if (net.inputIndex >= 0) return terminalPos(s, 'in', net.inputIndex);
  return null;
}

export function route(s: Structure): void {
  const trackCount = new Map<number, number>();
  for (const net of s.nets) {
    net.routes = [];
    if (net.driver && !net.driver.node.w) continue; // hidden node
    const src = sourceOf(s, net);
    if (net.inputIndex >= 0 && net.via === undefined && net.viaTo === undefined && net.sinks.every(k => !k.node.w)) continue;
    if (!src) continue;
    for (const k of net.sinks) {
      if (!k.node.w) continue;
      net.routes.push(orth(src, portPos(k.node, 'in', k.port), net, trackCount, s, net.viaTo?.[k.node.inst.name] ?? net.via));
    }
    for (const i of net.outputIndex) net.routes.push(orth(src, terminalPos(s, 'out', i), net, trackCount, s, net.via));
  }
}

function orth(a: PortGeom, b: PortGeom, net: Net, tracks: Map<number, number>, s: Structure, via: [number, number][] | undefined): number[] {
  const da = dirOf(a.side), db = dirOf(b.side);
  const a1 = { x: a.x + da.x * STUB, y: a.y + da.y * STUB };
  const b1 = { x: b.x + db.x * STUB, y: b.y + db.y * STUB };
  const pts: Pt[] = [a, a1];
  if (via) {
    for (const [x, y] of via) pts.push({ x, y });
    const last = pts[pts.length - 1];
    if (b.side === 't' || b.side === 'b') pts.push({ x: b1.x, y: last.y });
    else pts.push({ x: last.x, y: b1.y });
  } else if (a.side === 'b' || a.side === 't') {
    if (b.side === 't' || b.side === 'b') {
      const my = (a1.y + b1.y) / 2;
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my });
    } else pts.push({ x: a1.x, y: b1.y });
  } else if (b.side === 't' || b.side === 'b') {
    pts.push({ x: b1.x, y: a1.y });
  } else if (a.side === 'l' && b.side === 'r' && b1.x <= a1.x + 1) {
    // leftward flow (e.g. a ripple carry): mirror of the forward case
    if (Math.abs(a1.y - b1.y) >= 0.5) {
      const tx = (a1.x + b1.x) / 2;
      pts.push({ x: tx, y: a1.y }, { x: tx, y: b1.y });
    }
  } else if (b1.x >= a1.x - 1) {
    // forward: vertical segment in a per-net track of the channel
    const key = Math.round(a1.x / 10);
    let k = tracks.get(key * 100000 + net.id);
    if (k === undefined) {
      const used = tracks.get(key) ?? 0;
      k = used;
      tracks.set(key, used + 1);
      tracks.set(key * 100000 + net.id, k);
    }
    const span = Math.max(4, b1.x - a1.x);
    const tx = Math.abs(a1.y - b1.y) < 0.5 ? a1.x : Math.min(b1.x - 2, a1.x + Math.min(span * 0.5, 6 + k * 5));
    pts.push({ x: tx, y: a1.y }, { x: tx, y: b1.y });
  } else {
    // backward: loop around below the structure
    const lane = s.h - 12 - (net.id % 5) * 5;
    pts.push({ x: a1.x, y: lane }, { x: b1.x - 6, y: lane }, { x: b1.x - 6, y: b1.y });
  }
  pts.push(b1, b);
  return simplify(pts);
}

function simplify(pts: Pt[]): number[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
    out.push(p);
    // drop collinear middle points
    if (out.length >= 3) {
      const [p0, p1, p2] = out.slice(-3);
      if ((Math.abs(p0.x - p1.x) < 0.01 && Math.abs(p1.x - p2.x) < 0.01) || (Math.abs(p0.y - p1.y) < 0.01 && Math.abs(p1.y - p2.y) < 0.01)) out.splice(out.length - 2, 1);
    }
  }
  return out.flatMap(p => [p.x, p.y]);
}
