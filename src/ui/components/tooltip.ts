/** A shared floating tooltip for hover explanations. */
import { h } from '../h.ts';

let el: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (!el) {
    el = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(el);
  }
  return el;
}

export function showTip(content: Node | string, x: number, y: number): void {
  const t = ensure();
  t.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
  t.classList.add('show');
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
  t.style.left = Math.max(8, left) + 'px';
  t.style.top = Math.max(8, top) + 'px';
}

export function hideTip(): void {
  el?.classList.remove('show');
}

/** Attach a hover tooltip to an element. */
export function tip(target: HTMLElement | SVGElement, content: () => Node | string | null): void {
  target.addEventListener('mousemove', e => {
    const c = content();
    if (c) showTip(c, (e as MouseEvent).clientX, (e as MouseEvent).clientY); else hideTip();
  });
  target.addEventListener('mouseleave', hideTip);
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(msg: string): void {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status' }); document.body.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl!.classList.remove('show'), 2200);
}
