/** Syntax classification on top of the assembler's own lexer. */
import { lexLine } from '../asm/lexer.ts';
import type { Token } from '../asm/lexer.ts';
import { BY_MNEMONIC } from '../isa/spec/index.ts';
import { REG_NAME_SET } from '../isa/regs.ts';
import { PSEUDO_NAMES } from '../asm/pseudo.ts';
import { CSR_BY_NAME } from '../isa/csr.ts';

export type TokClass =
  | 'mn' | 'ps' | 'reg' | 'num' | 'str' | 'com' | 'lab' | 'dir' | 'sym' | 'rel' | 'err' | 'p' | 'ws' | 'csr' | 'unk';

export interface ClassifiedToken extends Token { cls: TokClass }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function classify(tokens: Token[]): ClassifiedToken[] {
  const out: ClassifiedToken[] = [];
  let seenHead = false;
  const sig = tokens.filter(t => t.kind !== 'ws' && t.kind !== 'comment');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let cls: TokClass;
    switch (t.kind) {
      case 'ws': cls = 'ws'; break;
      case 'comment': cls = 'com'; break;
      case 'number': case 'char': cls = 'num'; break;
      case 'string': cls = 'str'; break;
      case 'reloc': cls = 'rel'; break;
      case 'localref': cls = 'lab'; break;
      case 'error': cls = 'err'; break;
      case 'punct': cls = 'p'; break;
      default: {
        const si = sig.indexOf(t);
        const isLabelDef = sig[si + 1]?.kind === 'punct' && sig[si + 1].text === ':' && !seenHead;
        if (isLabelDef) { cls = 'lab'; break; }
        if (!seenHead) {
          seenHead = true;
          if (t.kind === 'directive') cls = 'dir';
          else {
            const m = t.text.toLowerCase();
            cls = BY_MNEMONIC.has(m) ? 'mn' : PSEUDO_NAMES.has(m) ? 'ps' : 'unk';
          }
          break;
        }
        const low = t.text.toLowerCase();
        if (REG_NAME_SET.has(low)) cls = 'reg';
        else if (CSR_BY_NAME.has(low)) cls = 'csr';
        else cls = 'sym';
      }
    }
    if (t.kind === 'number' && tokens[i + 1]?.text === ':' && !seenHead) cls = 'lab';
    out.push({ ...t, cls });
  }
  return out;
}

export interface HighlightedLine { html: string; tokens: ClassifiedToken[]; inBlockAfter: boolean }

export function highlightLine(line: string, inBlock: boolean): HighlightedLine {
  const r = lexLine(line, inBlock);
  const toks = classify(r.tokens);
  let html = '';
  let pos = 0;
  for (const t of toks) {
    if (t.start > pos) html += esc(line.slice(pos, t.start));
    html += t.cls === 'ws' ? t.text : `<span class="t-${t.cls}">${esc(t.text)}</span>`;
    pos = t.end;
  }
  if (pos < line.length) html += esc(line.slice(pos));
  return { html, tokens: toks, inBlockAfter: r.inBlock };
}
