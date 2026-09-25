/** Autocomplete popup for mnemonics, directives, registers, labels and CSRs. */
import { h } from '../ui/h.ts';
import { INSTRUCTIONS } from '../isa/spec/index.ts';
import { PSEUDOS, DIRECTIVES } from '../asm/pseudo.ts';
import { ABI_NAMES } from '../isa/regs.ts';
import { CSRS } from '../isa/csr.ts';
import { syntaxOf } from '../asm/assembler.ts';

interface Item { label: string; detail: string; kind: 'mn' | 'ps' | 'dir' | 'reg' | 'lab' | 'csr' | 'rel' }

const MNEMONICS: Item[] = [
  ...INSTRUCTIONS.map(i => ({ label: i.mnemonic, detail: `${syntaxOf(i)} — ${i.summary}`, kind: 'mn' as const })),
  ...PSEUDOS.filter(p => /^[a-z.]+$/.test(p.name)).map(p => ({ label: p.name, detail: `${p.syntax.replace(/^\S+\s*/, '')} — ${p.description}`, kind: 'ps' as const })),
];
const DIRS: Item[] = DIRECTIVES.map(d => ({ label: d.name, detail: d.description, kind: 'dir' }));
const REGS: Item[] = [
  ...ABI_NAMES.map((n, i) => ({ label: n, detail: `x${i}`, kind: 'reg' as const })),
  ...Array.from({ length: 32 }, (_, i) => ({ label: 'x' + i, detail: ABI_NAMES[i], kind: 'reg' as const })),
];
const CSR_ITEMS: Item[] = CSRS.map(c => ({ label: c.name, detail: c.description, kind: 'csr' }));
const RELOCS: Item[] = ['%hi', '%lo', '%pcrel_hi', '%pcrel_lo'].map(r => ({ label: r, detail: 'relocation', kind: 'rel' }));

const LH = 20, PAD_Y = 10, PAD_X = 12;

export class Completer {
  private el: HTMLElement;
  private items: Item[] = [];
  private sel = 0;
  private prefixStart = 0;
  private open = false;
  private host: HTMLElement;
  private ta: HTMLTextAreaElement;
  private labels: () => string[];

  constructor(host: HTMLElement, ta: HTMLTextAreaElement, labels: () => string[]) {
    this.host = host;
    this.ta = ta;
    this.labels = labels;
    this.el = h('div', { class: 'ed-complete hidden', role: 'listbox' });
    this.el.addEventListener('mousedown', e => {
      const li = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (!li) return;
      e.preventDefault();
      this.sel = Number(li.dataset.i);
      this.accept();
    });
    document.body.append(this.el);
  }

  destroy() { this.el.remove(); }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  update(pos: { line: number; col: number }, onlyIfOpen = false) {
    if (onlyIfOpen && !this.open) return;
    const v = this.ta.value;
    const caret = this.ta.selectionStart;
    const lineStart = v.lastIndexOf('\n', caret - 1) + 1;
    const before = v.slice(lineStart, caret);
    const m = /[%\w.$]*$/.exec(before)!;
    const prefix = m[0];
    if (!prefix || /^\d/.test(prefix) || /#/.test(before)) { this.close(); return; }
    this.prefixStart = caret - prefix.length;
    const head = before.slice(0, before.length - prefix.length);
    const isHead = /^\s*([\w.$]+:\s*)*$/.test(head);
    const headMn = /^\s*(?:[\w.$]+:\s*)*([\w.]+)\s/.exec(before)?.[1]?.toLowerCase() ?? '';
    let pool: Item[];
    if (prefix.startsWith('%')) pool = RELOCS;
    else if (isHead) pool = prefix.startsWith('.') ? DIRS : MNEMONICS;
    else {
      pool = [...REGS, ...this.labels().map(l => ({ label: l, detail: 'label', kind: 'lab' as const }))];
      if (headMn.startsWith('csr')) pool = [...CSR_ITEMS, ...pool];
    }
    const p = prefix.toLowerCase();
    const starts = pool.filter(i => i.label.toLowerCase().startsWith(p) && i.label.toLowerCase() !== p);
    const incl = pool.filter(i => !i.label.toLowerCase().startsWith(p) && i.label.toLowerCase().includes(p) && p.length > 1);
    const seen = new Set<string>();
    this.items = [...starts, ...incl].filter(i => !seen.has(i.label) && seen.add(i.label)).slice(0, 12);
    if (!this.items.length) { this.close(); return; }
    this.sel = 0;
    this.open = true;
    this.render(pos, prefix.length);
  }

  private render(pos: { line: number; col: number }, plen: number) {
    this.el.innerHTML = '';
    this.items.forEach((it, i) => {
      this.el.append(h('div', { class: `ci ${i === this.sel ? 'on' : ''}`, 'data-i': String(i), role: 'option' },
        h('span', { class: `ck k-${it.kind}` }, it.kind === 'mn' ? 'I' : it.kind === 'ps' ? 'P' : it.kind === 'dir' ? '.' : it.kind === 'reg' ? 'R' : it.kind === 'csr' ? 'C' : it.kind === 'rel' ? '%' : 'L'),
        h('span', { class: 'cl' }, it.label),
        h('span', { class: 'cd' }, it.detail)));
    });
    const code = this.host.querySelector('.ed-code') as HTMLElement;
    const r = code.getBoundingClientRect();
    const cw = (this.host.querySelector('.ed-hl .ed-l') as HTMLElement | null)?.getBoundingClientRect().width ? measure(this.ta) : 7.8;
    this.el.style.left = Math.min(r.left + PAD_X + (pos.col - plen) * cw - 30, window.innerWidth - 480) + 'px';
    this.el.style.top = (r.top + PAD_Y + (pos.line + 1) * LH + 2) + 'px';
    this.el.classList.remove('hidden');
    const er = this.el.getBoundingClientRect();
    if (er.bottom > window.innerHeight) this.el.style.top = (r.top + PAD_Y + pos.line * LH - er.height - 2) + 'px';
  }

  private accept() {
    const it = this.items[this.sel];
    if (!it) return;
    this.ta.focus();
    this.ta.setSelectionRange(this.prefixStart, this.ta.selectionStart);
    let text = it.label;
    if (it.kind === 'mn' || it.kind === 'ps') text += ' ';
    if (it.kind === 'dir') text += ' ';
    document.execCommand('insertText', false, text);
    this.close();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : this.items.length - 1)) % this.items.length;
      [...this.el.children].forEach((c, i) => c.classList.toggle('on', i === this.sel));
      (this.el.children[this.sel] as HTMLElement).scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.accept(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }
}

let cached = 0;
function measure(ta: HTMLTextAreaElement): number {
  if (cached) return cached;
  const cs = getComputedStyle(ta);
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `${cs.fontSize} ${cs.fontFamily}`;
  cached = c.measureText('0123456789').width / 10;
  return cached;
}
