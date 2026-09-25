/** The guided tour: chapter index and chapter pages. */
import { h, clear } from '../ui/h.ts';
import { effect, Scope, withScope, onCleanup } from '../ui/reactive.ts';
import { route } from '../ui/router.ts';
import { icon } from '../ui/icons.ts';
import { CHAPTERS } from './chapters.ts';
import { progress, markVisited, resetProgress } from './progress.ts';

export function chapterList(compact = false): HTMLElement {
  const list = h('ol', { class: `chapter-list ${compact ? 'compact' : ''}` });
  effect(() => {
    const p = progress.value;
    list.replaceChildren(...CHAPTERS.map((c, i) => h('li', { class: p.visited[c.id] ? 'visited' : '' },
      h('a', { href: `#/learn/${c.id}` },
        h('span', { class: 'cn' }, p.visited[c.id] ? icon('check') : String(i + 1)),
        h('span', { class: 'ct' }, h('b', null, c.title), compact ? null : h('span', null, c.blurb))))));
  });
  return list;
}

export function mount(el: HTMLElement): void {
  const toc = h('nav', { class: 'learn-toc', 'aria-label': 'Chapters' });
  const main = h('div', { class: 'learn-main' });
  const scroller = h('div', { class: 'learn-scroll' }, main);
  el.append(h('div', { class: 'learn' }, toc, scroller));
  let scope: Scope | null = null;
  onCleanup(() => scope?.dispose());

  effect(() => {
    const r = route.value;
    if (r.path[0] !== 'learn') return;
    const id = r.path[1] ?? '';
    scope?.dispose();
    scope = new Scope();
    clear(main);
    clear(toc);
    withScope(scope, () => {
      toc.append(h('a', { class: 'toc-home', href: '#/learn' }, icon('book'), 'Guided tour'), chapterList(true));
      const i = CHAPTERS.findIndex(c => c.id === id);
      if (i < 0) {
        const done = Object.keys(progress.peek().visited).length;
        const resetBtn = h('button', { class: 'btn small ghost' }, 'Reset progress');
        resetBtn.addEventListener('click', resetProgress);
        main.append(h('article', { class: 'chapter' },
          h('div', { class: 'kicker' }, 'Guided tour'),
          h('h1', null, 'Build a CPU, from gates to programs'),
          h('p', { class: 'lead' }, `${CHAPTERS.length} short chapters with live circuits and simulators. Start at the beginning, or jump to what interests you. Progress is saved in this browser (${done}/${CHAPTERS.length} visited).`),
          chapterList(), h('p', null, h('a', { class: 'btn primary', href: `#/learn/${CHAPTERS[0].id}` }, 'Start with chapter 1', icon('arrowRight')), ' ', resetBtn)));
        document.title = 'Guided tour · RISC-V, Gate by Gate';
        return;
      }
      const c = CHAPTERS[i];
      const prev = CHAPTERS[i - 1], next = CHAPTERS[i + 1];
      main.append(h('article', { class: 'chapter' },
        h('div', { class: 'kicker' }, `Chapter ${i + 1} of ${CHAPTERS.length}`),
        h('h1', null, c.title),
        h('p', { class: 'lead' }, c.blurb),
        ...c.body(),
        h('nav', { class: 'chapter-nav' },
          prev ? h('a', { class: 'btn ghost', href: `#/learn/${prev.id}` }, icon('arrowLeft'), prev.title) : h('span'),
          next ? h('a', { class: 'btn primary', href: `#/learn/${next.id}` }, next.title, icon('arrowRight')) : h('a', { class: 'btn primary', href: '#/lab' }, 'Go to the Lab', icon('arrowRight')))));
      markVisited(c.id);
      document.title = `${c.title} · RISC-V, Gate by Gate`;
    });
    scroller.scrollTop = 0;
  });
}
