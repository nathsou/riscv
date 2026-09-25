/** Sparse, paged, little-endian RAM covering the address space below MMIO_BASE. */

export const PAGE_BITS = 12;
export const PAGE_SIZE = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_SIZE - 1;

export class Memory {
  pages = new Map<number, Uint8Array>();
  /** Incremented on every write; lets views cheaply detect changes. */
  version = 0;
  private lastNo = -1;
  private lastPage: Uint8Array | null = null;

  page(addr: number, create: boolean): Uint8Array | null {
    const no = addr >>> PAGE_BITS;
    if (no === this.lastNo && this.lastPage) return this.lastPage;
    let p = this.pages.get(no) ?? null;
    if (!p && create) { p = new Uint8Array(PAGE_SIZE); this.pages.set(no, p); }
    if (p) { this.lastNo = no; this.lastPage = p; }
    return p;
  }

  read8(addr: number): number {
    const p = this.page(addr, false);
    return p ? p[addr & PAGE_MASK] : 0;
  }

  write8(addr: number, v: number): void {
    this.page(addr, true)![addr & PAGE_MASK] = v;
    this.version++;
  }

  /** Aligned accesses never cross a page, which gives a fast path. */
  read16(addr: number): number {
    const p = this.page(addr, false);
    if (!p) return 0;
    const o = addr & PAGE_MASK;
    if (o + 1 < PAGE_SIZE) return p[o] | (p[o + 1] << 8);
    return this.read8(addr) | (this.read8(addr + 1) << 8);
  }

  read32(addr: number): number {
    const p = this.page(addr, false);
    if (!p) return 0;
    const o = addr & PAGE_MASK;
    if (o + 3 < PAGE_SIZE) return p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24);
    return this.read8(addr) | (this.read8(addr + 1) << 8) | (this.read8(addr + 2) << 16) | (this.read8(addr + 3) << 24);
  }

  write16(addr: number, v: number): void {
    this.write8(addr, v & 0xff);
    this.write8((addr + 1) >>> 0, (v >>> 8) & 0xff);
  }

  write32(addr: number, v: number): void {
    const p = this.page(addr, true)!;
    const o = addr & PAGE_MASK;
    if (o + 3 < PAGE_SIZE) {
      p[o] = v; p[o + 1] = v >>> 8; p[o + 2] = v >>> 16; p[o + 3] = v >>> 24;
      this.version++;
      return;
    }
    for (let i = 0; i < 4; i++) this.write8((addr + i) >>> 0, (v >>> (8 * i)) & 0xff);
  }

  readN(addr: number, n: 1 | 2 | 4): number {
    return n === 1 ? this.read8(addr) : n === 2 ? this.read16(addr) : this.read32(addr);
  }

  writeN(addr: number, n: 1 | 2 | 4, v: number): void {
    if (n === 1) this.write8(addr, v & 0xff);
    else if (n === 2) this.write16(addr, v);
    else this.write32(addr, v);
  }

  load(addr: number, bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.write8((addr + i) >>> 0, bytes[i]);
  }

  readBytes(addr: number, n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.read8((addr + i) >>> 0);
    return out;
  }

  clear(): void {
    this.pages.clear();
    this.lastNo = -1;
    this.lastPage = null;
    this.version++;
  }
}
