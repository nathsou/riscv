/** Execution controls shared by the Lab and the Datapath view. */
import { h } from '../ui/h.ts';
import { effect, listen } from '../ui/reactive.ts';
import { icon } from '../ui/icons.ts';
import { session, togglePlay, step, stepBack, reset, setMode, stepInstruction } from '../app/session.ts';
import type { EngineKind } from '../app/session.ts';

export const SPEEDS: [number, string][] = [
  [1, '1 Hz'], [2, '2 Hz'], [4, '4 Hz'], [8, '8 Hz'], [15, '15 Hz'], [30, '30 Hz'], [60, '60 Hz'],
  [250, '250 Hz'], [1000, '1 kHz'], [10000, '10 kHz'], [0, 'Max'],
];

const isMac = navigator.platform.toLowerCase().includes('mac');
export const MOD = isMac ? '⌘' : 'Ctrl';

export function statusPill(): HTMLElement {
  const pill = h('span', { class: 'pill', role: 'status' }, h('span', { class: 'dot' }), h('span', { class: 't' }));
  const m = session.machine;
  effect(() => {
    session.tick.track();
    const running = session.running.value;
    const stale = session.stale.value;
    const asm = session.asm.value;
    let cls = '', text = '';
    if (asm && !asm.ok) { cls = 'err'; text = `${asm.diagnostics.filter(d => d.severity === 'error').length} assembly error(s)`; }
    else if (running) { cls = 'run'; text = 'Running'; }
    else if (m.status === 'halted') { cls = 'ok'; text = `Exited (${m.exitCode})`; }
    else if (m.status === 'error') { cls = 'err'; text = 'Stopped: exception'; }
    else if (m.status === 'waiting') { cls = 'warn'; text = 'Waiting for input'; }
    else if (m.status === 'break') { cls = 'warn'; text = 'ebreak'; }
    else if (m.instret === 0 && m.cycles === 0) { cls = ''; text = 'Ready'; }
    else { cls = 'warn'; text = 'Paused'; }
    if (stale && !running) text += ' · edited (reset to reload)';
    pill.className = `pill ${cls}`;
    pill.querySelector('.t')!.textContent = text;
    pill.title = m.message || text;
  });
  return pill;
}

export function controls(opts: { compact?: boolean } = {}): HTMLElement {
  const runBtn = h('button', { class: 'btn primary', title: `Run / pause (${MOD}+Enter)` });
  const stepBtn = h('button', { class: 'btn', title: 'Step (F10)' }, icon('step'), opts.compact ? null : 'Step');
  const instrBtn = h('button', { class: 'btn', title: 'Step one whole instruction (Shift+F10)' }, icon('step'), 'Instr');
  const backBtn = h('button', { class: 'btn', title: 'Step back (F9)' }, icon('back'), opts.compact ? null : 'Back');
  const resetBtn = h('button', { class: 'btn', title: `Reset & reload program (${MOD}+Shift+Enter)` }, icon('reset'), opts.compact ? null : 'Reset');
  runBtn.addEventListener('click', togglePlay);
  stepBtn.addEventListener('click', step);
  instrBtn.addEventListener('click', stepInstruction);
  backBtn.addEventListener('click', stepBack);
  resetBtn.addEventListener('click', reset);

  const speed = h('select', { class: 'select', title: 'Clock speed (steps per second)', 'aria-label': 'Speed' },
    ...SPEEDS.map(([v, l]) => h('option', { value: String(v) }, l)));
  speed.value = String(session.speed.peek());
  speed.addEventListener('change', () => { session.speed.value = Number(speed.value); });

  const modes: [EngineKind, string, string][] = [
    ['isa', 'ISA', 'Instruction-level simulator: one step = one instruction'],
    ['single', 'Single-cycle', 'Single-cycle datapath: one step = one clock cycle = one instruction'],
    ['pipeline', 'Pipelined', '5-stage pipeline: one step = one clock cycle'],
  ];
  const modeBtns = modes.map(([k, l, t]) => {
    const b = h('button', { class: 'btn small', title: t }, l);
    b.addEventListener('click', () => setMode(k));
    return [k, b] as const;
  });
  const modeGroup = h('div', { class: 'btngroup', role: 'group', 'aria-label': 'Execution model' }, modeBtns.map(x => x[1]));

  effect(() => {
    const running = session.running.value;
    session.tick.track();
    runBtn.replaceChildren(icon(running ? 'pause' : 'play'), opts.compact ? '' : running ? 'Pause' : 'Run');
    const mode = session.mode.value;
    for (const [k, b] of modeBtns) b.classList.toggle('on', k === mode);
    instrBtn.classList.toggle('hidden', mode !== 'pipeline');
    stepBtn.title = mode === 'isa' ? 'Step one instruction (F10)' : 'Step one clock cycle (F10)';
    backBtn.disabled = !session.machine.canUndo();
  });

  listen(window, 'keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); reset(); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); stepInstruction(); }
    else if (e.key === 'F10') { e.preventDefault(); step(); }
    else if (e.key === 'F9') { e.preventDefault(); stepBack(); }
  });

  return h('div', { class: 'controls' },
    runBtn, stepBtn, instrBtn, backBtn, resetBtn,
    h('div', { class: 'tb-sep' }),
    h('label', { class: 'tb-label' }, h('span', null, 'Clock'), speed),
    h('div', { class: 'tb-sep' }),
    modeGroup,
  );
}
