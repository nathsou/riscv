/**
 * A dependency-free code editor: a transparent <textarea> layered exactly
 * over a syntax-highlighted <pre>. The textarea keeps native caret, IME,
 * selection, accessibility and undo; everything else is drawn around it.
 */
import { h } from '../ui/h.ts';
import { effect, listen, onCleanup } from '../ui/reactive.ts';
import type { Signal } from '../ui/reactive.ts';
import type { Diagnostic } from '../asm/diagnostics.ts';
import { highlightLine } from './highlight.ts';
import type { ClassifiedToken, HighlightedLine } from './highlight.ts';
import { Completer } from './completion.ts';

export interface EditorOptions {
  value: Signal<string>;
  diagnostics: () => Diagnostic[];
  /** Line currently executing (0-based) or null. */
  pcLine: () => number | null;
  breakpoints: () => Set<number>;
  onToggleBreakpoint: (line: number) => void;
  /** Optional per-line listing text (address / machine code). */
  listing?: () => Map<number, { addr: string; code: string }> | null;
  /** Labels known to the assembler (for completion). */
  labels: () => string[];
  /** Hover content for a token, or null. */
  hover?: (tok: ClassifiedToken, line: number) => HTMLElement | null;
  /** Hint for the status bar given the caret line text. */
  hint?: (lineText: string, col: number) => string;
  readOnly?: boolean;
}

export interface EditorHandle {
  el: HTMLElement;
  textarea: HTMLTextAreaElement;
  focus(): void;
  revealLine(line: number): void;
  setSelection(line: number, from: number, to?: number): void;
}

const LH = 20;
const PAD_Y = 10;
const PAD_X = 12;

let charW = 0;
function measureChar(font: string): number {
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = font;
  return c.measureText('0123456789abcdefghij').width / 20;
}

export function createEditor(o: EditorOptions): EditorHandle {
  const ta = h('textarea', {
    class: 'ed-ta', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off',
    'aria-label': 'Assembly source', readOnly: o.readOnly ?? false,
  });
  const pre = h('pre', { class: 'ed-hl', 'aria-hidden': 'true' });
  const marks = h('div', { class: 'ed-marks', 'aria-hidden': 'true' });
  const lines = h('div', { class: 'ed-linebg', 'aria-hidden': 'true' });
  const gutter = h('div', { class: 'ed-gutter' });
  const listCol = h('div', { class: 'ed-listing', 'aria-hidden': 'true' });
  const code = h('div', { class: 'ed-code' }, lines, pre, marks, ta);
  const inner = h('div', { class: 'ed-inner' }, gutter, listCol, code);
  const scroller = h('div', { class: 'ed-scroll' }, inner);
  const status = h('div', { class: 'ed-status' });
  const root = h('div', { class: 'ed' }, scroller, status);
  const completer = new Completer(root, ta, () => o.labels());

  let lineCache: { text: string; inBlock: boolean; hl: HighlightedLine }[] = [];
  let lineCount = 0;

  function font() {
    const cs = getComputedStyle(ta);
    return `${cs.fontSize} ${cs.fontFamily}`;
  }

  function render() {
    const text = ta.value;
    const ls = text.split('\n');
    lineCount = ls.length;
    let inBlock = false;
    let html = '';
    let maxLen = 0;
    const cache: typeof lineCache = [];
    for (let i = 0; i < ls.length; i++) {
      const t = ls[i];
      const prev = lineCache[i];
      const hl: HighlightedLine = prev && prev.text === t && prev.inBlock === inBlock ? prev.hl : highlightLine(t, inBlock);
      cache.push({ text: t, inBlock, hl });
      inBlock = hl.inBlockAfter;
      html += `<div class="ed-l">${hl.html || ' '}</div>`;
      if (t.length > maxLen) maxLen = t.length;
    }
    lineCache = cache;
    pre.innerHTML = html;
    if (!charW) charW = measureChar(font()) || 7.8;
    const w = Math.max(scroller.clientWidth - gutter.offsetWidth - listCol.offsetWidth, Math.ceil(maxLen * charW + PAD_X * 2 + 40));
    const hgt = lineCount * LH + PAD_Y * 2;
    code.style.width = w + 'px';
    code.style.height = Math.max(hgt, scroller.clientHeight) + 'px';
    renderGutter();
    renderMarks();
    renderListing();
  }

  function renderGutter() {
    const bps = o.breakpoints();
    const pc = o.pcLine();
    const diags = o.diagnostics();
    const errLines = new Set(diags.filter(d => d.severity === 'error').map(d => d.line));
    const warnLines = new Set(diags.filter(d => d.severity === 'warning').map(d => d.line));
    let html = '';
    for (let i = 0; i < lineCount; i++) {
      const cls = ['ed-gl'];
      if (bps.has(i)) cls.push('bp');
      if (i === pc) cls.push('pc');
      if (errLines.has(i)) cls.push('err');
      else if (warnLines.has(i)) cls.push('warn');
      html += `<div class="${cls.join(' ')}" data-line="${i}"><span class="n">${i + 1}</span></div>`;
    }
    gutter.innerHTML = html;
    gutter.style.height = (lineCount * LH + PAD_Y * 2) + 'px';
  }

  function renderListing() {
    const l = o.listing?.();
    listCol.classList.toggle('hidden', !l);
    if (!l) return;
    let html = '';
    for (let i = 0; i < lineCount; i++) {
      const e = l.get(i);
      html += e ? `<div class="ed-li"><span class="a">${e.addr}</span> <span class="c">${e.code}</span></div>` : '<div class="ed-li"></div>';
    }
    listCol.innerHTML = html;
  }

  function renderMarks() {
    let html = '';
    for (const d of o.diagnostics()) {
      if (d.line >= lineCount) continue;
      const from = d.from, to = Math.max(d.to, d.from + 1);
      html += `<div class="ed-sq ${d.severity}" style="top:${PAD_Y + d.line * LH + LH - 4}px;left:${PAD_X + from * charW}px;width:${(to - from) * charW}px"></div>`;
    }
    marks.innerHTML = html;
    let bg = '';
    const pc = o.pcLine();
    if (pc !== null && pc < lineCount) bg += `<div class="ed-pcline" style="top:${PAD_Y + pc * LH}px"></div>`;
    for (const b of o.breakpoints()) if (b < lineCount) bg += `<div class="ed-bpline" style="top:${PAD_Y + b * LH}px"></div>`;
    const cur = caretLine();
    bg += `<div class="ed-curline" style="top:${PAD_Y + cur * LH}px"></div>`;
    lines.innerHTML = bg;
  }

  function caretLine(): number {
    const upto = ta.value.slice(0, ta.selectionStart);
    let n = 0;
    for (let i = 0; i < upto.length; i++) if (upto.charCodeAt(i) === 10) n++;
    return n;
  }

  function caretPos(): { line: number; col: number } {
    const upto = ta.value.slice(0, ta.selectionStart);
    const nl = upto.lastIndexOf('\n');
    return { line: caretLine(), col: upto.length - nl - 1 };
  }

  function ensureVisible(line: number, col: number) {
    const y = PAD_Y + line * LH;
    if (y < scroller.scrollTop) scroller.scrollTop = y - LH;
    else if (y + LH > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + 2 * LH - scroller.clientHeight;
    const gw = gutter.offsetWidth + listCol.offsetWidth;
    const x = PAD_X + col * charW;
    const viewW = scroller.clientWidth - gw;
    if (x < scroller.scrollLeft + 20) scroller.scrollLeft = Math.max(0, x - 40);
    else if (x > scroller.scrollLeft + viewW - 30) scroller.scrollLeft = x - viewW + 60;
  }

  function updateStatus() {
    const { line, col } = caretPos();
    const text = ta.value.split('\n')[line] ?? '';
    const hint = o.hint?.(text, col) ?? '';
    status.innerHTML = '';
    status.append(h('span', { class: 'hint', html: hint }), h('span', { class: 'pos' }, `Ln ${line + 1}, Col ${col + 1}`));
  }

  function onCaret() {
    const { line, col } = caretPos();
    ensureVisible(line, col);
    renderMarks();
    updateStatus();
  }

  // ------------------------------------------------------------ editing helpers
  function insert(text: string) {
    // execCommand keeps the edit on the native undo stack.
    if (!document.execCommand('insertText', false, text)) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.setRangeText(text, s, e, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }

  function selectedLineRange(): [number, number] {
    const v = ta.value;
    const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let e = v.indexOf('\n', Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0), ta.selectionStart));
    if (e < 0) e = v.length;
    return [s, e];
  }

  function toggleComment() {
    const [s, e] = selectedLineRange();
    const block = ta.value.slice(s, e);
    const ls = block.split('\n');
    const all = ls.filter(l => l.trim()).every(l => /^\s*#/.test(l));
    const out = ls.map(l => {
      if (!l.trim()) return l;
      return all ? l.replace(/^(\s*)# ?/, '$1') : l.replace(/^(\s*)/, '$1# ');
    }).join('\n');
    ta.setSelectionRange(s, e);
    insert(out);
    ta.setSelectionRange(s, s + out.length);
  }

  listen(ta, 'keydown', e => {
    if (completer.handleKey(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) {
        const [s, en] = selectedLineRange();
        const block = ta.value.slice(s, en);
        const out = e.shiftKey ? block.replace(/^( {1,8}|\t)/gm, '') : block.replace(/^/gm, '        ');
        ta.setSelectionRange(s, en);
        insert(out);
        ta.setSelectionRange(s, s + out.length);
        return;
      }
      if (e.shiftKey) return;
      const { col } = caretPos();
      insert(' '.repeat(8 - (col % 8)));
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const v = ta.value;
      const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const cur = v.slice(ls, ta.selectionStart);
      let indent = /^\s*/.exec(cur)![0];
      if (/^\s*[\w.$]+:\s*$/.test(cur)) indent = '        ';
      else if (/^[\w.$]+:\s+\S/.test(cur)) indent = '        ';
      insert('\n' + indent);
      return;
    }
    if (mod && e.key === '/') { e.preventDefault(); toggleComment(); return; }
  });

  listen(ta, 'input', e => {
    o.value.value = ta.value;
    render();
    onCaret();
    const ie = e as InputEvent;
    if (ie.inputType === 'insertText' && ie.data && /[\w.%]/.test(ie.data)) completer.update(caretPos());
    else if (ie.inputType?.startsWith('delete')) completer.update(caretPos(), true);
    else completer.close();
  });

  listen(ta, 'keyup', e => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) onCaret(); });
  listen(ta, 'mouseup', () => onCaret());
  listen(ta, 'blur', () => setTimeout(() => completer.close(), 150));
  listen(ta, 'scroll', () => { ta.scrollTop = 0; ta.scrollLeft = 0; });

  listen(gutter, 'mousedown', e => {
    const t = (e.target as HTMLElement).closest('.ed-gl') as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    o.onToggleBreakpoint(Number(t.dataset.line));
  });

  // ------------------------------------------------------------ hover
  const tip = h('div', { class: 'tooltip ed-tip' });
  document.body.append(tip);
  let hoverTimer = 0;
  let hoverKey = '';
  const hideTip = () => { tip.classList.remove('show'); hoverKey = ''; };
  listen(ta, 'mousemove', e => {
    clearTimeout(hoverTimer);
    if (!o.hover) return;
    const r = code.getBoundingClientRect();
    const line = Math.floor((e.clientY - r.top - PAD_Y) / LH);
    const col = Math.floor((e.clientX - r.left - PAD_X) / charW);
    const tok = lineCache[line]?.hl.tokens.find(t => col >= t.start && col < t.end && t.cls !== 'ws');
    const key = tok ? `${line}:${tok.start}` : '';
    if (key !== hoverKey) hideTip();
    if (!tok) return;
    hoverTimer = window.setTimeout(() => {
      const content = o.hover!(tok, line);
      if (!content) return;
      hoverKey = key;
      tip.replaceChildren(content);
      const x = r.left + PAD_X + tok.start * charW;
      const y = r.top + PAD_Y + (line + 1) * LH + 4;
      tip.style.left = Math.min(x, window.innerWidth - 440) + 'px';
      tip.style.top = y + 'px';
      tip.classList.add('show');
      const tr = tip.getBoundingClientRect();
      if (tr.bottom > window.innerHeight - 8) tip.style.top = (r.top + PAD_Y + line * LH - tr.height - 4) + 'px';
    }, 380);
  });
  listen(ta, 'mouseleave', () => { clearTimeout(hoverTimer); hideTip(); });
  listen(ta, 'keydown', () => hideTip());

  // ------------------------------------------------------------ reactive wiring
  ta.value = o.value.peek();
  effect(() => {
    const v = o.value.value;
    if (v !== ta.value) { ta.value = v; lineCache = []; }
    render();
  });
  effect(() => { o.diagnostics(); o.breakpoints(); renderGutter(); renderMarks(); });
  effect(() => {
    const pc = o.pcLine();
    renderGutter();
    renderMarks();
    if (pc !== null) {
      const y = PAD_Y + pc * LH;
      if (y < scroller.scrollTop || y + LH > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y - scroller.clientHeight / 3;
    }
  });
  effect(() => { o.listing?.(); renderListing(); render(); });

  const ro = new ResizeObserver(() => render());
  ro.observe(scroller);
  queueMicrotask(() => { charW = measureChar(font()) || charW; render(); updateStatus(); });

  const handle: EditorHandle = {
    el: root,
    textarea: ta,
    focus: () => ta.focus(),
    revealLine(line) { ensureVisible(line, 0); },
    setSelection(line, from, to = from) {
      const ls = ta.value.split('\n');
      let off = 0;
      for (let i = 0; i < line && i < ls.length; i++) off += ls[i].length + 1;
      ta.focus();
      ta.setSelectionRange(off + from, off + to);
      onCaret();
    },
  };
  onCleanup(() => { ro.disconnect(); tip.remove(); completer.destroy(); });
  return handle;
}

export { LH as LINE_HEIGHT };
