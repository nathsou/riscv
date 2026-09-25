/** Console: program output and line input for the read syscalls / RX device. */
import { h } from '../ui/h.ts';
import { effect } from '../ui/reactive.ts';
import { session, play } from '../app/session.ts';

export function consolePanel(): HTMLElement {
  const m = session.machine;
  const out = h('pre', { class: 'console-out', 'aria-live': 'polite' });
  const input = h('input', { class: 'console-in mono', placeholder: 'Type input and press Enter…', 'aria-label': 'Console input', spellcheck: false });
  const wrap = h('div', { class: 'console' }, out, h('div', { class: 'console-line' }, h('span', { class: 'prompt' }, '›'), input));
  let last = '';
  let wasWaiting = false;

  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const resume = m.status === 'waiting';
    m.provideInput(input.value + '\n');
    input.value = '';
    session.tick.fire();
    if (resume && wasWaiting) play();
  });

  effect(() => {
    session.tick.track();
    if (m.consoleOut !== last) {
      const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
      last = m.consoleOut;
      out.textContent = last;
      if (stick) out.scrollTop = out.scrollHeight;
    }
    const waiting = m.status === 'waiting';
    wrap.classList.toggle('waiting', waiting);
    if (waiting && !wasWaiting) input.focus({ preventScroll: true });
    if (waiting) wasWaiting = true;
    if (session.running.value) wasWaiting = false;
  });
  return wrap;
}
