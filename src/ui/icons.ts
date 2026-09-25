/** Inline SVG icons (stroke-based, 24×24). */
const p = (d: string, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  play: p('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: p('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  step: p('<path d="M5 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  back: p('<path d="M19 5v14l-9-7z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>'),
  reset: p('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  sun: p('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: p('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  share: p('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>'),
  list: p('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  chip: p('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  book: p('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  code: p('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
  search: p('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  x: p('<path d="M18 6L6 18M6 6l12 12"/>'),
  zoomIn: p('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'),
  zoomOut: p('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
  fit: p('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  layers: p('<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
  arrowRight: p('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowLeft: p('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  cpu: p('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>'),
  wave: p('<path d="M2 12h3l2-7 4 14 3-10 2 5h6"/>'),
  pin: p('<path d="M12 17v5M9 3h6l-1 7 4 3H6l4-3z"/>'),
  keyboard: p('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  check: p('<path d="M20 6L9 17l-5-5"/>'),
  alert: p('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  sparkle: p('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstElementChild as SVGElement;
}

/** The brand mark: a stylised chip with an RV monogram. */
export const BRAND_SVG = `<svg class="brand-mark" viewBox="0 0 32 32" fill="none">
  <rect x="5" y="5" width="22" height="22" rx="5" stroke="var(--data)" stroke-width="1.8"/>
  <path d="M5 11H2M5 16H2M5 21H2M27 11h3M27 16h3M27 21h3M11 5V2M16 5V2M21 5V2M11 27v3M16 27v3M21 27v3" stroke="var(--line-3)" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M10.5 11.5h4.2a2.8 2.8 0 0 1 0 5.6h-4.2zM10.5 17.1v4.4M14.2 17.1l3 4.4M17.8 11.5l2.4 10 2.4-10" stroke="var(--data)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
