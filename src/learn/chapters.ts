/**
 * The guided tour. Each chapter is prose plus live widgets built from the
 * same hardware library, simulator and assembler as the rest of the app.
 */
import { h } from '../ui/h.ts';
import type { Child } from '../ui/h.ts';
import { AND, OR, XOR, NAND, NOR, NOT } from '../hw/lib/gates.ts';
import { HALF_ADDER, FULL_ADDER, RIPPLE_ADDER, MUX2, DECODER } from '../hw/lib/blocks.ts';
import { ALU, ALU_OPS } from '../hw/lib/alu.ts';
import { CONTROL } from '../hw/lib/control.ts';
import { DFF, REGFILE } from '../hw/lib/state.ts';
import { BY_MNEMONIC } from '../isa/spec/index.ts';
import { bitfield } from '../ui/components/bitfield.ts';
import { EXAMPLES } from '../content/examples.ts';
import { XOR_FROM_NAND, ADDSUB4 } from './defs.ts';
import { circuitWidget } from './widgets/circuit.ts';
import { miniSim } from './widgets/minisim.ts';
import { quiz, predict } from './widgets/quiz.ts';
import { fdeWidget, encoderWidget, asmExplorer, controlTable } from './widgets/misc.ts';
import { codeBlock } from '../reference/code.ts';
import type { Def } from '../hw/netlist.ts';

export interface Chapter { id: string; title: string; blurb: string; body: () => Child[] }

const P = (html: string) => h('p', { html });
const H = (t: string) => h('h2', null, t);
const Note = (html: string) => h('aside', { class: 'note', html });
const Ref = (mn: string) => `<a class="mono" href="#/ref/${mn}">${mn}</a>`;
const word = (src: string): number => {
  const spec = BY_MNEMONIC.get(src.split(' ')[0])!;
  return spec.match;
};

function gatePicker(): HTMLElement {
  const gates: [string, Def][] = [['AND', AND()], ['OR', OR()], ['XOR', XOR()], ['NAND', NAND()], ['NOR', NOR()], ['NOT', NOT]];
  const host = h('div');
  const tabs = h('div', { class: 'tabs small' });
  const show = (i: number) => {
    host.replaceChildren(circuitWidget({ def: gates[i][1], table: true, height: 170, caption: gates[i][1].doc }));
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
  };
  gates.forEach(([n], i) => { const b = h('button', null, n); b.addEventListener('click', () => show(i)); tabs.append(b); });
  show(0);
  return h('div', { class: 'gate-picker' }, tabs, host);
}

const regs = new Int32Array(32).map((_, i) => i * 11);

export const CHAPTERS: Chapter[] = [
  {
    id: 'cpu', title: 'What a CPU does', blurb: 'Fetch, decode, execute — the loop at the heart of every computer.',
    body: () => [
      P('A processor is a machine that does one small thing, extremely fast, forever: it <b>fetches</b> an instruction from memory, <b>decodes</b> what it means, and <b>executes</b> it. Then it moves on to the next one. Everything a computer does — games, browsers, this page — is built from billions of repetitions of that loop.'),
      P('The instructions are just numbers in memory. A special register, the <b>program counter</b> (PC), holds the address of the next one. Executing an instruction usually means reading some <b>registers</b> (the CPU’s 32 tiny, fast storage slots), computing something, and writing a result back — and, unless the instruction is a jump, adding 4 to the PC.'),
      fdeWidget(),
      P('Watch the PC: it walks through memory 4 bytes at a time, until the branch instruction (<span class="mono">blt</span>) sends it back to the start of the loop. That is all “control flow” is: an instruction that writes the PC.'),
      H('The plan'),
      P('In the next chapters we build this machine from the bottom up. We start with logic gates, combine them into adders and memory cells, assemble those into a register file and an ALU, and wire everything into a complete RISC-V processor that runs real programs. Then we make it faster with a pipeline, and teach it to talk to the outside world.'),
      Note('Every circuit on these pages is live. It is the same hardware description that the Datapath view simulates — when you toggle an input here, you are poking the real CPU’s building blocks.'),
      quiz({ id: 'cpu-1', q: 'After executing <span class="mono">addi t0, t0, 1</span> at address 0x08, what is the PC?', options: ['0x08', '0x09', '0x0c', 'It depends on t0'], answer: 2, explain: 'Every RV32 instruction is 4 bytes long, so a non-jump instruction sets pc ← pc + 4 = 0x0c.' }),
    ],
  },
  {
    id: 'gates', title: 'Bits and gates', blurb: 'Switches that compute: AND, OR, NOT, and the universal NAND.',
    body: () => [
      P('Digital hardware works with <b>bits</b>: wires that are either at a low voltage (0) or a high one (1). A <b>logic gate</b> is a tiny circuit — a handful of transistors — whose output is a fixed function of its inputs. Click the inputs to try each gate; the truth table lists every combination.'),
      gatePicker(),
      P('On the wires, a bright colour means 1 and a dim one means 0. When you flip an input, watch the change ripple through: each gate takes a moment (a <b>gate delay</b>) to respond. Those delays add up, and they are what ultimately limits how fast a CPU can run.'),
      H('One gate to rule them all'),
      P('NAND (“not and”) is <b>universal</b>: any logic function can be built from NANDs alone. Here is exclusive-or, made from four of them. Check the truth table against the XOR above.'),
      circuitWidget({ def: XOR_FROM_NAND, table: true, height: 220 }),
      quiz({ id: 'gates-1', q: 'Which single gate outputs 1 exactly when its two inputs are <i>equal</i>?', options: ['NAND', 'NOR', 'XNOR (XOR followed by NOT)', 'OR'], answer: 2, explain: 'XOR is 1 when the inputs differ, so its complement XNOR is 1 when they are equal. The CPU uses this idea to compare numbers.' }),
    ],
  },
  {
    id: 'arith', title: 'Arithmetic from gates', blurb: 'Half adders, full adders, ripple carry and two’s complement.',
    body: () => [
      P('Adding two bits gives a two-bit answer: 1 + 1 = 10 in binary. The low bit (the <b>sum</b>) is a XOR b; the high bit (the <b>carry</b>) is a AND b. That circuit is a <b>half adder</b>.'),
      circuitWidget({ def: HALF_ADDER, table: true, height: 170 }),
      P('To add longer numbers we also need to add the carry coming in from the column to the right, just like in long addition. A <b>full adder</b> adds three bits: a, b and carry-in.'),
      circuitWidget({ def: FULL_ADDER, table: true, height: 230 }),
      P('Chain full adders, each one’s carry-out feeding the next one’s carry-in, and you can add numbers of any width. This is a <b>ripple-carry adder</b>. Try 7 + 9 and watch the carry ripple from right to left.'),
      circuitWidget({ def: RIPPLE_ADDER(4), inputs: [7, 9, 0], height: 250, caption: 'Hover a wire to see its value. The carry must travel through every stage: a 32-bit ripple adder is slow.' }),
      H('Negative numbers'),
      P('Computers store negative numbers in <b>two’s complement</b>: −x is written as the bit pattern of 2ⁿ − x. In 4 bits, −1 is 1111 and −3 is 1101. The magic is that ordinary binary addition then works for negative numbers too, so the same adder serves both. To negate, invert all the bits and add 1.'),
      P('That gives subtraction for free: a − b = a + (¬b) + 1. Invert b with XOR gates controlled by a <span class="mono">sub</span> signal, and feed <span class="mono">sub</span> into the carry-in as the +1.'),
      circuitWidget({ def: ADDSUB4, inputs: [5, 3, 1], height: 250, presets: [{ label: '5 − 3', values: [5, 3, 1] }, { label: '3 − 5 (= −2 = 1110)', values: [3, 5, 1] }, { label: '7 + 1 (overflow into −8)', values: [7, 1, 0] }] }),
      predict({ id: 'arith-1', q: 'In 8-bit two’s complement, what is the bit pattern of −6?', answer: '11111010', explain: '6 is 00000110. Invert: 11111001. Add 1: 11111010.', placeholder: '8 bits' }),
      Note('The real ALU in this CPU uses exactly this trick: <span class="mono">sub</span> is the adder with b inverted and a carry-in of 1. There is also a faster <b>carry-lookahead</b> adder — flip the CLA switch in the Datapath view and compare the delays.'),
    ],
  },
  {
    id: 'memory', title: 'Choosing and remembering', blurb: 'Multiplexers, decoders, flip-flops and the clock.',
    body: () => [
      P('A <b>multiplexer</b> (mux) is a selector switch: its select input chooses which of its data inputs appears at the output. A CPU is full of them — they route the right value to the right place for each instruction.'),
      circuitWidget({ def: MUX2, table: true, height: 220 }),
      P('A <b>decoder</b> does the opposite: it turns an n-bit number into 2ⁿ separate lines, exactly one of which is 1. The register file uses one to pick which register to write.'),
      circuitWidget({ def: DECODER(2), inputs: [2], height: 240 }),
      H('Memory from feedback'),
      P('Everything so far is <b>combinational</b>: outputs depend only on current inputs. To remember, a circuit must feed its output back into itself. Two cross-coupled NAND gates form a <b>latch</b> that holds a bit; two latches in series, alternately enabled by a <b>clock</b>, form a <b>D flip-flop</b>.'),
      P('Set <span class="mono">d</span>, then toggle <span class="mono">clk</span> from 0 to 1. The output <span class="mono">q</span> changes only on that rising edge; changing d while the clock is high or low has no effect on q.'),
      circuitWidget({ def: DFF, inputs: [1, 0], height: 300, caption: 'While clk = 0 the master latch follows d; on the rising edge the slave copies the master into q.' }),
      P('The clock is a signal that ticks up and down millions or billions of times a second. On each rising edge, every flip-flop in the CPU captures its input at once. Between edges, combinational logic computes the next values. A <b>register</b> is just 32 flip-flops sharing a clock.'),
      quiz({ id: 'mem-1', q: 'Why does the CPU need a clock at all?', options: ['To count time for programs', 'So that all state updates happen together, after the combinational logic has settled', 'To power the transistors', 'Because memory is slow'], answer: 1, explain: 'Signals take different times to settle through different paths. The clock edge is the moment everyone agrees the values are final; the clock period must be longer than the slowest path (the critical path).' }),
    ],
  },
  {
    id: 'regfile-alu', title: 'The register file and the ALU', blurb: 'Where values live, and where they are computed.',
    body: () => [
      P('RISC-V has 32 registers, x0 to x31, each 32 bits wide. The <b>register file</b> has two read ports (so an instruction like <span class="mono">add</span> can read both operands at once) and one write port. Each read port is a 32-way multiplexer; the write port is a decoder driving the enable of one register.'),
      circuitWidget({ def: REGFILE, inputs: [5, 7, 0, 0, 0], height: 300, opts: { regs: () => regs }, caption: 'In this demo, register xi holds 11·i. Change ra1 and ra2 to read different registers. Register x0 always reads 0.' }),
      P('The <b>arithmetic logic unit</b> (ALU) computes: add, subtract, shift, compare, and bitwise operations. It computes all of them in parallel and a multiplexer picks the one requested by its <span class="mono">op</span> input — the control unit decides which.'),
      circuitWidget({
        def: ALU, inputs: [12, 5, ALU_OPS.add], height: 330,
        presets: [
          { label: 'add 12 + 5', values: [12, 5, ALU_OPS.add] }, { label: 'sub 12 − 5', values: [12, 5, ALU_OPS.sub] },
          { label: 'slt −1 < 5 (signed)', values: [0xffffffff, 5, ALU_OPS.slt] }, { label: 'sltu −1 < 5 (unsigned)', values: [0xffffffff, 5, ALU_OPS.sltu] },
          { label: 'sll 3 << 4', values: [3, 4, ALU_OPS.sll] }, { label: 'sra −64 >> 2', values: [0xffffffc0, 2, ALU_OPS.sra] },
          { label: 'xor', values: [0b1100, 0b1010, ALU_OPS.xor] },
        ],
        caption: 'Pick an operation from “Try…”. Double-click isn’t needed here: open the Datapath view to zoom into the ALU down to its gates.',
      }),
      quiz({ id: 'alu-1', q: 'The ALU compares 0xFFFFFFFF and 5. <span class="mono">slt</span> says 1 (less than) but <span class="mono">sltu</span> says 0. Why?', options: ['A bug', 'slt treats the bits as signed (−1 < 5); sltu as unsigned (4294967295 > 5)', 'sltu ignores the top bit', 'slt compares only the low byte'], answer: 1, explain: 'The same 32 bits mean −1 signed and 4 294 967 295 unsigned. The instruction decides the interpretation.' }),
    ],
  },
  {
    id: 'isa', title: 'The ISA contract', blurb: 'Registers, instruction formats, and encoding an instruction by hand.',
    body: () => [
      P('The <b>instruction set architecture</b> (ISA) is the contract between software and hardware: which registers exist, which instructions there are, what exactly each one does, and how it is encoded as bits. RISC-V is an open ISA, designed to be simple and regular. This site implements RV32IM: the 32-bit base integer instructions plus multiply/divide.'),
      P('Every instruction is 32 bits. The low 7 bits (the <b>opcode</b>) say which family it belongs to; other fields name registers (<b>rd</b> for the destination, <b>rs1</b> and <b>rs2</b> for sources), select the exact operation (<b>funct3</b>, <b>funct7</b>), or hold an <b>immediate</b> constant.'),
      h('div', { class: 'fmt-mini' }, ...['add', 'addi', 'sw', 'beq', 'lui', 'jal'].map(mn => h('div', null, h('a', { class: 'mono', href: `#/ref/${mn}` }, mn), bitfield(BY_MNEMONIC.get(mn)!, { compact: true })))),
      P('There are six formats (R, I, S, B, U and J), and they are carefully aligned: rs1, rs2 and rd are always in the same bit positions, so the hardware can read registers before it even knows which instruction it has. See the <a href="#/ref/formats">formats page</a> for the details.'),
      H('Encode it yourself'),
      encoderWidget(),
      predict({ id: 'isa-1', q: 'In <span class="mono">add x5, x6, x7</span>, what is the value of the rs2 field in binary?', answer: '00111', explain: 'rs2 is register x7, and 7 in five bits is 00111.', placeholder: '5 bits' }),
      Note(`Every instruction has a reference card with its encoding, formal semantics and datapath — for example ${Ref('addi')}, ${Ref('lw')} or ${Ref('beq')}.`),
    ],
  },
  {
    id: 'datapath', title: 'The single-cycle datapath', blurb: 'Wiring it all together: tracing add, lw, sw, beq and jal.',
    body: () => [
      P('Put the pieces together: a PC register, instruction memory, the register file, an immediate generator, the ALU, data memory, and multiplexers to route values. In a <b>single-cycle</b> CPU each instruction does all its work in one long clock cycle: fetch, decode, read registers, compute, access memory, and write back.'),
      P('Step through this program one clock cycle at a time. Paths the current instruction does not use are dimmed; after each clock edge, the new values sweep across the circuit as they settle. Hover over any wire to see its value.'),
      miniSim({
        title: 'Datapath tour', mode: 'single', views: ['insn', 'datapath', 'regs'], regs: ['t0', 'a0', 'a1', 'ra'], height: 380, rate: 1,
        source: `# Title: Datapath tour
    .data
val: .word 40
    .text
main:
    la   t0, val        # auipc + addi: t0 = &val
    lw   a0, 0(t0)      # load: address = t0 + 0
    addi a0, a0, 2      # immediate arithmetic
    add  a1, a0, a0     # register arithmetic
    sw   a1, 4(t0)      # store: memory[t0 + 4] = a1
    beq  a0, a1, main   # branch not taken (42 != 84)
    jal  ra, done       # jump, saving pc + 4 in ra
    nop
done:
    li   a7, 10
    ecall
`,
      }),
      P('Things to notice as you step: for <span class="mono">lw</span> the ALU computes an <i>address</i> and the result comes from data memory; for <span class="mono">sw</span> nothing is written back to a register; for <span class="mono">beq</span> the branch comparator decides whether the next PC is pc + 4 or the target; <span class="mono">jal</span> writes pc + 4 into ra.'),
      quiz({ id: 'dp-1', q: 'For <span class="mono">lw a0, 0(t0)</span>, what does the ALU compute?', options: ['The loaded value', 't0 + 0: the memory address', 'a0 + t0', 'Nothing: loads bypass the ALU'], answer: 1, explain: 'The ALU adds the base register and the offset to form the address; data memory then returns the word stored there.' }),
      Note('The <a href="#/datapath">Datapath view</a> shows this CPU full-screen with the abstraction slider: zoom from the system bus down to the individual gates of the adder.'),
    ],
  },
  {
    id: 'control', title: 'Control', blurb: 'How opcode bits become control signals.',
    body: () => [
      P('The datapath has switches everywhere: which immediate format to extract, which ALU operation, whether to write a register, read or write memory, and what to write back. The <b>control unit</b> sets them all from the instruction bits. Here is its complete truth table, generated from the instruction definitions:'),
      controlTable(['add', 'sub', 'addi', 'slli', 'lw', 'sw', 'beq', 'blt', 'jal', 'jalr', 'lui', 'auipc', 'csrrw', 'ecall']),
      P('In hardware this is a <b>programmable logic array</b> (PLA): an AND plane with one row per instruction that matches its fixed opcode and funct bits, and an OR plane that combines rows into each control output. Pick an instruction to see its row fire.'),
      circuitWidget({
        def: CONTROL, inputs: [word('add')], height: 460,
        presets: ['add', 'addi', 'lw', 'sw', 'beq', 'jal', 'lui', 'ecall'].map(mn => ({ label: mn, values: [word(mn)] })),
        caption: 'Filled dots: this bit must be 1; rings: it must be 0. If no row matches, the instruction is illegal and the CPU raises an exception.',
      }),
      quiz({ id: 'ctl-1', q: 'Which control signal is 1 for <span class="mono">sw</span> but 0 for <span class="mono">lw</span>?', options: ['regWrite', 'memWrite', 'memRead', 'bSel'], answer: 1, explain: 'Stores write memory and do not write a register; loads read memory and do write a register. Both use the immediate as the ALU’s second operand (bSel = imm).' }),
    ],
  },
  {
    id: 'assembler', title: 'From text to bits', blurb: 'Labels, pseudo-instructions and the %hi/%lo trick.',
    body: () => [
      P('Nobody writes machine code in hex. An <b>assembler</b> translates human-readable assembly into instruction words. It works in two passes: first it lays out the program and records the address of every <b>label</b>; then it encodes each instruction, replacing label names with addresses or offsets.'),
      asmExplorer(`# Edit me!
    .data
msg: .asciz "hi"
    .text
main:
    la   a0, msg         # pseudo: auipc + addi
    li   t0, 0x12345678  # pseudo: lui + addi
    li   t1, 42          # fits in 12 bits: one addi
loop:
    addi t1, t1, -1
    bnez t1, loop        # pseudo: bne t1, zero, loop
    ret                  # pseudo: jalr zero, 0(ra)
`),
      P('<b>Pseudo-instructions</b> like <span class="mono">li</span>, <span class="mono">la</span>, <span class="mono">mv</span> and <span class="mono">ret</span> are conveniences: the assembler expands them into one or two real instructions.'),
      H('Big constants'),
      P('An I-type immediate has only 12 bits, so a 32-bit constant needs two instructions: <span class="mono">lui</span> loads the upper 20 bits and <span class="mono">addi</span> adds the lower 12. There is a subtlety: <span class="mono">addi</span> sign-extends its immediate, so if bit 11 of the low part is 1, it actually subtracts. The assembler compensates by adding 1 to the upper part — that is what <span class="mono">%hi()</span> does.'),
      codeBlock(`    lui  t0, %hi(0x12345FFF)   # 0x12346 (rounded up!)
    addi t0, t0, %lo(0x12345FFF) # -1`),
      predict({ id: 'asm-1', q: 'What does <span class="mono">%hi(0x00000800)</span> evaluate to?', answer: '1', explain: '%lo(0x800) is −2048 (bit 11 is set), so %hi must be 1: (1 << 12) − 2048 = 0x800.', placeholder: 'a number' }),
    ],
  },
  {
    id: 'functions', title: 'Calling functions', blurb: 'The stack, ra, and the calling convention, through recursion.',
    body: () => [
      P('A function call is a jump that remembers where to come back to: <span class="mono">call f</span> (really <span class="mono">jal ra, f</span>) saves the return address in register <b>ra</b>, and <span class="mono">ret</span> jumps back to it. Arguments travel in a0–a7 and the result comes back in a0.'),
      P('But if a function calls another function, ra gets overwritten. So functions save what they need on the <b>stack</b>: a region of memory that grows downwards from high addresses, with the <b>stack pointer</b> sp marking its top. Each call pushes a <b>frame</b>; each return pops it.'),
      miniSim({
        title: 'Recursive factorial', views: ['insn', 'regs', 'stack', 'console'], regs: ['a0', 't1', 'sp', 'ra'], rate: 4,
        source: `# Title: Recursive factorial
main:
    li   a0, 4
    call fact            # a0 = fact(4)
    li   a7, 1
    ecall                # print a0
    li   a7, 10
    ecall

fact:                    # a0 = n
    addi sp, sp, -16     # push a frame
    sw   ra, 12(sp)      # save the return address
    sw   a0, 8(sp)       # save n
    li   t0, 1
    ble  a0, t0, base
    addi a0, a0, -1
    call fact            # a0 = fact(n - 1)
    lw   t1, 8(sp)       # t1 = n
    mul  a0, a0, t1      # n * fact(n - 1)
    j    out
base:
    li   a0, 1
out:
    lw   ra, 12(sp)      # restore and pop
    addi sp, sp, 16
    ret
`,
        caption: 'Step until the recursion bottoms out: four frames on the stack, each holding a saved n and return address.',
      }),
      P('The <a href="#/ref/abi">calling convention</a> divides registers into <b>caller-saved</b> (t0–t6, a0–a7: a function may clobber them) and <b>callee-saved</b> (s0–s11: a function must restore them). It is a pure software agreement — the hardware does not care — but it is what lets code written by different people and compilers work together.'),
      quiz({ id: 'fn-1', q: 'Why does <span class="mono">fact</span> save ra on the stack?', options: ['The hardware requires it', 'Because its own call to fact overwrites ra', 'To pass it as an argument', 'It doesn’t need to'], answer: 1, explain: 'The inner call writes a new return address into ra. Without saving the old one, fact could not return to its own caller.' }),
    ],
  },
  {
    id: 'pipeline', title: 'Going faster', blurb: 'Pipelining, hazards, forwarding and stalls.',
    body: () => [
      P('In the single-cycle CPU, the clock period must fit the slowest instruction’s entire journey. A <b>pipeline</b> overlaps instructions like an assembly line: split the work into five stages — <b>IF</b> (fetch), <b>ID</b> (decode, read registers), <b>EX</b> (execute), <b>MEM</b> (memory) and <b>WB</b> (write back) — with registers between them. Each instruction still takes five steps, but a new one starts every cycle, and the cycle can be about five times shorter.'),
      P('Overlap creates <b>hazards</b>. If an instruction needs a result that the previous instruction has not written back yet, the pipeline <b>forwards</b> it directly from the later stage. A value loaded from memory arrives too late even for forwarding, so the <b>hazard unit</b> stalls one cycle. And a taken branch is only discovered in EX, so the two instructions fetched behind it must be <b>flushed</b>.'),
      miniSim({
        title: 'Pipeline hazards', mode: 'pipeline', views: ['pipeline'], rate: 1.5,
        source: `# Title: Pipeline hazards
main:
    li   t0, 5
    addi t1, t0, 1      # needs t0: forwarded from EX/MEM
    add  t2, t0, t1     # t0 from MEM/WB, t1 from EX/MEM
    sw   t2, -4(sp)
    lw   t3, -4(sp)
    add  t4, t3, t3     # load-use: one stall cycle
    beq  t4, t4, skip   # taken: two instructions flushed
    li   t5, 99
    li   t5, 98
skip:
    li   a7, 10
    ecall
`,
        caption: 'Each instruction keeps its colour as it moves through the stages. Pink paths are forwarding; amber is the hazard unit; violet is the branch redirect.',
      }),
      predict({ id: 'pipe-1', q: 'Ignoring the time to fill the pipeline, how many cycles does a load immediately followed by an instruction using its result cost, compared to two independent instructions?', answer: '1', explain: 'One extra cycle: the load-use stall. Compilers try to schedule an independent instruction in between to hide it.', placeholder: 'extra cycles' }),
      Note('Switch the Lab or the Datapath view to <b>Pipelined</b> to run any program on this pipeline and see its CPI (cycles per instruction).'),
    ],
  },
  {
    id: 'io', title: 'Talking to the world', blurb: 'Memory-mapped I/O: the console, the screen, the keyboard.',
    body: () => [
      P('A CPU that cannot communicate is useless. Most processors, RISC-V included, use <b>memory-mapped I/O</b>: devices appear at special addresses, and ordinary loads and stores talk to them. Storing a byte to 0xffff0000 prints it on the console; the 4096 bytes at 0xff000000 are the pixels of a 64 × 64 screen.'),
      miniSim({
        title: 'Hello, pixels', views: ['console', 'screen'], rate: 120,
        source: `# Title: Hello, pixels
main:
    li   t0, 0xffff0000   # CONSOLE_TX
    li   t1, 'H'
    sw   t1, 0(t0)
    li   t1, 'i'
    sw   t1, 0(t0)
    li   t0, 0xff000000   # framebuffer
    li   t2, 0            # i
loop:
    slli t3, t2, 6        # y * 64
    add  t3, t3, t2       # + x   (x = y = i)
    add  t3, t3, t0
    slli t4, t2, 2        # colour: rrrgggbb
    sb   t4, 0(t3)
    sb   t4, 63(t3)       # a second diagonal
    addi t2, t2, 1
    li   t5, 64
    blt  t2, t5, loop
    li   a7, 10
    ecall
`,
      }),
      P('The <a href="#/ref/memory">memory map</a> lists every device: a console for text in and out, a keyboard queue for games, a timer, and a random number generator. The environment also offers <a href="#/ref/syscalls">system calls</a> through <span class="mono">ecall</span> for printing numbers and strings.'),
      h('p', null, h('a', { class: 'btn primary', href: '#/lab' }, 'Open the Lab'), ' ', h('span', { class: 'dim' }, 'Try the Snake and Game of Life examples.')),
      quiz({ id: 'io-1', q: 'How does the CPU know that <span class="mono">sw t1, 0(t0)</span> should print a character instead of writing RAM?', options: ['A special print instruction', 'The address: 0xffff0000 is decoded to the console device, not RAM', 'The value is ASCII', 'The OS intercepts it'], answer: 1, explain: 'The instruction is an ordinary store. The system bus routes addresses in the device range to the device instead of memory.' }),
    ],
  },
  {
    id: 'traps', title: 'Traps and interrupts', blurb: 'Exceptions, the timer, and machine-mode handlers.',
    body: () => [
      P('Sometimes the normal flow must be interrupted: an instruction does something illegal (a misaligned load, an unknown opcode), a program asks for a service (<span class="mono">ecall</span>), or a device needs attention (the timer fires). RISC-V handles all of these the same way — a <b>trap</b>.'),
      P('On a trap the hardware saves the PC in <b>mepc</b>, records the reason in <b>mcause</b>, disables interrupts, and jumps to the handler address in <b>mtvec</b>. The handler does its work and executes <span class="mono">mret</span> to return to mepc. These registers are <a href="#/ref/csrs">control and status registers</a> (CSRs).'),
      miniSim({
        title: 'Timer interrupts', views: ['insn', 'csrs', 'console'], rate: 800,
        source: EXAMPLES.find(e => e.id === 'timer')?.source ?? '',
        caption: 'Press play: the timer fires every 5000 instructions. Pause and step near a tick to watch mepc and mcause (0x80000007: interrupt, cause 7 = machine timer).',
      }),
      P('Interrupts are <b>precise</b>: every instruction before the trapping point has completed and none after it has started, so the handler can resume the program as if nothing happened. In the pipeline that means flushing the younger instructions in flight — the pipeline engine on this site does exactly that.'),
      quiz({ id: 'trap-1', q: 'A handler for <span class="mono">ecall</span> returns with mret. What must it do first, or the program will loop forever?', options: ['Clear mcause', 'Add 4 to mepc', 'Re-enable interrupts', 'Nothing'], answer: 1, explain: 'For exceptions, mepc points at the instruction that trapped. Returning there would execute the ecall again, so the handler skips it by adding 4.' }),
    ],
  },
];
