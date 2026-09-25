/** Assembler diagnostics list. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import type { EditorHandle } from '../editor/editor.ts';

export function problemsPanel(editor: () => EditorHandle | null): HTMLElement {
  const list = h('div', { class: 'problems' });
  effect(() => {
    const r = session.asm.value;
    list.replaceChildren();
    if (!r) return;
    if (!r.diagnostics.length) {
      list.append(h('div', { class: 'ok-msg' }, `✓ Assembled: ${r.listing.filter(l => !l.isData).reduce((n, l) => n + l.words.length, 0)} instructions, ${r.sections.filter(s => s.name !== 'text').reduce((n, s) => n + s.size, 0)} bytes of data.`));
      return;
    }
    for (const d of r.diagnostics) {
      const row = h('button', { class: `prob ${d.severity}` },
        h('span', { class: 'sev' }, d.severity === 'error' ? '✖' : '⚠'),
        h('span', { class: 'msg' }, d.message),
        h('span', { class: 'loc faint mono' }, `${d.line + 1}:${d.from + 1}`));
      row.addEventListener('click', () => editor()?.setSelection(d.line, d.from, d.to));
      list.append(row);
    }
  });
  return list;
}
