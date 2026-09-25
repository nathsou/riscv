import { h } from '../ui/h.ts';
export function mount(el: HTMLElement): void {
  el.append(h('div', { class: 'scroll-page' }, h('p', null, 'Coming soon')));
}
