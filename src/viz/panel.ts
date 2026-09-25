import { h } from '../ui/h.ts';
export function mountDatapathPanel(el: HTMLElement, _opts: { docked?: boolean }): void {
  el.append(h('div', { class: 'panel-head' }, 'Datapath'), h('div', { class: 'panel-body' }, 'Coming soon'));
}
