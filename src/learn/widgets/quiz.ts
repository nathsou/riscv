/** "Predict, then reveal" questions. */
import { h } from '../../ui/h.ts';
import { icon } from '../../ui/icons.ts';
import { progress, recordQuiz } from '../progress.ts';

export interface QuizOpts { id: string; q: string; options: string[]; answer: number; explain: string }

export function quiz(o: QuizOpts): HTMLElement {
  const result = h('div', { class: 'quiz-result', 'aria-live': 'polite' });
  const buttons = o.options.map((opt, i) => {
    const b = h('button', { class: 'quiz-opt' }, h('span', { class: 'qk' }, String.fromCharCode(65 + i)), h('span', { class: 'qt', html: opt }));
    b.addEventListener('click', () => choose(i));
    return b;
  });
  function choose(i: number): void {
    const ok = i === o.answer;
    buttons.forEach((b, j) => {
      b.classList.toggle('right', j === o.answer);
      b.classList.toggle('wrong', j === i && !ok);
      b.disabled = true;
    });
    result.replaceChildren(h('div', { class: ok ? 'ok' : 'no' }, icon(ok ? 'check' : 'alert'), ok ? 'Correct.' : 'Not quite.'), h('p', { html: o.explain }));
    const again = h('button', { class: 'btn small ghost' }, 'Try again');
    again.addEventListener('click', () => { buttons.forEach(b => { b.disabled = false; b.classList.remove('right', 'wrong'); }); result.replaceChildren(); });
    if (!ok) result.append(again);
    recordQuiz(o.id, ok);
  }
  const done = progress.peek().quiz[o.id] === true;
  return h('div', { class: `quiz ${done ? 'done' : ''}` },
    h('div', { class: 'quiz-q' }, h('span', { class: 'quiz-badge' }, icon('sparkle'), 'Predict'), h('span', { html: o.q })),
    h('div', { class: 'quiz-opts' }, ...buttons), result);
}

export interface PredictOpts { id: string; q: string; answer: string; explain: string; normalize?: (s: string) => string; placeholder?: string }

/** Free-form answer (a number, a register value…). */
export function predict(o: PredictOpts): HTMLElement {
  const norm = o.normalize ?? ((s: string) => s.trim().toLowerCase().replace(/\s+/g, ''));
  const input = h('input', { class: 'input', placeholder: o.placeholder ?? 'your answer', 'aria-label': 'Answer' });
  const result = h('div', { class: 'quiz-result', 'aria-live': 'polite' });
  const check = h('button', { class: 'btn small' }, 'Check');
  const reveal = h('button', { class: 'btn small ghost' }, 'Reveal');
  const go = (show: boolean) => {
    const ok = norm(input.value) === norm(o.answer);
    if (!ok && !show) { result.replaceChildren(h('div', { class: 'no' }, icon('alert'), 'Not quite — try again, or reveal the answer.')); return; }
    result.replaceChildren(h('div', { class: ok ? 'ok' : 'rev' }, icon(ok ? 'check' : 'sparkle'), ok ? 'Correct.' : `Answer: ${o.answer}`), h('p', { html: o.explain }));
    recordQuiz(o.id, ok);
  };
  check.addEventListener('click', () => go(false));
  reveal.addEventListener('click', () => go(true));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(false); });
  return h('div', { class: 'quiz' },
    h('div', { class: 'quiz-q' }, h('span', { class: 'quiz-badge' }, icon('sparkle'), 'Predict'), h('span', { html: o.q })),
    h('div', { class: 'quiz-row' }, input, check, reveal), result);
}
