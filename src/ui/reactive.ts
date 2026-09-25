/**
 * Minimal fine-grained reactivity: signals, computed values and effects,
 * with ownership scopes so a view's effects are disposed when it unmounts.
 */

type Sub = () => void;

interface Computation {
  run(): void;
  deps: Set<Set<Computation>>;
  disposed: boolean;
}

let current: Computation | null = null;
let batchDepth = 0;
const pending = new Set<Computation>();

export interface Signal<T> {
  get value(): T;
  set value(v: T);
  peek(): T;
  update(fn: (v: T) => T): void;
  subscribe(fn: (v: T) => void): () => void;
}

export function signal<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Signal<T> {
  let v = initial;
  const subs = new Set<Computation>();
  const s: Signal<T> = {
    get value() {
      if (current) { subs.add(current); current.deps.add(subs); }
      return v;
    },
    set value(nv: T) {
      if (equals(v, nv)) return;
      v = nv;
      notify(subs);
    },
    peek: () => v,
    update(fn) { s.value = fn(v); },
    subscribe(fn) { return effect(() => fn(s.value)); },
  };
  return s;
}

/** A signal that always notifies (for mutable objects such as the machine). */
export function trigger(): { track(): void; fire(): void } {
  const subs = new Set<Computation>();
  return {
    track() { if (current) { subs.add(current); current.deps.add(subs); } },
    fire() { notify(subs); },
  };
}

function notify(subs: Set<Computation>) {
  for (const c of [...subs]) pending.add(c);
  if (batchDepth === 0) flush();
}

function flush() {
  while (pending.size) {
    const list = [...pending];
    pending.clear();
    for (const c of list) if (!c.disposed) c.run();
  }
}

export function batch(fn: () => void): void {
  batchDepth++;
  try { fn(); } finally { batchDepth--; if (batchDepth === 0) flush(); }
}

export function untrack<T>(fn: () => T): T {
  const prev = current;
  current = null;
  try { return fn(); } finally { current = prev; }
}

// ---------------------------------------------------------------- scopes
export class Scope {
  private cleanups: Sub[] = [];
  add(fn: Sub): void { this.cleanups.push(fn); }
  dispose(): void {
    const c = this.cleanups;
    this.cleanups = [];
    for (let i = c.length - 1; i >= 0; i--) c[i]();
  }
}

let currentScope: Scope | null = null;

export function withScope<T>(scope: Scope, fn: () => T): T {
  const prev = currentScope;
  currentScope = scope;
  try { return fn(); } finally { currentScope = prev; }
}

export function onCleanup(fn: Sub): void {
  currentScope?.add(fn);
}

export function effect(fn: () => void): () => void {
  const c: Computation = {
    deps: new Set(),
    disposed: false,
    run() {
      for (const d of c.deps) d.delete(c);
      c.deps.clear();
      const prev = current;
      current = c;
      try { fn(); } finally { current = prev; }
    },
  };
  c.run();
  const dispose = () => {
    c.disposed = true;
    for (const d of c.deps) d.delete(c);
    c.deps.clear();
  };
  onCleanup(dispose);
  return dispose;
}

export function computed<T>(fn: () => T): { readonly value: T } {
  const s = signal<T>(undefined as T);
  effect(() => { s.value = fn(); });
  return { get value() { return s.value; } };
}

/** Event listener that is removed with the current scope. */
export function listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
export function listen<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void;
export function listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
export function listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
  target.addEventListener(type, fn, opts);
  onCleanup(() => target.removeEventListener(type, fn, opts));
}
