/** Integer register names and ABI roles. */

export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
] as const;

export type RegRole = 'zero' | 'ra' | 'sp' | 'gp' | 'tp' | 'temp' | 'saved' | 'arg';

export interface RegInfo {
  index: number;
  abi: string;
  role: RegRole;
  saver: 'caller' | 'callee' | '—';
  description: string;
}

export const REGS: RegInfo[] = ABI_NAMES.map((abi, index) => {
  let role: RegRole = 'temp';
  let saver: RegInfo['saver'] = 'caller';
  let description = '';
  if (index === 0) { role = 'zero'; saver = '—'; description = 'Hard-wired zero: reads as 0, writes are ignored'; }
  else if (index === 1) { role = 'ra'; description = 'Return address'; }
  else if (index === 2) { role = 'sp'; saver = 'callee'; description = 'Stack pointer (16-byte aligned at calls)'; }
  else if (index === 3) { role = 'gp'; saver = '—'; description = 'Global pointer'; }
  else if (index === 4) { role = 'tp'; saver = '—'; description = 'Thread pointer'; }
  else if (abi.startsWith('t')) { role = 'temp'; description = 'Temporary'; }
  else if (abi.startsWith('s')) { role = 'saved'; saver = 'callee'; description = index === 8 ? 'Saved register / frame pointer (fp)' : 'Saved register'; }
  else if (abi.startsWith('a')) { role = 'arg'; description = index <= 11 ? 'Function argument / return value' : 'Function argument'; }
  return { index, abi, role, saver, description };
});

const lookup = new Map<string, number>();
for (let i = 0; i < 32; i++) {
  lookup.set('x' + i, i);
  lookup.set(ABI_NAMES[i], i);
}
lookup.set('fp', 8);

/** Parse a register name (x0..x31, ABI name or fp). Returns -1 if not a register. */
export function regIndex(name: string): number {
  return lookup.get(name.toLowerCase()) ?? -1;
}

export function regName(i: number, abi = true): string {
  return abi ? ABI_NAMES[i] : 'x' + i;
}

export const REG_NAME_SET = new Set(lookup.keys());
