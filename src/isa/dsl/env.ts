import type { Width } from './ast.ts';

/** A synchronous trap raised while executing an instruction. */
export class Trap {
  cause: number;
  tval: number;
  message: string;
  constructor(cause: number, tval: number, message: string) {
    this.cause = cause;
    this.tval = tval;
    this.message = message;
  }
}

/** What an executing instruction may observe and change. */
export interface Hart {
  readonly x: Int32Array;
  pc: number;
  /** Set by the instruction; defaults to pc + 4. */
  nextPc: number;
  load(addr: number, w: Width, signed: boolean): number;
  /** Validate a store (alignment/access) without performing it; throws Trap. */
  checkStore(addr: number, w: Width): void;
  store(addr: number, w: Width, v: number): void;
  csrRead(addr: number): number;
  csrWrite(addr: number, v: number): void;
  writeReg(rd: number, v: number): void;
  ecall(): void;
  ebreak(): void;
  mret(): void;
  wfi(): void;
}
