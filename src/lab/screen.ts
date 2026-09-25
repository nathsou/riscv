/** 64×64 RGB332 framebuffer display with keyboard capture. */
import { h } from '../ui/h.ts';
import { effect, onCleanup } from '../ui/reactive.ts';
import { session } from '../app/session.ts';
import { FB_BASE, FB_H, FB_W } from '../sim/memmap.ts';

const KEYMAP: Record<string, number> = { ArrowUp: 0x80, ArrowDown: 0x81, ArrowLeft: 0x82, ArrowRight: 0x83 };

export function screenPanel(): HTMLElement {
  const m = session.machine;
  const canvas = h('canvas', { class: 'fb', width: FB_W, height: FB_H, tabIndex: 0, 'aria-label': 'Framebuffer (click to focus, then use the keyboard)' });
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(FB_W, FB_H);
  const hint = h('div', { class: 'fb-hint' }, 'Click the screen to send key presses (arrows, letters) to KEY_CODE @ 0xffff0014');
  let lastVersion = -1;

  // RGB332 → RGBA lookup
  const lut = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    const r = Math.round(((v >> 5) & 7) * 255 / 7), g = Math.round(((v >> 2) & 7) * 255 / 7), b = Math.round((v & 3) * 255 / 3);
    lut[v] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
  const px = new Uint32Array(img.data.buffer);

  function draw() {
    if (m.mem.version === lastVersion) return;
    lastVersion = m.mem.version;
    const page = m.mem.pages;
    for (let i = 0; i < FB_W * FB_H; i++) {
      const a = FB_BASE + i;
      const p = page.get(a >>> 12);
      px[i] = lut[p ? p[a & 4095] : 0];
    }
    ctx.putImageData(img, 0, 0);
  }

  canvas.addEventListener('keydown', e => {
    let code = KEYMAP[e.key];
    if (code === undefined && e.key.length === 1) code = e.key.charCodeAt(0) & 0x7f;
    if (e.key === 'Enter') code = 10;
    if (e.key === ' ') code = 32;
    if (code === undefined) return;
    e.preventDefault();
    m.pressKey(code);
    canvas.classList.add('key');
    setTimeout(() => canvas.classList.remove('key'), 80);
  });
  canvas.addEventListener('focus', () => hint.classList.add('focused'));
  canvas.addEventListener('blur', () => hint.classList.remove('focused'));

  effect(() => { session.tick.track(); draw(); });
  let raf = 0;
  const loop = () => { if (session.running.peek()) draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  onCleanup(() => cancelAnimationFrame(raf));

  return h('div', { class: 'screen' }, h('div', { class: 'fb-wrap' }, canvas), hint);
}
