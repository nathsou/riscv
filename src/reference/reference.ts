/** The Reference area: instruction cards and guide pages with a sidebar. */
import { h, clear } from '../ui/h.ts';
import { effect, Scope, withScope, onCleanup } from '../ui/reactive.ts';
import { route, navigate } from '../ui/router.ts';
import { BY_MNEMONIC, INSTRUCTIONS, CATEGORY_LABELS } from '../isa/spec/index.ts';
import type { Category } from '../isa/spec/index.ts';
import { instructionCard } from './card.ts';
import { indexPage, notationPage, formatsPage, abiPage, memoryPage, syscallsPage, csrPage, pseudoPage, directivesPage } from './pages.ts';

const GUIDES: [string, string, () => HTMLElement][] = [
  ['notation', 'Notation', notationPage],
  ['formats', 'Instruction formats', formatsPage],
  ['abi', 'Registers & ABI', abiPage],
  ['memory', 'Memory map & MMIO', memoryPage],
  ['syscalls', 'System calls', syscallsPage],
  ['csrs', 'CSRs & traps', csrPage],
  ['pseudo', 'Pseudo-instructions', pseudoPage],
  ['directives', 'Directives', directivesPage],
];

export function mount(el: HTMLElement): void {
  const content = h('div', { class: 'ref-content' });
  const links = new Map<string, HTMLAnchorElement>();
  const link = (key: string, label: string, cls = '') => {
    const a = h('a', { href: `#/ref${key ? '/' + key : ''}`, class: cls }, label);
    links.set(key, a);
    return a;
  };
  const cats = Object.keys(CATEGORY_LABELS) as Category[];
  const side = h('nav', { class: 'ref-side', 'aria-label': 'Reference contents' },
    h('div', { class: 'side-group' }, link('', 'All instructions', 'strong')),
    h('div', { class: 'side-group' }, h('h4', null, 'Guides'), ...GUIDES.map(([k, l]) => link(k, l))),
    ...cats.map(c => h('div', { class: 'side-group' }, h('h4', null, CATEGORY_LABELS[c]),
      h('div', { class: 'side-mns' }, ...INSTRUCTIONS.filter(s => s.category === c).map(s => link(s.mnemonic, s.mnemonic, 'mono'))))));
  const scroller = h('div', { class: 'ref-main' }, content);
  el.append(h('div', { class: 'ref' }, side, scroller));

  let scope: Scope | null = null;
  onCleanup(() => scope?.dispose());
  let query = '';
  effect(() => {
    const r = route.value;
    if (r.path[0] !== 'ref') return;
    const key = r.path[1] ?? '';
    scope?.dispose();
    scope = new Scope();
    clear(content);
    withScope(scope, () => {
      const guide = GUIDES.find(g => g[0] === key);
      const spec = BY_MNEMONIC.get(key);
      if (!key) content.append(indexPage(query, q => { query = q; }));
      else if (guide) content.append(guide[2]());
      else if (spec) content.append(instructionCard(spec));
      else content.append(h('article', { class: 'card guide' }, h('h1', null, 'Not found'), h('p', null, `No reference page called “${key}”.`)));
    });
    for (const [k, a] of links) a.classList.toggle('on', k === key);
    links.get(key)?.scrollIntoView({ block: 'nearest' });
    scroller.scrollTop = 0;
    document.title = `${spec(key) ?? (GUIDES.find(g => g[0] === key)?.[1] ?? 'Reference')} · RISC-V, gate by gate`;
  });
  // keyboard: j/k (or ←/→) for next/previous instruction
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const key = route.peek().path[1] ?? '';
    const i = INSTRUCTIONS.findIndex(s => s.mnemonic === key);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'j') { const n = INSTRUCTIONS[i + 1]; if (n) navigate(`/ref/${n.mnemonic}`); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { const p = INSTRUCTIONS[i - 1]; if (p) navigate(`/ref/${p.mnemonic}`); }
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));
}

function spec(key: string): string | undefined {
  const s = BY_MNEMONIC.get(key);
  return s ? `${s.mnemonic} — ${s.summary}` : undefined;
}
