/** The Lab: editor + simulator + inspectors (+ docked datapath). */
import { h } from '../ui/h.ts';
import { effect, signal, listen } from '../ui/reactive.ts';
import { icon } from '../ui/icons.ts';
import { route, navigate } from '../ui/router.ts';
import { session, setSource, toggleBreakpoint, backupSource, previousSource } from '../app/session.ts';
import { EXAMPLES } from '../content/examples.ts';
import { createEditor } from '../editor/editor.ts';
import type { EditorHandle } from '../editor/editor.ts';
import { hex } from '../isa/bits.ts';
import { loadJSON, saveJSON } from '../app/storage.ts';
import { encodeProgram, decodeProgram } from '../app/share.ts';
import { toast } from '../ui/components/tooltip.ts';
import { registersPanel } from './registers.ts';
import { consolePanel } from './console.ts';
import { memoryPanel } from './memory.ts';
import { screenPanel } from './screen.ts';
import { csrPanel } from './csrs.ts';
import { statsPanel } from './stats.ts';
import { problemsPanel } from './problems.ts';
import { hoverFor, hintFor } from './hover.ts';
import { controls, statusPill } from './toolbar.ts';
import { MMIO_BASE, FB_BASE } from '../sim/memmap.ts';

type Tab = 'console' | 'memory' | 'screen' | 'csr' | 'stats' | 'problems';

export function mount(el: HTMLElement): void {
  const m = session.machine;
  const showListing = signal<boolean>(loadJSON('listing', true));
  const showDatapath = signal<boolean>(loadJSON('lab-datapath', true));
  showListing.subscribe(v => saveJSON('listing', v));
  showDatapath.subscribe(v => saveJSON('lab-datapath', v));

  // import shared program from URL
  const code = route.peek().query.get('code');
  if (code) {
    decodeProgram(code).then(src => { setSource(src); toast('Loaded shared program'); navigate('/lab'); }).catch(() => toast('Could not decode shared program'));
  }

  // ------------------------------------------------------------ editor
  let editor: EditorHandle | null = null;
  const pcLine = () => {
    session.tick.track();
    const r = session.loaded.value;
    if (!r) return null;
    return r.addrToLine.get(m.pc) ?? null;
  };
  editor = createEditor({
    value: session.source,
    diagnostics: () => session.asm.value?.diagnostics ?? [],
    pcLine,
    breakpoints: () => session.breakpoints.value,
    onToggleBreakpoint: toggleBreakpoint,
    labels: () => [...(session.asm.value?.symbols.keys() ?? [])],
    listing: () => {
      if (!showListing.value) return null;
      const r = session.asm.value;
      if (!r) return new Map();
      const map = new Map<number, { addr: string; code: string }>();
      for (const l of r.listing) {
        if (map.has(l.line)) continue;
        const codeStr = l.isData
          ? (l.size <= 4 ? l.words.map(w => (w >>> 0).toString(16)).join(' ') : `${l.size} bytes`)
          : (l.words[0] >>> 0).toString(16).padStart(8, '0') + (l.words.length > 1 ? ` +${l.words.length - 1}` : '');
        map.set(l.line, { addr: (l.addr >>> 0).toString(16).padStart(8, '0'), code: codeStr });
      }
      return map;
    },
    hover: hoverFor,
    hint: hintFor,
  });

  const errBanner = h('div', { class: 'err-banner hidden', role: 'alert' });
  effect(() => {
    session.tick.track();
    const show = m.status === 'error' || m.status === 'halted';
    errBanner.classList.toggle('hidden', !show);
    errBanner.classList.toggle('ok', m.status === 'halted');
    if (show) errBanner.replaceChildren(icon(m.status === 'error' ? 'alert' : 'check'), h('span', null, m.message + (m.status === 'error' ? ` at ${hex(m.pc)}` : '')));
  });

  const exampleSel = h('select', { class: 'select', 'aria-label': 'Load example' });
  const fillExamples = () => {
    const prev = previousSource();
    exampleSel.replaceChildren(h('option', { value: '' }, 'Examples…'),
      ...EXAMPLES.map(e => h('option', { value: e.id, title: e.description }, e.title)),
      ...(prev && prev !== session.source.peek() ? [h('option', { value: '__prev' }, '↺ Restore previous program')] : []));
  };
  fillExamples();
  exampleSel.addEventListener('focus', fillExamples);
  exampleSel.addEventListener('pointerdown', fillExamples);
  exampleSel.addEventListener('change', () => {
    const v = exampleSel.value;
    exampleSel.value = '';
    if (v === '__prev') {
      const prev = previousSource();
      if (!prev) return;
      backupSource();
      setSource(prev);
      toast('Restored your previous program');
      return;
    }
    const ex = EXAMPLES.find(e => e.id === v);
    if (!ex) return;
    backupSource();
    setSource(ex.source, ex.id);
    toast(`Loaded “${ex.title}”`);
  });

  const listingBtn = h('button', { class: 'btn small ghost', title: 'Show addresses and machine code next to each line' }, icon('list'), 'Listing');
  listingBtn.addEventListener('click', () => { showListing.value = !showListing.value; });
  effect(() => listingBtn.classList.toggle('on', showListing.value));

  const shareBtn = h('button', { class: 'btn small ghost', title: 'Copy a link to this program' }, icon('share'), 'Share');
  shareBtn.addEventListener('click', async () => {
    const enc = await encodeProgram(session.source.peek());
    const url = `${location.origin}${location.pathname}#/lab?code=${enc}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard'); }
    catch { prompt('Copy this link:', url); }
  });

  const editorPanel = h('section', { class: 'panel editor-panel' },
    h('div', { class: 'panel-head' }, icon('code'), 'Program', h('span', { class: 'spacer' }), listingBtn, shareBtn, exampleSel),
    errBanner,
    h('div', { class: 'panel-body ed-host' }, editor.el));

  // ------------------------------------------------------------ inspector tabs
  const tab = signal<Tab>(loadJSON('lab-tab', 'console'));
  tab.subscribe(t => saveJSON('lab-tab', t));
  const tabDefs: [Tab, string][] = [['console', 'Console'], ['screen', 'Screen'], ['memory', 'Memory'], ['csr', 'CSRs'], ['stats', 'Stats'], ['problems', 'Problems']];
  const bodies: Record<Tab, HTMLElement> = {
    console: consolePanel(), memory: memoryPanel(), screen: screenPanel(), csr: csrPanel(), stats: statsPanel(), problems: problemsPanel(() => editor),
  };
  const tabBtns = tabDefs.map(([t, l]) => {
    const b = h('button', { role: 'tab' }, l);
    b.addEventListener('click', () => { tab.value = t; userPicked = true; });
    return [t, b] as const;
  });
  const probCount = h('span', { class: 'badge hidden' });
  tabBtns.find(x => x[0] === 'problems')![1].append(probCount);
  effect(() => {
    const t = tab.value;
    for (const [k, b] of tabBtns) b.classList.toggle('on', k === t);
    for (const [k, b] of Object.entries(bodies)) b.classList.toggle('hidden', k !== t);
  });
  effect(() => {
    const n = session.asm.value?.diagnostics.filter(d => d.severity === 'error').length ?? 0;
    probCount.textContent = String(n);
    probCount.classList.toggle('hidden', !n);
  });
  // Auto-switch to the screen or console the first time a program uses them.
  let userPicked = false;
  let sawFb = false, sawOut = false;
  effect(() => {
    session.tick.track();
    if (m.instret === 0) { sawFb = false; sawOut = false; userPicked = false; return; }
    const w = m.lastMemWrite;
    if (!sawFb && w && w.addr >= FB_BASE && w.addr < MMIO_BASE) { sawFb = true; if (!userPicked) tab.value = 'screen'; }
    if (!sawOut && m.consoleOut && !sawFb) { sawOut = true; if (!userPicked) tab.value = 'console'; }
  });

  const inspector = h('div', { class: 'inspector' },
    registersPanel(),
    h('section', { class: 'panel tabs-panel' },
      h('div', { class: 'tabs', role: 'tablist' }, tabBtns.map(x => x[1])),
      h('div', { class: 'panel-body' }, Object.values(bodies))));

  // ------------------------------------------------------------ datapath dock
  const dpHost = h('section', { class: 'panel dp-panel' });
  const dpBtn = h('button', { class: 'btn small ghost', title: 'Show the CPU datapath next to the code' }, icon('cpu'), 'Datapath');
  dpBtn.addEventListener('click', () => { showDatapath.value = !showDatapath.value; });
  // ------------------------------------------------------------ layout
  const splitL = h('div', { class: 'splitter', 'data-var': '--ed-w', title: 'Drag to resize' });
  const splitR = h('div', { class: 'splitter', 'data-var': '--insp-w', title: 'Drag to resize' });
  const main = h('div', { class: 'lab-main' }, editorPanel, splitL, dpHost, splitR, inspector);
  let dpMounted = false;
  effect(() => {
    const on = showDatapath.value;
    dpBtn.classList.toggle('on', on);
    dpHost.classList.toggle('hidden', !on);
    main.classList.toggle('with-dp', on);
    if (on && !dpMounted) {
      dpMounted = true;
      import('../viz/panel.ts').then(mod => mod.mountDatapathPanel(dpHost, { docked: true }));
    }
  });

  const sizes = loadJSON<Record<string, string>>('lab-sizes', {});
  for (const [k, v] of Object.entries(sizes)) main.style.setProperty(k, v);
  for (const sp of [splitL, splitR]) {
    sp.addEventListener('pointerdown', e => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      const v = sp.dataset.var!;
      const rect = main.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const px = v === '--ed-w' ? ev.clientX - rect.left : rect.right - ev.clientX;
        const clamped = Math.max(280, Math.min(rect.width * 0.7, px));
        main.style.setProperty(v, clamped + 'px');
      };
      const up = () => {
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', up);
        sizes[v] = main.style.getPropertyValue(v);
        saveJSON('lab-sizes', sizes);
        window.dispatchEvent(new Event('resize'));
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
  }

  // mobile tabs
  const mview = signal<'code' | 'cpu' | 'state'>('code');
  const mtabs = h('div', { class: 'mobile-tabs tabs' }, ...(['code', 'cpu', 'state'] as const).map(k => {
    const b = h('button', null, k === 'code' ? 'Code' : k === 'cpu' ? 'Datapath' : 'State');
    b.addEventListener('click', () => { mview.value = k; if (k === 'cpu') showDatapath.value = true; });
    effect(() => b.classList.toggle('on', mview.value === k));
    return b;
  }));
  effect(() => { main.dataset.mview = mview.value; });

  const toolbar = h('div', { class: 'lab-toolbar' }, controls(), h('div', { class: 'tb-spacer' }), statusPill(), dpBtn);
  el.append(h('div', { class: 'lab' }, toolbar, mtabs, main));

  listen(window, 'keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); toast('Saved in this browser'); }
  });
}
