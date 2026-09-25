/** localStorage wrappers that never throw (private mode, blocked storage…). */
export function load(key: string): string | null {
  try { return localStorage.getItem('rv:' + key); } catch { return null; }
}
export function save(key: string, value: string): void {
  try { localStorage.setItem('rv:' + key, value); } catch { /* ignore */ }
}
export function loadJSON<T>(key: string, fallback: T): T {
  const s = load(key);
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
export function saveJSON(key: string, v: unknown): void { save(key, JSON.stringify(v)); }
