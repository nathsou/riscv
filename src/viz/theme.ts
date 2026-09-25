/** Canvas colours, read from the CSS design tokens (re-read on theme change). */
export interface Theme {
  bg: string; bg2: string; panel: string; panel2: string; panel3: string; line: string; line2: string; line3: string;
  text: string; dim: string; faint: string; grid: string;
  data: string; dataDim: string; ctrl: string; ctrlDim: string; addr: string; addrDim: string; clock: string;
  one: string; zero: string; ok: string; warn: string; err: string; pink: string;
  dark: boolean;
  mono: string; font: string;
}

let cached: Theme | null = null;

export function theme(): Theme {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const bg = v('--bg');
  cached = {
    bg, bg2: v('--bg-2'), panel: v('--panel'), panel2: v('--panel-2'), panel3: v('--panel-3'),
    line: v('--line'), line2: v('--line-2'), line3: v('--line-3'),
    text: v('--text'), dim: v('--text-dim'), faint: v('--text-faint'), grid: v('--grid'),
    data: v('--data'), dataDim: v('--data-dim'), ctrl: v('--ctrl'), ctrlDim: v('--ctrl-dim'),
    addr: v('--addr'), addrDim: v('--addr-dim'), clock: v('--clock'),
    one: v('--one'), zero: v('--zero'), ok: v('--ok'), warn: v('--warn'), err: v('--err'), pink: v('--pink'),
    dark: luminance(bg) < 0.4,
    mono: v('--mono'), font: v('--font'),
  };
  return cached;
}

export function invalidateTheme(): void { cached = null; }

function luminance(c: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

if (typeof window !== 'undefined') {
  window.addEventListener('themechange', invalidateTheme);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', invalidateTheme);
}
