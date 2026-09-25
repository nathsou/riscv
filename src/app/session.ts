/**
 * The shared program session: source, assembly, machine, execution engine
 * and the run loop. The Lab, the Datapath view and Learn widgets all read it.
 */
import { assemble } from '../asm/assembler.ts';
import type { AsmResult } from '../asm/assembler.ts';
import { Machine } from '../sim/machine.ts';
import { signal, trigger, batch } from '../ui/reactive.ts';
import { load, save, loadJSON, saveJSON } from './storage.ts';
import { EXAMPLES } from '../content/examples.ts';
import { SingleCycleEngine } from '../hw/cpu/single.ts';

export type EngineKind = 'isa' | 'single' | 'pipeline';

export interface Engine {
  readonly kind: EngineKind;
  /** One step at this engine's granularity (instruction or clock cycle). */
  step(): void;
  undo(): boolean;
  /** Re-derive internal state after the machine was reset or rewound. */
  sync(): void;
  /** Prepare to hand the machine over to another engine. */
  detach(): void;
  /** Did the last step retire an instruction? */
  retired(): boolean;
}

class IsaEngine implements Engine {
  readonly kind = 'isa' as const;
  m: Machine;
  constructor(m: Machine) { this.m = m; }
  step() { this.m.step(); }
  undo() { return this.m.undo(); }
  sync() {}
  detach() {}
  retired() { return true; }
}

export interface Session {
  source: ReturnType<typeof signal<string>>;
  asm: ReturnType<typeof signal<AsmResult | null>>;
  /** The assembly currently loaded into the machine. */
  loaded: ReturnType<typeof signal<AsmResult | null>>;
  machine: Machine;
  engine: Engine;
  mode: ReturnType<typeof signal<EngineKind>>;
  /** Fires whenever machine state changes. */
  tick: ReturnType<typeof trigger>;
  running: ReturnType<typeof signal<boolean>>;
  /** Steps per second; 0 = as fast as possible. */
  speed: ReturnType<typeof signal<number>>;
  breakpoints: ReturnType<typeof signal<Set<number>>>;
  stale: ReturnType<typeof signal<boolean>>;
  exampleId: ReturnType<typeof signal<string>>;
}

const DEFAULT_EXAMPLE = 'hello';

const machine = new Machine();

export const session: Session = {
  source: signal(load('source') ?? EXAMPLES.find(e => e.id === DEFAULT_EXAMPLE)!.source),
  asm: signal<AsmResult | null>(null),
  loaded: signal<AsmResult | null>(null),
  machine,
  engine: new IsaEngine(machine),
  mode: signal<EngineKind>('isa'),
  tick: trigger(),
  running: signal(false),
  speed: signal(loadJSON('speed', 8)),
  breakpoints: signal(new Set<number>(loadJSON<number[]>('breakpoints', []))),
  stale: signal(false),
  exampleId: signal(load('example') ?? DEFAULT_EXAMPLE),
};

const engineFactories = new Map<EngineKind, (m: Machine) => Engine>();
engineFactories.set('isa', m => new IsaEngine(m));
engineFactories.set('single', m => new SingleCycleEngine(m));

/** Hardware engines register themselves lazily (they live in the hw module). */
export function registerEngine(kind: EngineKind, f: (m: Machine) => Engine): void {
  engineFactories.set(kind, f);
}

const engines = new Map<EngineKind, Engine>();
function engineFor(kind: EngineKind): Engine {
  let e = engines.get(kind);
  if (!e) {
    e = engineFactories.get(kind)!(machine);
    engines.set(kind, e);
  }
  return e;
}

export function setMode(kind: EngineKind): void {
  if (kind === session.mode.peek()) return;
  if (!engineFactories.has(kind)) return;
  pause();
  session.engine.detach();
  machine.history.clear();
  session.engine = engineFor(kind);
  session.engine.sync();
  session.mode.value = kind;
  session.tick.fire();
}

// ------------------------------------------------------------- assembly
let asmTimer = 0;
function assembleNow(): void {
  const r = assemble(session.source.peek());
  batch(() => {
    session.asm.value = r;
    const pristine = machine.instret === 0 && machine.history.length === 0;
    if (r.ok && (pristine || !session.loaded.peek())) loadProgram(r);
    else session.stale.value = r.ok && session.loaded.peek() !== r && !sameImage(r, session.loaded.peek());
  });
}

function sameImage(a: AsmResult, b: AsmResult | null): boolean {
  if (!b) return false;
  if (a.image.segments.length !== b.image.segments.length) return false;
  return a.image.segments.every((s, i) => {
    const t = b.image.segments[i];
    return s.base === t.base && s.bytes.length === t.bytes.length && s.bytes.every((x, j) => x === t.bytes[j]);
  });
}

session.source.subscribe(src => {
  save('source', src);
  clearTimeout(asmTimer);
  asmTimer = window.setTimeout(assembleNow, 180);
});

function loadProgram(r: AsmResult): void {
  pause();
  machine.loadProgram(r.image);
  session.loaded.value = r;
  session.stale.value = false;
  session.engine.sync();
  session.tick.fire();
}

/** Reset the machine, loading the latest successful assembly. */
export function reset(): void {
  clearTimeout(asmTimer);
  const r = assemble(session.source.peek());
  session.asm.value = r;
  if (r.ok) loadProgram(r);
  else {
    pause();
    machine.reset();
    session.engine.sync();
    session.tick.fire();
  }
}

/** Keep a copy of the current program so it can be restored after loading another. */
export function backupSource(): void {
  const cur = session.source.peek();
  const isExample = EXAMPLES.some(e => e.source === cur);
  if (!isExample && cur.trim()) save('source-prev', cur);
}

export function previousSource(): string | null { return load('source-prev'); }

export function setSource(src: string, exampleId = ''): void {
  session.source.value = src;
  session.exampleId.value = exampleId;
  save('example', exampleId);
  clearTimeout(asmTimer);
  assembleNow();
  const r = session.asm.peek();
  if (r?.ok) loadProgram(r);
}

// ------------------------------------------------------------- breakpoints
session.breakpoints.subscribe(b => saveJSON('breakpoints', [...b]));
session.speed.subscribe(s => saveJSON('speed', s));

export function toggleBreakpoint(line: number): void {
  const b = new Set(session.breakpoints.peek());
  if (b.has(line)) b.delete(line); else b.add(line);
  session.breakpoints.value = b;
}

function breakpointAddrs(): Set<number> {
  const r = session.loaded.peek();
  const out = new Set<number>();
  if (!r) return out;
  for (const line of session.breakpoints.peek()) {
    const a = r.lineToAddrs.get(line);
    if (a?.length) out.add(a[0]);
  }
  return out;
}

// ------------------------------------------------------------- stepping
export function canRun(): boolean {
  const s = machine.status;
  return s === 'ready' || s === 'break';
}

export function step(): void {
  pause();
  if (!canRun()) return;
  session.engine.step();
  session.tick.fire();
}

/** Step until an instruction retires (for cycle-level engines). */
export function stepInstruction(): void {
  pause();
  if (!canRun()) return;
  let guard = 0;
  do { session.engine.step(); } while (!session.engine.retired() && canRun() && ++guard < 64);
  session.tick.fire();
}

export function stepBack(): void {
  pause();
  if (session.engine.undo()) session.tick.fire();
}

export function runToLine(line: number): void {
  const r = session.loaded.peek();
  const addr = r?.lineToAddrs.get(line)?.[0];
  if (addr === undefined) return;
  runUntil = addr;
  play();
}

let runUntil: number | null = null;
let raf = 0;
let lastT = 0;
let debt = 0;
let sleepUntil = 0;

export function play(): void {
  if (session.running.peek()) return;
  if (machine.status === 'halted' || machine.status === 'error') return;
  if (machine.status === 'break') machine.status = 'ready';
  session.running.value = true;
  lastT = performance.now();
  debt = 0;
  // Step off a breakpoint we are sitting on.
  const bps = breakpointAddrs();
  if (bps.has(machine.pc) || runUntil === machine.pc) { session.engine.step(); }
  raf = requestAnimationFrame(frame);
}

export function pause(): void {
  if (!session.running.peek()) return;
  session.running.value = false;
  runUntil = null;
  cancelAnimationFrame(raf);
  session.tick.fire();
}

export function togglePlay(): void {
  if (session.running.peek()) pause(); else play();
}

function frame(t: number): void {
  if (!session.running.peek()) return;
  const dt = Math.min(250, t - lastT);
  lastT = t;
  if (t < sleepUntil) { raf = requestAnimationFrame(frame); return; }
  const bps = breakpointAddrs();
  if (runUntil !== null) bps.add(runUntil);
  const speed = session.speed.peek();
  const e = session.engine;
  let stopped = false;
  const stopCheck = () => {
    if (!canRun()) return true;
    if (e.retired() && bps.size && bps.has(machine.pc)) return true;
    return false;
  };
  if (speed === 0 && e.kind === 'isa') {
    // Turbo: run in time-boxed slices, directly on the machine.
    const deadline = performance.now() + 12;
    while (performance.now() < deadline) {
      machine.run(20000, bps);
      if (machine.sleepMs || !canRun() || bps.has(machine.pc)) break;
    }
    stopped = !canRun() || bps.has(machine.pc);
  } else {
    const rate = speed === 0 ? 5000 : speed;
    debt += (dt / 1000) * rate;
    const n = Math.min(Math.floor(debt), speed === 0 ? 5000 : 2000);
    debt -= n;
    const deadline = performance.now() + 12;
    for (let i = 0; i < n; i++) {
      e.step();
      if (stopCheck() || machine.sleepMs) { stopped = stopCheck(); break; }
      if (performance.now() > deadline) { debt = 0; break; }
    }
  }
  if (machine.sleepMs) {
    sleepUntil = performance.now() + machine.sleepMs;
    machine.sleepMs = 0;
  }
  session.tick.fire();
  if (stopped) { pause(); return; }
  raf = requestAnimationFrame(frame);
}

// Initial assembly.
assembleNow();
