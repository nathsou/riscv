/** Example programs, bundled from ./examples/*.s. */

export interface Example {
  id: string;
  title: string;
  description: string;
  source: string;
}

const files = import.meta.glob('./examples/*.s', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function parseExample(path: string, source: string): Example {
  const id = path.replace(/^.*\/\d+-/, '').replace(/\.s$/, '');
  const lines = source.split('\n');
  const title = (lines[0].match(/^#\s*Title:\s*(.*)$/)?.[1] ?? id).trim();
  const desc: string[] = [];
  for (const l of lines.slice(1)) {
    const m = l.match(/^#\s?(.*)$/);
    if (!m) break;
    desc.push(m[1]);
  }
  return { id, title, description: desc.join(' ').trim(), source };
}

export const EXAMPLES: Example[] = Object.keys(files).sort().map(p => parseExample(p, files[p]));
