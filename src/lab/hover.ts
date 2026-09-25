/** Editor hover cards and status-bar hints, backed by the spec and live state. */
import { h } from '../ui/h.ts';
import type { ClassifiedToken } from '../editor/highlight.ts';
import { BY_MNEMONIC } from '../isa/spec/index.ts';
import { PSEUDOS } from '../asm/pseudo.ts';
import { syntaxOf } from '../asm/assembler.ts';
import { regIndex, REGS } from '../isa/regs.ts';
import { CSR_BY_NAME } from '../isa/csr.ts';
import { hex } from '../isa/bits.ts';
import { session } from '../app/session.ts';
import { bitfield } from '../ui/components/bitfield.ts';
import { decode } from '../isa/decode.ts';

export function hoverFor(tok: ClassifiedToken, line: number): HTMLElement | null {
  const m = session.machine;
  const r = session.asm.peek();
  const text = tok.text.toLowerCase();
  if (tok.cls === 'mn' || tok.cls === 'ps') {
    const spec = BY_MNEMONIC.get(text);
    const pseudo = PSEUDOS.find(p => p.name === text);
    const card = h('div', { class: 'hovercard' });
    if (spec) {
      card.append(h('h4', null, h('span', { class: 'mono' }, spec.mnemonic), ' — ', spec.summary),
        h('div', { class: 'mono faint' }, `${spec.mnemonic} ${syntaxOf(spec)}`),
        h('p', null, spec.description));
    } else if (pseudo) {
      card.append(h('h4', null, h('span', { class: 'mono' }, pseudo.name), ' — pseudo-instruction'),
        h('div', { class: 'mono faint' }, pseudo.syntax), h('p', null, pseudo.description),
        h('div', { class: 'mono faint' }, '→ ' + pseudo.expansion));
    }
    const entry = r?.listing.find(l => l.line === line && !l.isData);
    if (entry) {
      entry.words.forEach((w, i) => {
        const d = decode(w);
        if (!d) return;
        card.append(h('div', { class: 'hc-enc' }, h('div', { class: 'mono' }, `${hex(entry.addr + 4 * i)}: ${hex(w)}  ${entry.asm[i]}`), bitfield(d.spec, { word: w, compact: true })));
      });
    }
    return card;
  }
  if (tok.cls === 'reg') {
    const i = regIndex(text);
    const info = REGS[i];
    const v = m.x[i];
    return h('div', null, h('h4', null, `x${i} · ${info.abi}`), h('div', { class: 'faint' }, info.description),
      h('div', { class: 'tt-grid' }, h('span', null, 'hex'), h('span', null, hex(v)), h('span', null, 'dec'), h('span', null, String(v))));
  }
  if (tok.cls === 'csr') {
    const c = CSR_BY_NAME.get(text)!;
    return h('div', null, h('h4', null, `${c.name} (${hex(c.addr, 3)})`), h('div', { class: 'faint' }, c.description),
      h('div', { class: 'tt-grid' }, h('span', null, 'value'), h('span', null, hex(m.csrRead(c.addr)))));
  }
  if (tok.cls === 'sym' || tok.cls === 'lab') {
    const s = r?.symbols.get(tok.text);
    if (!s) return null;
    const word = m.mem.read32(s.value);
    return h('div', null, h('h4', null, h('span', { class: 'mono' }, s.name), ` · ${s.kind === 'equ' ? 'constant' : s.section ? '.' + s.section + ' label' : 'label'}`),
      h('div', { class: 'tt-grid' }, h('span', null, 'value'), h('span', null, `${hex(s.value)} (${s.value})`),
        s.kind === 'label' ? [h('span', null, 'word @'), h('span', null, hex(word))] : null,
        h('span', null, 'defined'), h('span', null, `line ${s.line + 1}`)));
  }
  if (tok.cls === 'num') {
    const v = typeof tok.value === 'number' ? tok.value : 0;
    return h('div', { class: 'tt-grid' }, h('span', null, 'dec'), h('span', null, String(v | 0)), h('span', null, 'hex'), h('span', null, hex(v)),
      h('span', null, 'bin'), h('span', null, (v >>> 0).toString(2)));
  }
  return null;
}

export function hintFor(lineText: string, col: number): string {
  void col;
  const m = /^\s*(?:[\w.$]+:\s*)*([\w.]+)/.exec(lineText.replace(/#.*/, ''));
  if (!m) return '';
  const mn = m[1].toLowerCase();
  const s = BY_MNEMONIC.get(mn);
  if (s) return `<b>${s.mnemonic}</b> ${syntaxOf(s)} — ${s.summary}`;
  const p = PSEUDOS.find(p => p.name === mn);
  if (p) return `<b>${p.name}</b> ${p.syntax.replace(/^\S+\s*/, '')} — ${p.description} <span class="faint">(→ ${p.expansion})</span>`;
  return '';
}
