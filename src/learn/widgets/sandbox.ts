/**
 * Hardware editing: describe a circuit in a few lines of HDL, see it drawn
 * and simulated live, and get an equivalence badge against the challenge.
 */
import { h, replace } from '../../ui/h.ts';
import { icon } from '../../ui/icons.ts';
import { Scope, withScope, onCleanup } from '../../ui/reactive.ts';
import { parseHdl, hdlDef, checkAgainst, gateCount } from '../hdl.ts';
import { circuitWidget } from './circuit.ts';
import { delays } from '../../hw/netlist.ts';
import { progress, recordQuiz } from '../progress.ts';
import { load, save } from '../../app/storage.ts';
import { CHALLENGES } from '../challenges.ts';
import type { Challenge } from '../challenges.ts';

export function sandbox(ids?: string[]): HTMLElement {
  const list = ids ? CHALLENGES.filter(c => ids.includes(c.id)) : CHALLENGES;
  const tabs = h('div', { class: 'tabs small sb-tabs' });
  const goal = h('p', { class: 'sb-goal' });
  const ta = h('textarea', { class: 'sb-src mono', spellcheck: false, rows: '9', 'aria-label': 'Circuit description' });
  const badge = h('div', { class: 'sb-badge', 'aria-live': 'polite' });
  const stats = h('div', { class: 'sb-stats' });
  const solBtn = h('button', { class: 'btn small ghost' }, 'Show a solution');
  const resetBtn = h('button', { class: 'btn small ghost' }, icon('reset'), 'Start over');
  const view = h('div', { class: 'sb-view' });
  let cur = list[0];
  let scope: Scope | null = null;
  onCleanup(() => scope?.dispose());
  let timer = 0;

  const select = (c: Challenge) => {
    cur = c;
    [...tabs.children].forEach((b, i) => b.classList.toggle('on', list[i] === c));
    goal.innerHTML = c.goal + (c.best ? ` <span class="faint">Best known: ${c.best}.</span>` : '');
    ta.value = load(`hdl-${c.id}`) ?? c.starter;
    solBtn.classList.toggle('hidden', !c.solution);
    compile();
  };
  const compile = () => {
    save(`hdl-${cur.id}`, ta.value);
    const { mod, errors } = parseHdl(ta.value);
    const c = cur;
    let errs = errors.map(e => `line ${e.line + 1}: ${e.message}`);
    if (mod && c.allowed) {
      const bad = mod.stmts.find(s => s.fn !== 'buf' && !c.allowed!.includes(s.fn));
      if (bad) errs = [`line ${bad.line + 1}: this challenge only allows ${c.allowed.join(', ')}`];
    }
    if (mod && c.inputs.length && (mod.inputs.join() !== c.inputs.join() || mod.outputs.join() !== c.outputs.join())) {
      errs = [`declare exactly “in ${c.inputs.join(', ')}” and “out ${c.outputs.join(', ')}”`];
    }
    if (!mod || errs.length) {
      replace(badge, h('span', { class: 'bad' }, icon('alert'), errs[0] ?? 'error'));
      return;
    }
    const def = hdlDef(mod, c.title);
    const counts = gateCount(mod);
    const d = Math.max(0, ...delays(def));
    stats.textContent = `${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ') || 'no gates'}   ·   ${d} gate delay${d === 1 ? '' : 's'}`;
    if (c.target) {
      const r = checkAgainst(mod, c.target, c.outputs);
      if (r.ok) {
        replace(badge, h('span', { class: 'good' }, icon('check'), `Equivalent: correct for all ${1 << mod.inputs.length} input combinations`));
        recordQuiz(`hdl-${c.id}`, true);
        tabs.children[list.indexOf(c)]?.classList.add('done');
      } else {
        const ce = r.counter!;
        const ins = mod.inputs.map((n, i) => `${n}=${ce.ins[i]}`).join(' ');
        replace(badge, h('span', { class: 'bad' }, icon('alert'), `Not yet: for ${ins} expected ${c.outputs.map((n, i) => `${n}=${ce.want[i]}`).join(' ')}, got ${c.outputs.map((n, i) => `${n}=${ce.got[i]}`).join(' ')}`));
      }
    } else replace(badge, h('span', { class: 'good' }, icon('check'), 'Compiles. Toggle the inputs below.'));
    scope?.dispose();
    scope = new Scope();
    const w = withScope(scope, () => circuitWidget({ def, table: mod.inputs.length <= 4, height: Math.max(200, Math.min(380, 120 + mod.stmts.length * 34)) }));
    replace(view, w);
  };
  list.forEach(c => {
    const b = h('button', { class: progress.peek().quiz[`hdl-${c.id}`] ? 'done' : '' }, c.title);
    b.addEventListener('click', () => select(c));
    tabs.append(b);
  });
  ta.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(compile, 250); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
  });
  solBtn.addEventListener('click', () => { if (cur.solution) { ta.value = cur.solution; compile(); } });
  resetBtn.addEventListener('click', () => { ta.value = cur.starter; compile(); });
  select(cur);
  return h('figure', { class: 'widget sandbox' },
    list.length > 1 ? tabs : null,
    h('div', { class: 'sb-top' }, goal,
      h('div', { class: 'sb-edit' }, ta, h('div', { class: 'sb-side' }, badge, stats, h('div', { class: 'sb-btns' }, resetBtn, solBtn)))),
    view);
}
