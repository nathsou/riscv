/** Syntax-highlighted, read-only assembly snippets. */
import { h } from '../ui/h.ts';
import { highlightLine } from '../editor/highlight.ts';

export function codeBlock(src: string): HTMLElement {
  let inBlock = false;
  const html = src.replace(/\n$/, '').split('\n').map(l => {
    const r = highlightLine(l, inBlock);
    inBlock = r.inBlockAfter;
    return r.html || ' ';
  }).join('\n');
  return h('pre', { class: 'code hl', html });
}
