/** Tiny hyperscript DOM helper. */

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = {
  class?: string;
  style?: string | Partial<Record<string, string>>;
  [k: string]: unknown;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'defs', 'linearGradient', 'stop', 'tspan', 'title', 'marker', 'use', 'ellipse']);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): Element;
export function h(tag: string, props?: Props | null, ...children: Child[]): Element {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.setAttribute('class', String(v));
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign((el as HTMLElement).style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (k in el && !(el instanceof SVGElement) && k !== 'list') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element | DocumentFragment, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Create an element from an SVG/HTML string. */
export function fromHTML(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild!;
}
