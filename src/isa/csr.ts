/** Control and status registers implemented by this machine. */

export interface CsrInfo {
  addr: number;
  name: string;
  readOnly: boolean;
  description: string;
}

export const CSRS: CsrInfo[] = [
  { addr: 0x300, name: 'mstatus', readOnly: false, description: 'Machine status. Bit 3 = MIE (global interrupt enable), bit 7 = MPIE (previous MIE).' },
  { addr: 0x301, name: 'misa', readOnly: true, description: 'ISA and extensions: RV32IM.' },
  { addr: 0x304, name: 'mie', readOnly: false, description: 'Interrupt enable bits. Bit 7 = MTIE (timer), bit 11 = MEIE (external: keyboard).' },
  { addr: 0x305, name: 'mtvec', readOnly: false, description: 'Trap vector base address (direct mode). 0 = no handler: the environment handles ecalls and faults.' },
  { addr: 0x340, name: 'mscratch', readOnly: false, description: 'Scratch register for trap handlers.' },
  { addr: 0x341, name: 'mepc', readOnly: false, description: 'Exception PC: address of the instruction that trapped (or the next one, for interrupts).' },
  { addr: 0x342, name: 'mcause', readOnly: false, description: 'Trap cause. Bit 31 set = interrupt.' },
  { addr: 0x343, name: 'mtval', readOnly: false, description: 'Trap value: faulting address or instruction bits.' },
  { addr: 0x344, name: 'mip', readOnly: true, description: 'Interrupt pending bits (MTIP = bit 7, MEIP = bit 11).' },
  { addr: 0xb00, name: 'mcycle', readOnly: false, description: 'Cycle counter (low 32 bits).' },
  { addr: 0xb02, name: 'minstret', readOnly: false, description: 'Instructions-retired counter (low 32 bits).' },
  { addr: 0xb80, name: 'mcycleh', readOnly: false, description: 'Cycle counter (high 32 bits).' },
  { addr: 0xb82, name: 'minstreth', readOnly: false, description: 'Instructions-retired counter (high 32 bits).' },
  { addr: 0xc00, name: 'cycle', readOnly: true, description: 'User-mode shadow of mcycle.' },
  { addr: 0xc01, name: 'time', readOnly: true, description: 'User-mode shadow of mtime (low).' },
  { addr: 0xc02, name: 'instret', readOnly: true, description: 'User-mode shadow of minstret.' },
  { addr: 0xc80, name: 'cycleh', readOnly: true, description: 'High half of cycle.' },
  { addr: 0xc81, name: 'timeh', readOnly: true, description: 'High half of time.' },
  { addr: 0xc82, name: 'instreth', readOnly: true, description: 'High half of instret.' },
  { addr: 0xf11, name: 'mvendorid', readOnly: true, description: 'Vendor ID (0).' },
  { addr: 0xf12, name: 'marchid', readOnly: true, description: 'Architecture ID (0).' },
  { addr: 0xf13, name: 'mimpid', readOnly: true, description: 'Implementation ID (0).' },
  { addr: 0xf14, name: 'mhartid', readOnly: true, description: 'Hart ID (0).' },
];

export const CSR_BY_NAME = new Map(CSRS.map(c => [c.name, c]));
export const CSR_BY_ADDR = new Map(CSRS.map(c => [c.addr, c]));

export function csrName(addr: number): string {
  return CSR_BY_ADDR.get(addr)?.name ?? '0x' + addr.toString(16);
}

export const MSTATUS_MIE = 1 << 3;
export const MSTATUS_MPIE = 1 << 7;
export const MIP_MTIP = 1 << 7;
export const MIP_MEIP = 1 << 11;

export const CAUSE = {
  misalignedFetch: 0,
  illegalInstruction: 2,
  breakpoint: 3,
  misalignedLoad: 4,
  loadFault: 5,
  misalignedStore: 6,
  storeFault: 7,
  ecallM: 11,
  timerInterrupt: 0x80000007,
  externalInterrupt: 0x8000000b,
} as const;

export const CAUSE_NAMES: Record<number, string> = {
  0: 'Instruction address misaligned',
  2: 'Illegal instruction',
  3: 'Breakpoint',
  4: 'Load address misaligned',
  5: 'Load access fault',
  6: 'Store address misaligned',
  7: 'Store access fault',
  11: 'Environment call from M-mode',
  [0x80000007]: 'Machine timer interrupt',
  [0x8000000b]: 'Machine external interrupt',
};
