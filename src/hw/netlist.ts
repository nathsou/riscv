/**
 * Hierarchical netlist with dual models.
 *
 * Every hardware module (a `Def`) has a fast word-level `behave` function
 * and, optionally, a `build` function that describes the same circuit as
 * a structure of smaller modules — down to primitive logic gates. Any
 * instance can be viewed collapsed (behavioural) or expanded (structural);
 * tests assert the two always agree.
 *
 * Structures are built lazily (only when someone looks inside) and are
 * evaluated from the inputs recorded when the parent was evaluated, so the
 * values you see inside a gate-level adder are really computed by gates.
 */

export type Side = 'l' | 'r' | 't' | 'b';
export type SigKind = 'data' | 'ctrl' | 'addr' | 'clk';

export interface Port {
  name: string;
  width: number;
  side?: Side;
  kind?: SigKind;
  /** Position along the side, 0..1 (default: evenly spaced). */
  pos?: number;
  /** Hide the port label in drawings. */
  quiet?: boolean;
}

export type Shape =
  | 'box' | 'mux' | 'alu' | 'adder' | 'reg' | 'mem' | 'pla' | 'split' | 'join' | 'const' | 'wire' | 'pipereg'
  | 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' | 'not' | 'buf';

export interface Def {
  type: string;
  /** Display title. */
  name: string;
  inputs: Port[];
  outputs: Port[];
  behave(inp: number[], inst: Instance): number[];
  build?(b: Builder, inst: Instance): void;
  /** Leaf delay in gate delays (per output, or one value for all). */
  delay?: number | number[];
  /** For each output, the input indices it depends on (default: all). */
  deps?: number[][];
  doc?: string;
  shape?: Shape;
  size?: [number, number];
  /** Structure contains feedback: iterate evaluation to a fixed point. */
  sequential?: boolean;
  /** Seed internal state nets before iterating (sequential structures). */
  seed?(s: Structure, inst: Instance): void;
  /** Custom placement of the structure's nodes (else auto-layout). */
  layout?(s: Structure): void;
  /** Which inputs matter, given input values and which outputs are live. */
  liveIn?(inp: number[], liveOut: boolean[]): boolean[];
  /** Zero-delay wiring (splits, joins, constants). */
  wiring?: boolean;
  /** Custom interior renderer key used by the visualiser. */
  interior?: string;
  /** Dynamic label drawn on the node (e.g. the selected mux input). */
  label?(inst: Instance): string | null;
  /** A short tag (e.g. the abstraction level name) shown in breadcrumbs. */
  level?: string;
  /** For rewiring nodes: source bit of each output bit (-1 = 0). */
  bitMap?: number[];
}

export interface InstOpts {
  /** State getter for sequential elements (registers, memories). */
  state?: () => number;
  /** Arbitrary per-instance parameters. */
  [k: string]: unknown;
}

let EPOCH = 0;

export class Instance {
  def: Def;
  name: string;
  parent: Instance | null;
  opts: InstOpts;
  inVals: number[];
  outVals: number[];
  prevIn: number[];
  prevOut: number[];
  inArr: number[];
  outArr: number[];
  /** Epoch at which inVals were last written. */
  inEpoch = -1;
  /** Epoch at which the structure was last evaluated. */
  evalEpoch = -2;
  private _s: Structure | null = null;
  private _built = false;

  constructor(def: Def, name: string, parent: Instance | null, opts: InstOpts = {}) {
    this.def = def;
    this.name = name;
    this.parent = parent;
    this.opts = opts;
    this.inVals = def.inputs.map(() => 0);
    this.prevIn = def.inputs.map(() => 0);
    this.inArr = def.inputs.map(() => 0);
    this.outVals = def.outputs.map(() => 0);
    this.prevOut = def.outputs.map(() => 0);
    this.outArr = def.outputs.map(() => 0);
  }

  get hasStructure(): boolean { return !!this.def.build; }

  /** The expanded structure (built on first access). */
  get structure(): Structure | null {
    if (!this.def.build) return null;
    if (!this._built) {
      this._built = true;
      const b = new Builder(this);
      this.def.build(b, this);
      this._s = b.finish();
    }
    return this._s;
  }

  /** Evaluate the structure from the recorded inputs, if stale. */
  ensureEvaluated(): Structure | null {
    const s = this.structure;
    if (!s) return null;
    if (this.evalEpoch !== this.inEpoch) {
      evalStructure(s, this.inVals, this.prevIn, this.inArr);
      this.evalEpoch = this.inEpoch;
    }
    return s;
  }

  /** Discard the built structure (e.g. after swapping a module choice). */
  rebuild(): void {
    this._built = false;
    this._s = null;
    this.evalEpoch = -2;
  }

  get path(): string {
    return this.parent ? `${this.parent.path}/${this.name}` : this.name;
  }

  /** Walk down by child names. */
  child(name: string): Instance | null {
    return this.structure?.nodes.find(n => n.inst.name === name)?.inst ?? null;
  }
}

export class Net {
  id: number;
  width: number;
  name: string;
  kind: SigKind;
  value = 0;
  prev = 0;
  arrival = 0;
  driver: { node: Node; port: number } | null = null;
  /** Index into the owning structure's inputs, if this net is an input. */
  inputIndex = -1;
  sinks: { node: Node; port: number }[] = [];
  /** Structure outputs this net drives. */
  outputIndex: number[] = [];
  /** Routed polylines (one per sink / output), filled by the visualiser. */
  routes: number[][] = [];
  /** Optional routing waypoints hint (per structure-local coordinates). */
  via?: [number, number][];
  /** Waypoints for the route to one particular sink (by instance name). */
  viaTo?: Record<string, [number, number][]>;
  /** Draw as labelled stubs (net labels) instead of a long wire. */
  tunnel?: boolean;
  /** Liveness (is this signal used by the current instruction?). */
  live = true;
  constructor(id: number, width: number, name: string, kind: SigKind) {
    this.id = id;
    this.width = width;
    this.name = name;
    this.kind = kind;
  }
}

export class Node {
  inst: Instance;
  ins: Net[];
  outs: Net[];
  x = 0;
  y = 0;
  w: number;
  h: number;
  constructor(inst: Instance, ins: Net[], outs: Net[]) {
    this.inst = inst;
    this.ins = ins;
    this.outs = outs;
    const sz = inst.def.size ?? defaultSize(inst.def);
    this.w = sz[0];
    this.h = sz[1];
  }
}

export function defaultSize(d: Def): [number, number] {
  switch (d.shape) {
    case 'and': case 'or': case 'xor': case 'nand': case 'nor': case 'xnor': {
      const n = d.inputs.length;
      return [36, Math.max(28, n * 10 + 8)];
    }
    case 'not': case 'buf': return [28, 20];
    case 'split': case 'join': return [6, Math.max(24, Math.max(d.inputs.length, d.outputs.length) * 10)];
    case 'const': return [26, 16];
    case 'mux': return [26, Math.max(44, d.inputs.length * 16)];
    default: {
      const n = Math.max(d.inputs.filter(p => (p.side ?? 'l') === 'l').length, d.outputs.filter(p => (p.side ?? 'r') === 'r').length);
      return [90, Math.max(50, n * 18 + 16)];
    }
  }
}

export class Structure {
  owner: Instance;
  nodes: Node[] = [];
  nets: Net[] = [];
  inputs: Net[] = [];
  outputs: Net[] = [];
  /** Bounds of the laid-out structure (set by layout). */
  w = 0;
  h = 0;
  laidOut = false;
  constructor(owner: Instance) { this.owner = owner; }

  net(name: string): Net | undefined {
    return this.nets.find(n => n.name === name);
  }

  node(name: string): Node | undefined {
    return this.nodes.find(n => n.inst.name === name);
  }
}

// ------------------------------------------------------------------ builder
export class Builder {
  s: Structure;
  private owner: Instance;
  private aliases = new Map<Net, Net>();
  private counter = 0;

  constructor(owner: Instance) {
    this.owner = owner;
    this.s = new Structure(owner);
    owner.def.inputs.forEach((p, i) => {
      const n = this.net(p.width, p.name, p.kind ?? 'data');
      n.inputIndex = i;
      this.s.inputs.push(n);
    });
  }

  private net(width: number, name: string, kind: SigKind): Net {
    const n = new Net(this.s.nets.length, width, name, kind);
    this.s.nets.push(n);
    return n;
  }

  get inst(): Instance { return this.owner; }

  /** A structure input by name or index. */
  in(name: string | number): Net {
    if (typeof name === 'number') return this.s.inputs[name];
    const i = this.owner.def.inputs.findIndex(p => p.name === name);
    if (i < 0) throw new Error(`${this.owner.def.type}: no input ${name}`);
    return this.s.inputs[i];
  }

  /** Connect a net to a structure output. */
  out(name: string | number, net: Net): void {
    const i = typeof name === 'number' ? name : this.owner.def.outputs.findIndex(p => p.name === name);
    if (i < 0) throw new Error(`${this.owner.def.type}: no output ${name}`);
    this.s.outputs[i] = net;
  }

  /** Add a child instance. Returns its output nets. */
  add(def: Def, inputs: Net[] | Record<string, Net>, opts: InstOpts & { name?: string; netNames?: string[] } = {}): Net[] {
    const name = opts.name ?? `${def.type.toLowerCase()}${this.counter++}`;
    const inst = new Instance(def, name, this.owner, opts);
    const ins = Array.isArray(inputs) ? inputs : def.inputs.map(p => {
      const n = inputs[p.name];
      if (!n) throw new Error(`${def.type}: missing input ${p.name}`);
      return n;
    });
    if (ins.length !== def.inputs.length) throw new Error(`${def.type}: expected ${def.inputs.length} inputs, got ${ins.length}`);
    ins.forEach((n, i) => {
      if (n.width !== def.inputs[i].width) throw new Error(`${def.type}.${def.inputs[i].name}: width ${n.width} ≠ ${def.inputs[i].width} (${this.owner.def.type})`);
    });
    const outs = def.outputs.map((p, i) => this.net(p.width, opts.netNames?.[i] ?? `${name}.${p.name}`, p.kind ?? 'data'));
    const node = new Node(inst, ins, outs);
    ins.forEach((n, port) => n.sinks.push({ node, port }));
    outs.forEach((n, port) => { n.driver = { node, port }; });
    this.s.nodes.push(node);
    return outs;
  }

  /** Name a net (for lookups and tooltips). */
  name(net: Net, name: string, kind?: SigKind): Net {
    net.name = name;
    if (kind) net.kind = kind;
    return net;
  }

  /** A placeholder for a signal produced later (feedback / late-bound). */
  late(width: number, name: string, kind: SigKind = 'data'): Net {
    return this.net(width, name, kind);
  }

  /** Bind a placeholder to its real driver. */
  bind(late: Net, real: Net): void {
    if (late.width !== real.width) throw new Error(`bind ${late.name}: width ${late.width} ≠ ${real.width}`);
    this.aliases.set(late, real);
  }

  finish(): Structure {
    const s = this.s;
    if (this.aliases.size) {
      const resolve = (n: Net): Net => { let r = n; while (this.aliases.has(r)) r = this.aliases.get(r)!; return r; };
      for (const node of s.nodes) {
        node.ins = node.ins.map((n, port) => {
          const r = resolve(n);
          if (r !== n) r.sinks.push({ node, port });
          return r;
        });
      }
      s.outputs = s.outputs.map(resolve);
      s.nets = s.nets.filter(n => !this.aliases.has(n));
      for (const n of s.nets) n.sinks = n.sinks.filter(sk => sk.node.ins[sk.port] === n);
    }
    s.outputs.forEach((n, i) => {
      if (!n) throw new Error(`${this.owner.def.type}: output ${this.owner.def.outputs[i].name} not connected`);
      n.outputIndex.push(i);
    });
    s.nets.forEach((n, i) => { n.id = i; });
    return s;
  }
}

// ------------------------------------------------------------------ evaluation
let delayCache = new WeakMap<Def, number[]>();

export function clearDelayCache(): void { delayCache = new WeakMap(); }

/** Per-output propagation delay of a module, in gate delays. */
export function delays(def: Def): number[] {
  const hit = delayCache.get(def);
  if (hit) return hit;
  let d: number[];
  if (def.wiring) d = def.outputs.map(() => 0);
  else if (def.delay !== undefined) d = typeof def.delay === 'number' ? def.outputs.map(() => def.delay as number) : def.delay;
  else if (def.build && !def.sequential) {
    const inst = new Instance(def, 'timing', null);
    const s = inst.structure!;
    for (const n of s.inputs) n.arrival = 0;
    propagateArrival(s);
    d = s.outputs.map(n => n.arrival);
  } else d = def.outputs.map(() => 1);
  delayCache.set(def, d);
  return d;
}

function propagateArrival(s: Structure): void {
  for (const node of s.nodes) {
    const dl = delays(node.inst.def);
    const deps = node.inst.def.deps;
    node.outs.forEach((o, j) => {
      let a = 0;
      const idx = deps ? deps[j] : null;
      if (idx) for (const i of idx) a = Math.max(a, node.ins[i].arrival);
      else for (const n of node.ins) a = Math.max(a, n.arrival);
      o.arrival = a + dl[j];
    });
  }
}

/** Evaluate a structure for current and previous inputs, with arrival times. */
export function evalStructure(s: Structure, inVals: number[], prevIn: number[], inArr: number[]): void {
  const def = s.owner.def;
  s.inputs.forEach((n, i) => { n.value = inVals[i]; n.prev = prevIn[i]; n.arrival = inArr[i]; });
  const passes = def.sequential ? 12 : 1;
  if (def.sequential && def.seed) def.seed(s, s.owner);
  EPOCH++;
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const node of s.nodes) {
      const inst = node.inst;
      const ins = node.ins.map(n => n.value);
      const pins = node.ins.map(n => n.prev);
      const out = inst.def.behave(ins, inst);
      const pout = inst.def.behave(pins, inst);
      const dl = delays(inst.def);
      const deps = inst.def.deps;
      inst.inVals = ins;
      inst.prevIn = pins;
      inst.inArr = node.ins.map(n => n.arrival);
      inst.outVals = out;
      inst.prevOut = pout;
      inst.inEpoch = EPOCH;
      node.outs.forEach((o, j) => {
        let a = 0;
        const idx = deps ? deps[j] : null;
        if (idx) for (const i of idx) a = Math.max(a, node.ins[i].arrival);
        else for (const n of node.ins) a = Math.max(a, n.arrival);
        const v = out[j] >>> 0 === out[j] ? out[j] : out[j] >>> 0;
        if (o.value !== v || o.prev !== (pout[j] >>> 0)) changed = true;
        o.value = v;
        o.prev = pout[j] >>> 0;
        o.arrival = a + dl[j];
        inst.outArr[j] = o.arrival;
      });
    }
    if (!changed && pass > 0) break;
  }
  // Late-bound inputs may have been read before they were computed: refresh.
  for (const node of s.nodes) {
    node.inst.inVals = node.ins.map(n => n.value);
    node.inst.prevIn = node.ins.map(n => n.prev);
  }
}

/** Evaluate a top-level instance (no parent): its inputs are given directly. */
export function evalTop(inst: Instance, inVals: number[]): void {
  inst.prevIn = inst.inVals;
  inst.inVals = inVals;
  inst.inEpoch = ++EPOCH;
  inst.ensureEvaluated();
}

/** Check the structural model against the behavioural one for given inputs. */
export function checkEquivalence(def: Def, inputs: number[], opts: InstOpts = {}): { ok: boolean; behave: number[]; structural: number[] } {
  const inst = new Instance(def, 'dut', null, opts);
  const behave = def.behave(inputs, inst).map(v => v >>> 0);
  inst.inVals = inputs;
  inst.prevIn = inputs;
  inst.inEpoch = ++EPOCH;
  const s = inst.ensureEvaluated();
  const structural = s ? s.outputs.map(n => n.value >>> 0) : behave;
  return { ok: behave.every((v, i) => v === structural[i]), behave, structural };
}

export function mask(width: number): number {
  return width >= 32 ? 0xffffffff : (1 << width) - 1;
}

/**
 * Evaluate a root instance whose values depend only on machine state
 * (registers, memories), remembering the previous evaluation as `prev`
 * so the visualiser can animate what changed.
 */
export function evalRoot(inst: Instance): Structure {
  const s = inst.structure!;
  const snap = s.nets.map(n => n.value);
  evalStructure(s, [], [], []);
  s.nets.forEach((n, i) => { n.prev = snap[i]; });
  for (const node of s.nodes) {
    node.inst.prevIn = node.ins.map(n => n.prev);
    node.inst.prevOut = node.outs.map(n => n.prev);
  }
  inst.inEpoch = ++EPOCH;
  inst.evalEpoch = inst.inEpoch;
  computeLiveness(s);
  return s;
}

/** Mark which nets matter for the current values (e.g. the path an instruction uses). */
export function computeLiveness(s: Structure): void {
  const liveOut = new Map<Node, boolean[]>();
  for (const n of s.nets) n.live = n.outputIndex.length > 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let k = s.nodes.length - 1; k >= 0; k--) {
      const node = s.nodes[k];
      const lo = node.outs.map(o => o.live);
      liveOut.set(node, lo);
      const def = node.inst.def;
      const li = def.liveIn ? def.liveIn(node.inst.inVals, lo) : node.ins.map(() => lo.some(Boolean));
      node.ins.forEach((n, i) => {
        if (li[i] && !n.live) { n.live = true; changed = true; }
      });
    }
    if (!changed) break;
  }
}

/** A node exposing a piece of external state (e.g. "interrupt pending"). */
export function SOURCE(name: string, width: number, kind: SigKind, doc: string): Def {
  return {
    type: `Source_${name}`, name, inputs: [], outputs: [{ name: 'v', width, kind, quiet: true }],
    behave: (_, inst) => [(inst.opts.state ? inst.opts.state() : 0) >>> 0],
    delay: 0, shape: 'const', size: [40, 18], doc,
    label: () => name,
  };
}

/** Walk every structural level below an instance and compare with behaviour. */
export function checkDeep(inst: Instance, maxDepth = 3, path = inst.name): string[] {
  const errs: string[] = [];
  const s = inst.ensureEvaluated();
  if (!s || maxDepth <= 0) return errs;
  const outs = s.outputs.map(n => n.value >>> 0);
  const exp = inst.def.behave(inst.inVals, inst).map(v => v >>> 0);
  if (!inst.def.sequential && outs.some((v, i) => v !== exp[i])) errs.push(`${path}: gates ${outs} ≠ behaviour ${exp}`);
  for (const node of s.nodes) if (node.inst.hasStructure) errs.push(...checkDeep(node.inst, maxDepth - 1, `${path}/${node.inst.name}`));
  return errs;
}
