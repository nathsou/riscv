/** Memory viewer: hex + ASCII dump with follow modes and change highlighting. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import { hex } from '../isa/bits.ts';
import { DATA_BASE, FB_BASE, MMIO_BASE } from '../sim/memmap.ts';

type Follow = 'none' | 'sp' | 'pc' | 'data' | 'last';

export function memoryPanel(): HTMLElement {
  const m = session.machine;
  let base = DATA_BASE;
  let follow: Follow = 'last';
  let words = false;
  const ROW = 16;
  const addrIn = h('input', { class: 'input tiny mono', value: hex(base), 'aria-label': 'Address', style: 'width: 110px' });
  const followSel = h('select', { class: 'select tiny', 'aria-label': 'Follow' },
    h('option', { value: 'last' }, 'follow writes'), h('option', { value: 'sp' }, 'follow sp'),
    h('option', { value: 'pc' }, 'follow pc'), h('option', { value: 'data' }, '.data'), h('option', { value: 'none' }, 'fixed'));
  const wordsBtn = h('button', { class: 'btn small ghost', title: 'Toggle byte / word view' }, 'bytes');
  const grid = h('div', { class: 'memgrid mono' });
  const body = h('div', { class: 'mem-body' }, grid);

  addrIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const s = addrIn.value.trim();
    const sym = session.loaded.peek()?.symbols.get(s);
    const v = sym ? sym.value : parseInt(s, s.startsWith('0x') || /[a-f]/i.test(s) ? 16 : 10);
    if (!Number.isNaN(v)) { base = (v >>> 0) & ~15; follow = 'none'; followSel.value = 'none'; render(); }
  });
  followSel.addEventListener('change', () => {
    follow = followSel.value as Follow;
    if (follow === 'data') { base = DATA_BASE; follow = 'none'; }
    render();
  });
  wordsBtn.addEventListener('click', () => { words = !words; wordsBtn.textContent = words ? 'words' : 'bytes'; render(); });
  body.addEventListener('wheel', e => {
    e.preventDefault();
    base = (base + Math.sign(e.deltaY) * ROW * 2) >>> 0;
    follow = 'none';
    followSel.value = 'none';
    render();
  }, { passive: false });

  function rows(): number { return Math.max(4, Math.floor((body.clientHeight - 8) / 19)); }

  function render() {
    const n = rows();
    const lw = m.lastMemWrite;
    if (follow === 'sp') base = ((m.x[2] >>> 0) & ~15) - ROW * 2;
    else if (follow === 'pc') base = ((m.pc >>> 0) & ~15) - ROW * 2;
    else if (follow === 'last' && lw && lw.addr < MMIO_BASE && !(lw.addr >= base && lw.addr < base + n * ROW)) base = ((lw.addr & ~15) - ROW * Math.floor(n / 3)) >>> 0;
    base >>>= 0;
    addrIn.value = document.activeElement === addrIn ? addrIn.value : hex(base);
    const sp = m.x[2] >>> 0;
    const symAt = new Map<number, string>();
    const r = session.loaded.peek();
    if (r) for (const s of r.symbols.values()) if (s.kind === 'label') symAt.set(s.value, s.name);
    let html = '';
    for (let row = 0; row < n; row++) {
      const a = (base + row * ROW) >>> 0;
      if (a >= MMIO_BASE) break;
      html += `<div class="mr"><span class="ma${a === (sp & ~15) ? ' sp' : ''}">${hex(a)}</span><span class="mb">`;
      let ascii = '';
      if (words) {
        for (let k = 0; k < ROW; k += 4) {
          const wa = a + k;
          const v = m.mem.read32(wa);
          const cls = (lw && wa <= lw.addr && lw.addr < wa + 4 ? ' w' : '') + (wa === sp ? ' spc' : '') + (symAt.has(wa) ? ' sym' : '');
          html += `<span class="mw${cls}"${symAt.has(wa) ? ` title="${symAt.get(wa)}"` : ''}>${(v >>> 0).toString(16).padStart(8, '0')}</span>`;
        }
      } else {
        for (let k = 0; k < ROW; k++) {
          const ba = a + k;
          const v = m.mem.read8(ba);
          const cls = (lw && ba >= lw.addr && ba < lw.addr + lw.w ? ' w' : '') + (v === 0 ? ' z' : '') + (ba === sp ? ' spc' : '') + (symAt.has(ba) ? ' sym' : '') + (k === 8 ? ' gap' : '');
          html += `<span class="mx${cls}"${symAt.has(ba) ? ` title="${symAt.get(ba)}"` : ''}>${v.toString(16).padStart(2, '0')}</span>`;
          ascii += v >= 32 && v < 127 ? String.fromCharCode(v).replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`) : '·';
        }
      }
      html += `</span>${words ? '' : `<span class="mc">${ascii}</span>`}</div>`;
    }
    grid.innerHTML = html;
  }

  effect(() => { session.tick.track(); render(); });
  new ResizeObserver(() => render()).observe(body);

  return h('div', { class: 'mem' },
    h('div', { class: 'mem-bar' }, addrIn, followSel, wordsBtn,
      h('button', { class: 'btn small ghost', onclick: () => { base = (m.x[2] >>> 0) & ~15; follow = 'none'; followSel.value = 'none'; render(); } }, 'sp'),
      h('button', { class: 'btn small ghost', onclick: () => { base = FB_BASE; follow = 'none'; followSel.value = 'none'; render(); } }, 'fb')),
    body);
}
