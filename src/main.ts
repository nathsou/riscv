import './styles/tokens.css';
import './styles/base.css';
import './styles/editor.css';
import './styles/bitfield.css';
import './styles/lab.css';
import './styles/viz.css';
import './styles/reference.css';
import './styles/learn.css';
import { h, clear } from './ui/h.ts';
import { route } from './ui/router.ts';
import { effect, Scope, withScope, signal } from './ui/reactive.ts';
import { BRAND_SVG, icon } from './ui/icons.ts';
import { loadJSON, saveJSON } from './app/storage.ts';

type ViewModule = { mount(el: HTMLElement): void };

const VIEWS: Record<string, () => Promise<ViewModule>> = {
  '': () => import('./learn/home.ts'),
  learn: () => import('./learn/learn.ts'),
  lab: () => import('./lab/lab.ts'),
  datapath: () => import('./viz/datapath-view.ts'),
  ref: () => import('./reference/reference.ts'),
};

const theme = signal<string>(loadJSON('theme', ''));

function applyTheme(t: string) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  saveJSON('theme', t);
}

function currentTheme(): 'dark' | 'light' {
  const t = theme.peek();
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function nav(): HTMLElement {
  const links: [string, string][] = [['learn', 'Learn'], ['lab', 'Lab'], ['datapath', 'Datapath'], ['ref', 'Reference']];
  const linkEls = links.map(([p, label]) => h('a', { href: '#/' + p, 'data-p': p }, label));
  effect(() => {
    const top = route.value.path[0] ?? '';
    for (const a of linkEls) a.classList.toggle('active', a.dataset.p === top);
  });
  const themeBtn = h('button', { class: 'iconbtn', title: 'Toggle light / dark theme', 'aria-label': 'Toggle theme' });
  effect(() => {
    theme.value;
    themeBtn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
  });
  themeBtn.addEventListener('click', () => {
    theme.value = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(theme.value);
    window.dispatchEvent(new Event('themechange'));
  });
  return h('header', { class: 'topnav' },
    h('a', { class: 'brand', href: '#/', html: `${BRAND_SVG}<span class="brand-text">RISC-V <small>gate by gate</small></span>` }),
    h('nav', { class: 'navlinks', 'aria-label': 'Main' }, linkEls),
    h('div', { class: 'nav-spacer' }),
    themeBtn,
  );
}

const app = document.getElementById('app')!;
const rootScope = new Scope();
const view = h('main', { id: 'view' });
withScope(rootScope, () => app.append(nav(), view));

let current = '';
let viewScope: Scope | null = null;
let loadToken = 0;

effect(() => {
  const name = route.value.path[0] ?? '';
  const key = name in VIEWS ? name : '';
  if (key === current && viewScope) return;
  current = key;
  const token = ++loadToken;
  VIEWS[key]().then(mod => {
    if (token !== loadToken) return;
    viewScope?.dispose();
    clear(view);
    viewScope = new Scope();
    document.title = 'RISC-V, Gate by Gate';
    withScope(viewScope, () => mod.mount(view));
  });
});
