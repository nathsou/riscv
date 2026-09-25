/** Hash router: #/lab, #/ref/addi, … */
import { signal } from './reactive.ts';

export interface Route { path: string[]; query: URLSearchParams }

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: p ? p.split('/').map(decodeURIComponent) : [], query: new URLSearchParams(q ?? '') };
}

export const route = signal<Route>(parse(), (a, b) => a.path.join('/') === b.path.join('/') && a.query.toString() === b.query.toString());

window.addEventListener('hashchange', () => { route.value = parse(); });

export function navigate(path: string): void {
  if (location.hash !== '#' + path) location.hash = path;
}

export function link(path: string): string {
  return '#' + path;
}
