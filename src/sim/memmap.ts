/** The simulated machine's memory map. */
export const TEXT_BASE = 0x0000_0000;
export const DATA_BASE = 0x1000_0000;
export const GP_INIT = 0x1000_0800;
export const STACK_TOP = 0x7fff_fff0;
export const FB_BASE = 0xff00_0000;
export const FB_W = 64;
export const FB_H = 64;
export const MMIO_BASE = 0xffff_0000;
/** Returning to this address (the initial ra) halts the program cleanly. */
export const EXIT_ADDR = 0xffff_fff0;

export const MMIO = {
  CONSOLE_TX: 0xffff_0000,
  CONSOLE_RX_READY: 0xffff_0004,
  CONSOLE_RX: 0xffff_0008,
  KEY_READY: 0xffff_0010,
  KEY_CODE: 0xffff_0014,
  MTIME: 0xffff_0020,
  MTIMEH: 0xffff_0024,
  MTIMECMP: 0xffff_0028,
  MTIMECMPH: 0xffff_002c,
  RANDOM: 0xffff_0040,
} as const;

export const MMIO_DOCS: { addr: number; name: string; access: string; description: string }[] = [
  { addr: MMIO.CONSOLE_TX, name: 'CONSOLE_TX', access: 'W', description: 'Write a byte to print it on the console.' },
  { addr: MMIO.CONSOLE_RX_READY, name: 'CONSOLE_RX_READY', access: 'R', description: '1 if a typed character is waiting.' },
  { addr: MMIO.CONSOLE_RX, name: 'CONSOLE_RX', access: 'R', description: 'Pop the next typed character (0 if none).' },
  { addr: MMIO.KEY_READY, name: 'KEY_READY', access: 'R', description: '1 if a key press is queued (framebuffer focus).' },
  { addr: MMIO.KEY_CODE, name: 'KEY_CODE', access: 'R', description: 'Pop a key: ASCII, or 0x80 ↑ 0x81 ↓ 0x82 ← 0x83 →.' },
  { addr: MMIO.MTIME, name: 'MTIME', access: 'R', description: 'Timer, low word. Ticks once per retired instruction.' },
  { addr: MMIO.MTIMEH, name: 'MTIMEH', access: 'R', description: 'Timer, high word.' },
  { addr: MMIO.MTIMECMP, name: 'MTIMECMP', access: 'RW', description: 'Timer compare, low word. MTIP = mtime ≥ mtimecmp.' },
  { addr: MMIO.MTIMECMPH, name: 'MTIMECMPH', access: 'RW', description: 'Timer compare, high word.' },
  { addr: MMIO.RANDOM, name: 'RANDOM', access: 'R', description: 'A pseudo-random 32-bit number on every read.' },
];
