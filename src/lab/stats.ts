/** Execution statistics and instruction mix. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import { INSTRUCTIONS, CATEGORY_LABELS } from '../isa/spec/index.ts';
import type { Category } from '../isa/spec/index.ts';

export function statsPanel(): HTMLElement {
  const m = session.machine;
  const top = h('div', { class: 'stat-tiles' });
  const mix = h('div', { class: 'mix' });
  function render() {
    const cpi = m.instret ? (m.cycles / m.instret) : 0;
    top.innerHTML = `
      <div class="tile"><div class="tv">${m.instret.toLocaleString()}</div><div class="tl">instructions retired</div></div>
      <div class="tile"><div class="tv">${m.cycles.toLocaleString()}</div><div class="tl">clock cycles</div></div>
      <div class="tile"><div class="tv">${cpi ? cpi.toFixed(2) : '—'}</div><div class="tl">cycles / instruction</div></div>`;
    const byCat = new Map<Category, number>();
    let total = 0;
    INSTRUCTIONS.forEach((s, i) => {
      const n = m.mix[i];
      if (!n) return;
      byCat.set(s.category, (byCat.get(s.category) ?? 0) + n);
      total += n;
    });
    const rows = [...byCat].sort((a, b) => b[1] - a[1]);
    const topInsns = INSTRUCTIONS.map((s, i) => [s.mnemonic, m.mix[i]] as const).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    mix.innerHTML = total ? `
      <h5>Instruction mix</h5>
      ${rows.map(([c, n]) => `<div class="bar"><span class="bl">${CATEGORY_LABELS[c]}</span><span class="bt"><span class="bf cat-${c}" style="width:${(100 * n / total).toFixed(1)}%"></span></span><span class="bn">${(100 * n / total).toFixed(1)}%</span></div>`).join('')}
      <h5>Most executed</h5>
      ${topInsns.map(([mn, n]) => `<div class="bar"><span class="bl mono">${mn}</span><span class="bt"><span class="bf" style="width:${(100 * n / topInsns[0][1]).toFixed(1)}%"></span></span><span class="bn">${n.toLocaleString()}</span></div>`).join('')}`
      : '<p class="faint">Run the program to collect statistics.</p>';
  }
  effect(() => { session.tick.track(); render(); });
  return h('div', { class: 'stats' }, top, mix);
}
