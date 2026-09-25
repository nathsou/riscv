/** Runnable "Try it" programs built around each instruction's example. */
import type { InsnSpec } from '../isa/spec/index.ts';

const EXIT = ['    li   a7, 10          # exit', '    ecall'];
const SETUP = [
  '    li   a0, 12',
  '    li   a1, -7',
  '    li   a2, 5',
  '    li   t0, 3',
];

/** The program, plus the (0-based) line holding the featured instruction. */
export function tryItProgram(spec: InsnSpec): { source: string; line: number } {
  const mn = spec.mnemonic;
  const head = [`# Try it: ${mn} — ${spec.summary}`, '# Step with F10 and watch the registers, memory and datapath.', ''];
  const body: string[] = [];
  const data: string[] = [];
  let mark = '';
  const ex = spec.example.split('\n').map(l => '    ' + l.trim());
  switch (spec.category) {
    case 'branch':
      body.push('    li   a0, 5', '    li   a1, 0', 'loop:', '    addi a1, a1, 1          # count up');
      body.push(...ex); mark = ex[0];
      body.push('    # falls through once the branch is not taken');
      break;
    case 'jump':
      if (mn === 'jal') { body.push(...ex); mark = ex[0]; body.push(...EXIT, '', 'func:', '    li   a0, 42', '    ret                     # jalr zero, 0(ra)'); return finish(head, data, body, mark, false); }
      body.push('    la   t0, func'); body.push(...ex); mark = ex[0];
      body.push(...EXIT, '', 'func:', '    li   a0, 42', '    ret');
      return finish(head, data, body, mark, false);
    case 'load':
      data.push('value: .word 0x8badf00d');
      body.push('    addi sp, sp, -16', '    la   t1, value', '    lw   t1, 0(t1)', '    sw   t1, 4(sp)            # put a test word on the stack');
      body.push(...ex); mark = ex[0];
      body.push('    addi sp, sp, 16');
      break;
    case 'store':
      body.push('    addi sp, sp, -16', '    li   a0, 0x12345678');
      body.push(...ex); mark = ex[0];
      body.push('    lw   t1, 8(sp)           # read the word back', '    addi sp, sp, 16');
      break;
    case 'upper':
      if (mn === 'auipc') {
        data.push('msg: .asciz "hi"');
        body.push('1:'); body.push(...ex); mark = ex[0];
        body.push('    addi t0, t0, %pcrel_lo(1b)   # t0 = &msg');
      } else { body.push(...ex); mark = ex[0]; }
      break;
    case 'csr':
      body.push('    li   t0, 8');
      if (spec.example.includes('mtvec')) body[0] = '    li   t0, 0                # mtvec = 0: no trap handler';
      body.push(...ex); mark = ex[0];
      break;
    case 'system':
      if (mn === 'mret') {
        body.push('    la   t0, after', '    csrw mepc, t0            # where mret will return to');
        body.push(...ex); mark = ex[0];
        body.push('    nop                       # skipped', 'after:');
      } else if (mn === 'ecall') {
        body.push('    li   a0, 42', '    li   a7, 1                # PrintInt', '    ecall');
        mark = '    ecall';
      } else { body.push(...ex); mark = ex[0]; }
      break;
    default:
      body.push(...SETUP); body.push(...ex); mark = ex[0];
  }
  return finish(head, data, body, mark, true);
}

function finish(head: string[], data: string[], body: string[], mark: string, exit: boolean): { source: string; line: number } {
  const lines = [...head];
  if (data.length) lines.push('    .data', ...data, '');
  lines.push('    .text', 'main:');
  const start = lines.length;
  lines.push(...body);
  if (exit) lines.push(...EXIT);
  const idx = lines.findIndex((l, i) => i >= start && l === mark);
  lines[idx] = lines[idx].padEnd(28) + '# ◀';
  return { source: lines.join('\n') + '\n', line: idx };
}
