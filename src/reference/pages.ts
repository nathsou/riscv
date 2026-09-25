/** Reference guide pages: notation, formats, ABI, memory map, syscalls, CSRs, pseudo-instructions, directives. */
import { h } from '../ui/h.ts';
import type { Child } from '../ui/h.ts';
import { bitfield } from '../ui/components/bitfield.ts';
import { BY_MNEMONIC, INSTRUCTIONS, CATEGORY_LABELS } from '../isa/spec/index.ts';
import type { InsnSpec, Category } from '../isa/spec/index.ts';
import { REGS } from '../isa/regs.ts';
import { CSRS } from '../isa/csr.ts';
import { MMIO_DOCS, TEXT_BASE, DATA_BASE, GP_INIT, STACK_TOP, FB_BASE, MMIO_BASE, EXIT_ADDR } from '../sim/memmap.ts';
import { SYSCALLS } from '../sim/syscalls.ts';
import { PSEUDOS, DIRECTIVES } from '../asm/pseudo.ts';
import { immDiagram } from './immdiagram.ts';
import { stateUpdateMath } from '../isa/dsl/mathml.ts';
import { codeBlock } from './code.ts';
import { syntaxOf } from './card.ts';

const hex8 = (v: number) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const page = (title: string, lead: string, ...body: Child[]) =>
  h('article', { class: 'card guide' }, h('header', { class: 'card-head' }, h('div', null, h('h1', null, title), h('p', { class: 'lead' }, lead))), ...body);
const math = (m: string) => h('span', { class: 'math inline', html: `<math>${m}</math>` });
const table = (head: string[], rows: Child[][], cls = '') =>
  h('table', { class: `ref-table ${cls}` }, h('thead', null, h('tr', null, ...head.map(x => h('th', null, x)))),
    h('tbody', null, ...rows.map(r => h('tr', null, ...r.map(c => h('td', null, c))))));

// ------------------------------------------------------------------ index
export function indexPage(query: string, onQuery: (q: string) => void): HTMLElement {
  const input = h('input', { class: 'input search', type: 'search', placeholder: 'Search instructions (e.g. “shift”, “sltiu”, “load byte”)…', value: query, 'aria-label': 'Search instructions' });
  const results = h('div', { class: 'insn-groups' });
  const render = (q: string) => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (s: InsnSpec) => terms.every(t => `${s.mnemonic} ${s.summary} ${s.description} ${s.category} ${s.ext} ${s.format}`.toLowerCase().includes(t));
    const cats = Object.keys(CATEGORY_LABELS) as Category[];
    results.replaceChildren(...cats.flatMap(c => {
      const list = INSTRUCTIONS.filter(s => s.category === c && match(s));
      if (!list.length) return [];
      return [h('section', { class: 'insn-group' }, h('h2', null, CATEGORY_LABELS[c], h('span', { class: 'faint' }, ` ${list.length}`)),
        h('div', { class: 'insn-grid' }, ...list.map(s => h('a', { class: `insn-chip cat-${s.category}`, href: `#/ref/${s.mnemonic}` },
          h('span', { class: 'mn mono' }, s.mnemonic), h('span', { class: 'sm' }, s.summary)))))];
    }));
    if (!results.children.length) results.append(h('p', { class: 'dim' }, 'No instruction matches. Try a mnemonic or a word from its description.'));
  };
  input.addEventListener('input', () => { render(input.value); onQuery(input.value); });
  render(query);
  queueMicrotask(() => input.focus({ preventScroll: true }));
  return page('RV32IM instruction reference',
    `${INSTRUCTIONS.length} instructions: the RV32I base integer ISA, the M extension (multiply/divide), Zicsr and the machine-mode trap instructions. Each card shows the encoding, a plain-English explanation, formal semantics generated from the simulator’s own definition, and the datapath it lights up.`,
    input, results);
}

// ------------------------------------------------------------------ notation
export function notationPage(): HTMLElement {
  const addi = BY_MNEMONIC.get('addi')!;
  const rows: [string, string, string][] = [
    ['<mi>x</mi><mo>[</mo><mi>rs1</mi><mo>]</mo>', 'x[rs1]', 'The 32-bit value in register rs1. Reading x[0] always gives 0; writes to x[0] are discarded.'],
    ['<mi>pc</mi>', 'pc', 'The address of the current instruction.'],
    ['<msub><mi>M</mi><mn>32</mn></msub><mo>[</mo><mi>a</mi><mo>]</mo>', 'M₃₂[a]', 'The 32-bit little-endian word in memory at byte address a (also M₈, M₁₆).'],
    ['<mi>v</mi><mo>[</mo><mn>7</mn><mo>:</mo><mn>0</mn><mo>]</mo>', 'v[7:0]', 'Bits 7 down to 0 of v (a slice).'],
    ['<mi>a</mi><mo>∥</mo><mi>b</mi>', 'a ∥ b', 'Concatenation: a’s bits followed by b’s. 0¹² is twelve zero bits.'],
    ['<msub><mi>sext</mi><mn>32</mn></msub><mo>(</mo><mi>v</mi><mo>)</mo>', 'sext₃₂(v)', 'Sign-extend v to 32 bits by copying its top bit. zext fills with zeros instead.'],
    ['<mi>a</mi><msub><mo>&lt;</mo><mi>s</mi></msub><mi>b</mi>', 'a <ₛ b', 'Signed (two’s-complement) comparison. <ᵤ compares as unsigned numbers.'],
    ['<mi>a</mi><msub><mo>≫</mo><mi>s</mi></msub><mi>n</mi>', 'a ≫ₛ n', 'Arithmetic shift right (fills with the sign bit). ≫ᵤ is logical (fills with 0). Only the low 5 bits of n are used.'],
    ['<mi>a</mi><mo>⊕</mo><mi>b</mi>', 'a ⊕ b', 'Bitwise exclusive or. & and | are bitwise and / or.'],
    ['<mi>x</mi><mo>[</mo><mi>rd</mi><mo>]</mo><mo>←</mo><mi>v</mi>', 'x[rd] ← v', 'A state update: after the instruction, rd holds v.'],
    ['<mo>⟨</mo><mi>pc</mi><mo>,</mo><mi>x</mi><mo>,</mo><mi>M</mi><mo>⟩</mo>', '⟨pc, x, M⟩', 'The machine state: program counter, register file and memory.'],
    ['<mi>x</mi><mo>[</mo><mi>rd</mi><mo>↦</mo><mi>v</mi><mo>]</mo>', 'x[rd ↦ v]', 'The register file x with rd replaced by v (all others unchanged).'],
  ];
  const rule = `<math display="block"><mfrac linethickness="1.2px"><mrow><mtext>premise₁</mtext><mspace width="1.2em"></mspace><mtext>premise₂</mtext></mrow><mrow><mo>⟨</mo><mi>pc</mi><mo>,</mo><mi>x</mi><mo>,</mo><mi>M</mi><mo>⟩</mo><mo>→</mo><mo>⟨</mo><mi>pc′</mi><mo>,</mo><mi>x′</mi><mo>,</mo><mi>M′</mi><mo>⟩</mo></mrow></mfrac></math>`;
  return page('Notation', 'How to read the formal semantics on each instruction card. Every formula is generated from the same definition that the simulator executes, so the maths cannot drift from the behaviour.',
    h('section', null, h('h2', null, 'Symbols'),
      table(['Notation', 'Read as', 'Meaning'], rows.map(([m, t, d]) => [math(m), h('span', { class: 'mono dim' }, t), d]))),
    h('section', null, h('h2', null, 'State updates'),
      h('p', null, 'The first notation lists what changes. Everything not mentioned is unchanged, and the program counter moves on to pc + 4 unless an update says otherwise. Here is addi:'),
      h('div', { class: 'math', html: stateUpdateBlock(addi) })),
    h('section', null, h('h2', null, 'Inference rules'),
      h('p', null, 'The second notation is small-step operational semantics, standard in programming-language theory. Read it as: if everything above the line holds, the machine steps from the state on the left to the state on the right.'),
      h('div', { class: 'math', html: rule }),
      h('p', null, 'The first premise is always decoding: the word in memory at pc is this instruction with these fields. Further premises compute intermediate values (v, t, a) or state side conditions such as alignment. Branches get two rules, one for taken and one for not taken.')),
    h('section', null, h('h2', null, 'Why two’s complement?'),
      h('p', null, 'Registers hold plain 32-bit patterns. Whether a pattern means a signed or an unsigned number depends on the instruction: add and sub give the same bits either way, which is why RISC-V needs only one add, but comparisons (slt vs sltu), right shifts (sra vs srl), loads (lb vs lbu) and division come in two flavours.')),
  );
}

function stateUpdateBlock(s: InsnSpec): string { return stateUpdateMath(s).join(''); }

// ------------------------------------------------------------------ formats
export function formatsPage(): HTMLElement {
  const reps: [string, string, string][] = [
    ['R', 'add', 'Register–register operations: two sources, one destination, and funct7 to pick variants (add vs sub, srl vs sra, and the M extension).'],
    ['I', 'addi', 'A 12-bit signed immediate replaces rs2: arithmetic with constants, loads, jalr, CSR access and system calls.'],
    ['S', 'sw', 'Stores have no rd, so the immediate is split around rs2 to keep rs1 and rs2 in their usual places.'],
    ['B', 'beq', 'Like S, but the immediate is a branch offset in multiples of 2 bytes, so its bits are shuffled to reuse S-type wiring.'],
    ['U', 'lui', 'A 20-bit upper immediate (bits 31:12) for building constants and PC-relative addresses with lui and auipc.'],
    ['J', 'jal', 'A 20-bit jump offset (±1 MiB), again shuffled so that most bits sit where I- and U-type put them.'],
  ];
  return page('Instruction formats', 'Every RV32 instruction is 32 bits wide and uses one of six layouts. They were designed so the hardware can start work before it even knows which instruction it has.',
    h('section', null, h('h2', null, 'The six formats'),
      h('div', { class: 'formats' }, ...reps.map(([f, mn, why]) => h('div', { class: 'format-row' },
        h('div', { class: 'format-name' }, h('b', null, `${f}-type`), h('a', { class: 'mono', href: `#/ref/${mn}` }, `e.g. ${mn}`)),
        bitfield(BY_MNEMONIC.get(mn)!, { compact: false }), h('p', { class: 'dim' }, why))))),
    h('section', null, h('h2', null, 'Design rationale'),
      h('ul', null,
        h('li', null, h('b', null, 'rs1, rs2 and rd never move. '), 'The register file can be read in parallel with decoding, straight from fixed instruction bits.'),
        h('li', null, h('b', null, 'The sign bit is always bit 31. '), 'Sign extension can start immediately, before the format is known.'),
        h('li', null, h('b', null, 'Immediate bits are shuffled, not wires. '), 'B and J look scrambled, but the scrambling minimises the number of different sources each immediate bit can come from, which keeps the immediate generator’s multiplexers small.'),
        h('li', null, h('b', null, 'The low two opcode bits are 11. '), 'Other values are reserved for the 16-bit compressed (C) extension.'))),
    h('section', null, h('h2', null, 'Immediate wiring'),
      h('p', { class: 'dim' }, 'For each format: which instruction bit lands in which immediate bit. Hover to trace.'),
      ...(['I', 'S', 'B', 'U', 'J'] as const).map(f => h('div', { class: 'imm-row' }, h('h3', null, `${f}-type`), immDiagram(f)))),
  );
}

// ------------------------------------------------------------------ registers & ABI
export function abiPage(): HTMLElement {
  return page('Registers & calling convention', 'RV32I has 32 general-purpose registers of 32 bits. The hardware treats them all alike (except x0); their roles come from the ABI, a convention every compiler and library agrees on.',
    h('section', null, table(['Register', 'ABI name', 'Role', 'Saved by'],
      REGS.map(r => [h('span', { class: 'mono' }, `x${r.index}`), h('span', { class: `mono role-${r.role}` }, r.abi + (r.index === 8 ? ' / fp' : '')), r.description, r.saver]))),
    h('section', null, h('h2', null, 'Calling a function'),
      h('ul', null,
        h('li', null, 'Arguments go in a0–a7; results come back in a0 (and a1 for 64-bit values).'),
        h('li', null, h('span', { class: 'mono' }, 'call f'), ' is ', h('span', { class: 'mono' }, 'jal ra, f'), ': it saves the return address in ra. ', h('span', { class: 'mono' }, 'ret'), ' is ', h('span', { class: 'mono' }, 'jalr zero, 0(ra)'), '.'),
        h('li', null, h('b', null, 'Caller-saved'), ' (t0–t6, a0–a7, ra): a function may overwrite them, so save any you still need before a call.'),
        h('li', null, h('b', null, 'Callee-saved'), ' (s0–s11, sp): a function that uses them must restore them before returning.'),
        h('li', null, 'The stack grows down from ', h('span', { class: 'mono' }, hex8(STACK_TOP)), ' and sp stays 16-byte aligned at calls.')),
      codeBlock(`# int square_plus(int x, int y) { return x*x + y; }
square_plus:
    addi sp, sp, -16     # allocate a stack frame
    sw   ra, 12(sp)      # save the return address
    mul  a0, a0, a0      # x * x
    add  a0, a0, a1      # + y  (result in a0)
    lw   ra, 12(sp)
    addi sp, sp, 16
    ret`)),
  );
}

// ------------------------------------------------------------------ memory & devices
export function memoryPage(): HTMLElement {
  const regions: [string, number, string][] = [
    ['.text', TEXT_BASE, 'Program code. Execution starts at main (or _start, or the first instruction).'],
    ['.data / .rodata / .bss', DATA_BASE, 'Static data, placed one after another. gp is initialised to ' + hex8(GP_INIT) + '.'],
    ['heap', 0, 'Free memory above the static data (grow it yourself; there is no sbrk).'],
    ['stack', STACK_TOP, 'sp starts here and the stack grows downwards.'],
    ['framebuffer', FB_BASE, '64 × 64 pixels, one byte each (RGB332: rrrgggbb), row by row.'],
    ['MMIO', MMIO_BASE, 'Device registers (below).'],
    ['exit', EXIT_ADDR, 'The initial ra: returning from main jumps here and ends the program with a0 as the exit code.'],
  ];
  return page('Memory map & devices', 'A flat 32-bit address space, byte-addressed and little-endian. Word and halfword accesses must be naturally aligned: a misaligned address raises an exception.',
    h('section', null, table(['Region', 'Address', 'Notes'], regions.map(([n, a, d]) => [h('b', null, n), h('span', { class: 'mono' }, a ? hex8(a) : '—'), d]))),
    h('section', null, h('h2', null, 'Memory-mapped I/O'),
      h('p', null, 'Devices appear as words in memory. Loading from or storing to these addresses talks to the device instead of RAM.'),
      table(['Address', 'Name', 'Access', 'Description'], MMIO_DOCS.map(d => [h('span', { class: 'mono' }, hex8(d.addr)), h('span', { class: 'mono' }, d.name), d.access, d.description])),
      codeBlock(`    li   t0, 0xffff0000   # CONSOLE_TX
    li   t1, 'A'
    sw   t1, 0(t0)        # prints "A"`)),
  );
}

export function syscallsPage(): HTMLElement {
  return page('System calls', 'ecall asks the environment for a service: put the call number in a7 and arguments in a0–a2. Numbers follow the RARS simulator, plus Linux write (64) and exit (93). If a trap handler is installed (mtvec ≠ 0), ecall traps to it instead.',
    h('section', null, table(['a7', 'Name', 'Arguments', 'Result', 'Description'],
      SYSCALLS.map(s => [h('span', { class: 'mono' }, String(s.n)), h('b', null, s.name), h('span', { class: 'mono small' }, s.args), h('span', { class: 'mono small' }, s.result), s.description])),
    codeBlock(`    li   a0, 42
    li   a7, 1          # PrintInt
    ecall
    li   a7, 10         # Exit
    ecall`)),
  );
}

export function csrPage(): HTMLElement {
  return page('Control & status registers', 'Machine-mode CSRs, accessed with csrrw, csrrs and csrrc (and their immediate forms). Read-only CSRs raise an illegal-instruction exception when written.',
    h('section', null, table(['Address', 'Name', 'Access', 'Description'],
      CSRS.map(c => [h('span', { class: 'mono' }, '0x' + c.addr.toString(16).padStart(3, '0')), h('span', { class: 'mono' }, c.name), c.readOnly ? 'RO' : 'RW', c.description]))),
    h('section', null, h('h2', null, 'Traps in one paragraph'),
      h('p', null, 'On an exception or an enabled interrupt the hart saves the faulting pc in mepc, the reason in mcause (bit 31 set for interrupts) and extra information in mtval, copies mstatus.MIE to MPIE, clears MIE, and jumps to mtvec. The handler ends with mret, which restores MIE and jumps back to mepc. For an ecall, the handler must add 4 to mepc to skip the ecall itself.')),
  );
}

export function pseudoPage(): HTMLElement {
  return page('Pseudo-instructions', 'Convenient spellings that the assembler expands into one or two real instructions. The Lab’s listing view shows the expansion next to each line.',
    h('section', null, table(['Syntax', 'Expands to', 'Meaning'], PSEUDOS.map(p => [h('span', { class: 'mono' }, p.syntax), h('span', { class: 'mono dim' }, p.expansion), p.description]))),
  );
}

export function directivesPage(): HTMLElement {
  return page('Assembler directives', 'Directives start with a dot and control the assembler rather than producing instructions: sections, data, alignment and symbols. The syntax follows GNU as.',
    h('section', null, table(['Directive', 'Syntax', 'Meaning'], DIRECTIVES.map(d => [h('span', { class: 'mono' }, d.name), h('span', { class: 'mono dim' }, d.syntax), d.description]))),
    h('section', null, h('h2', null, 'Relocation operators'),
      table(['Operator', 'Meaning'], [
        [h('span', { class: 'mono' }, '%hi(sym)'), 'Upper 20 bits for lui, rounded so that adding %lo gives the full value.'],
        [h('span', { class: 'mono' }, '%lo(sym)'), 'Lower 12 bits (signed) for addi or a load/store offset.'],
        [h('span', { class: 'mono' }, '%pcrel_hi(sym)'), 'Upper 20 bits of sym − pc, for auipc.'],
        [h('span', { class: 'mono' }, '%pcrel_lo(label)'), 'Lower 12 bits matching the auipc at label.'],
      ])),
    h('section', null, h('h2', null, 'Every mnemonic'),
      h('p', { class: 'mono small dim wrap' }, INSTRUCTIONS.map(syntaxOf).join('  ·  '))),
  );
}
