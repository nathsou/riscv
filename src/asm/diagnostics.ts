export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** 0-based line. */
  line: number;
  from: number;
  to: number;
  severity: Severity;
  message: string;
}

export interface Range { line: number; from: number; to: number }

export class AsmError extends Error {
  range: Range;
  constructor(message: string, range: Range) {
    super(message);
    this.range = range;
  }
}
