# RISC-V, Gate by Gate — Project Plan

An educational web app showing how a RISC-V CPU works at a low level:
a guided tour, a lab with a programmable simulator and assembler, a datapath view with an
**abstraction slider** that goes from the whole system down to logic gates, and an instruction
reference with formal semantics.

**Constraints:** TypeScript 7, Vite, no runtime dependencies. The only dev dependencies are
`vite` and `typescript`. Tests run on Node's built-in `node:test`, so there is no Vitest.
Fonts come from system font stacks, so there are no Google Fonts either.

---

## 1. Core architectural idea: one ISA spec drives everything

The biggest risk in a project like this is five components that each hold their own idea of
what `sltiu` does: assembler, decoder, simulator, reference docs and datapath control unit.
To avoid this, a single **declarative instruction table** is the source of truth:

```ts
// src/isa/spec/rv32i.ts (sketch)
insn({
  mnemonic: 'lw', ext: 'I', format: 'I',
  match: { opcode: 0b0000011, funct3: 0b010 },
  syntax: 'rd, offset(rs1)',
  summary: 'Load word',
  semantics: s => s.setX(s.rd, s.load(32, s.add(s.X(s.rs1), s.sext(s.imm))), /*signed*/ true),
  control: { regWrite: 1, aluSrc: 'imm', aluOp: 'add', memRead: 1, resultSrc: 'mem', immSel: 'I' },
  notes: ['Misaligned address → trap (this simulator\'s EEI choice).'],
  example: 'lw a0, 8(sp)',
})
```

The pieces derived from this table:

| Consumer | Derived from the table |
|---|---|
| Encoder / assembler | operand syntax, format, fixed bit fields |
| Decoder / disassembler | match/mask table, built into a decode trie on opcode→funct3→funct7 |
| Fast ISA executor | `semantics` AST compiled to JS closures once at startup (no `eval`) |
| Formal semantics | the same AST pretty-printed as MathML (inference rules and state-update notation) |
| Datapath control unit | `control` column, which gives the main decoder's truth table |
| Reference page | every field |
| Editor | completions, signature help, hover cards |

**Semantics DSL.** A tiny typed expression AST over bit-vectors: `X(r)`, `pc`, `imm`, `add/sub/and/or/xor`,
`shl/shr/sra`, `ltS/ltU`, `sext/zext`, `slice(hi,lo)`, `load(width)`, `store(width)`, `ite`,
`setX`, `setPC`, `trap(cause)`. It has three back-ends:
1. **Closure compiler** that produces a fast executor.
2. **Reference interpreter**: slow and obviously correct, used only in tests.
3. **MathML renderer**: MathML Core works natively in all evergreen browsers, so KaTeX isn't needed.

Tests run a differential fuzz: back-ends 1 and 2 and the hardware model (§4) must agree on random states.

---

## 2. Scope

**ISA:** RV32I (all 37 unprivileged instructions plus `fence`, `ecall`, `ebreak`) and the **M** extension
(mul/div/rem, with the spec's div-by-zero and overflow results). A minimal **Zicsr** covers the `cycle`/`instret`
counters, with `mstatus`/`mtvec`/`mepc`/`mcause` as a stretch goal (machine-mode traps).
Not in scope: C, A, F/D and virtual memory.

**Environment (EEI):**
- Sparse paged memory: `Map<pageNo, Uint8Array(4096)>`, little-endian.
- Memory map:

  | Region | Address |
  |---|---|
  | `.text` | `0x0000_0000` |
  | `.data` | `0x1000_0000` |
  | stack top (`sp`) | `0x7FFF_FFF0` |
  | MMIO console | `0xFFFF_0000` |
  | framebuffer (64×64, RGB332) | `0xFF00_0000` |

- `ecall` syscalls use a RARS-compatible numbering: 1 print_int, 4 print_string, 5 read_int,
  10 exit, 11 print_char, 12 read_char, 30 time, 42 rand_int. Linux-style `64 write` and `93 exit` are also supported.
- Misaligned loads and stores trap. The spec allows either behaviour, and trapping keeps the hardware model honest.
- The diagram draws separate IMem and DMem, as a Harvard view, but they share one backing store.
  The UI says this explicitly.

---

## 3. Application structure

The app is a hash-routed single-page app with four areas:

1. **Learn**: a scrollytelling guided tour. Chapters embed live mini-widgets that use the same engine.
2. **Lab**: the IDE and simulator. This is the main workspace.
3. **Datapath**: the full-screen CPU view with the abstraction slider. It is also a dockable panel inside the Lab.
4. **Reference**: the instruction reference, notation guide, formats, ABI and memory map.

### 3.1 Source layout
```
src/
  isa/        spec/ (rv32i.ts, rv32m.ts, zicsr.ts), formats.ts, regs.ts (ABI names),
              dsl/ (ast.ts, compile.ts, interp.ts, mathml.ts), decode.ts
  asm/        lexer.ts (shared with the editor highlighter), parser.ts, expr.ts,
              directives.ts, pseudo.ts, layout.ts (sections/symbols), encode.ts,
              assembler.ts, disasm.ts, diagnostics.ts, sourcemap.ts
  sim/        state.ts (Int32Array regs, pc, csrs), memory.ts, devices/ (console, framebuffer,
              timer), syscalls.ts, executor.ts, history.ts (reverse-step journal), runner.ts
  hw/         netlist core: signal.ts, module.ts, eval.ts (levelized + event-driven),
              gates.ts, lib/ (mux, decoder, adders, shifter, comparator, alu, regfile,
              immgen, control, pc, muldiv, dff), cpu/ (single-cycle.ts, pipeline5.ts)
  viz/        canvas/ (scene graph, camera, hit-test, text cache), wires.ts (routing + pulses),
              lod.ts (abstraction levels), layouts/ (hand-authored per module),
              waveform.ts, bitfield.ts, pipeline-chart.ts, theme.ts
  editor/     editor.ts (textarea overlay), highlight.ts, gutter.ts, completion.ts,
              hover.ts, diagnostics.ts, commands.ts
  ui/         reactive.ts (~150 LOC signals/effects), h.ts (DOM helper), router.ts,
              components/ (split panes, tabs, slider, tooltip, toast, kbd shortcuts)
  content/    chapters/*.ts, examples/*.s (imported via ?raw)
  reference/  page generator
  styles/     tokens.css (colors, spacing, type), base.css, per-area CSS
tests/        *.test.ts run by `node --test` (Node 24 strips types natively)
```

### 3.2 Framework-free UI
- `reactive.ts`: signals, computed values, effects and batching (about 150 LOC).
  UI components are plain functions that return DOM nodes.
- Hot paths such as the canvas, register flashes and memory views bypass reactivity.
  They draw on `requestAnimationFrame` from a dirty flag.
- The simulator runs **on the main thread** for step and visual modes. **Turbo run** moves to a Web Worker
  (Vite supports `new Worker(new URL(...), {type:'module'})` with no deps) and posts a state snapshot every
  ~50 ms. This keeps the UI responsive during infinite loops, and a **Stop** button always works.

### 3.3 TypeScript 7 configuration notes
- `tsc` is now the native compiler. Vite transpiles on its own, so `npm run check` runs `tsc --noEmit` as a separate type-check.
- Settings: `strict`, `moduleResolution: "bundler"`, `module: "esnext"`, `verbatimModuleSyntax`, and
  **`erasableSyntaxOnly`**. The last one rules out enums and parameter properties, so the same `.ts` files run
  unmodified under Node's type stripping for tests. Use `as const` objects in place of enums.
- `baseUrl`, `moduleResolution: node10` and ES5 targets are removed in TS 7, so none of them are used.

---

## 4. Hardware model and the abstraction slider

This is the most novel and riskiest part of the project, so it gets the most design.

### 4.1 Hierarchical netlist with dual models
Every hardware module has:
- **Ports**: named, with fixed bit widths.
- **`behave(inputs) → outputs`**: fast, word-level TypeScript.
- **`structure()`** (optional): submodule instances and the wires between them, down to primitive gates
  (`NOT AND OR XOR NAND NOR`, `DFF`).

At any moment each module instance is either *collapsed*, evaluated with `behave`, or *expanded*,
evaluated through its structure. The netlist evaluator sorts the expanded region topologically (levelizes it)
and evaluates it. If the evaluator finds a combinational loop, that is a bug and it throws.

**Invariant:** for any input, expanded evaluation equals `behave`. A property test checks this for every module
with random vectors. At runtime the UI shows a small "✓ gate model agrees" badge, which turns red if a
student-modifiable module (stretch goal) disagrees.

The CPU model is cycle-based. On each clock edge the DFFs and registers latch, then combinational logic settles.
Architectural state (regs, pc, memory) is **shared with the ISA simulator**, so the user can switch between
turbo ISA mode and hardware mode at any instruction boundary. When entering the pipeline model, the pipeline starts empty at `pc`.

### 4.2 Abstraction levels (slider stops)

| Level | Name | What you see | Evaluated with |
|---|---|---|---|
| 0 | **System** | CPU ↔ bus ↔ RAM / console / framebuffer, with bus transactions animated | ISA sim |
| 1 | **Block** | Patterson & Hennessy-style datapath: PC, IMem, RegFile, ImmGen, ALU, DMem, Control, muxes, with buses labelled in hex | module `behave` |
| 2 | **RTL** | Blocks opened into components. ALU becomes adder, shifter, comparators, logic unit and result mux. RegFile becomes a 5→32 decoder, 32 registers and 32:1 read muxes. Control becomes decoder tables | expanded one level |
| 3 | **Gate** | Primitive gates with wires coloured by logic value | full structure of the *focused* module |
| (4) | *Transistor* | Easter egg: CMOS NAND/NOT for a single selected gate, with conducting paths lit | analytic |

**Semantic zoom.** The slider moves continuously. Between stops, a block cross-fades and scales into its internals,
and wires morph between their collapsed and expanded routes. Camera zoom is linked to the slider: scrolling in on
a block past a threshold advances its level, which is "click to dive". A breadcrumb shows the path, for example
`CPU › ALU › Adder › bit 7 › Full adder`.

**Keeping gate level legible.** A full RV32I netlist has tens of thousands of gates, which is useless on screen. Three rules keep it readable:
- Only the **focused** module is expanded to gates. Everything else stays at block or RTL level as context.
- 32-bit regular structures are shown as a **bit-slice view**. One slice is fully drawn, with a bit selector (0–31)
  and ghosted stacked slices behind it. Carry-chains and similar lines are drawn across slices.
- Wide arithmetic that would be enormous at gate level (the multiplier and divider) expands to RTL
  (shift-add / restoring division) in the CPU. It gets gate level only in a **4-bit teaching instance**.

### 4.3 Timing and propagation
- In **visual step mode**, each clock edge launches a **wavefront**. Signals light up in topological order,
  and the delay is proportional to logic depth. The user *sees* the critical path. For example, `lw` visibly takes
  the longest route through ALU → DMem → mux.
- At gate level, an **event-driven unit-delay simulation** shows glitches and the carry rippling through a
  ripple-carry adder. A toggle swaps in a carry-lookahead adder, and the depth counter drops.
  This is a good "why hardware design matters" moment.
- Stepping granularities: **instruction**, **clock cycle**, **half-cycle** (edge then settle) and
  **gate delta** (gate level only).

### 4.4 CPU models
1. **Single-cycle** (first). The block-level layout closely follows the P&H figure, which students will recognise.
2. **5-stage pipeline** (IF/ID/EX/MEM/WB): pipeline registers, a forwarding unit, a hazard-detection unit
   (load-use stall), and branch resolution in EX with flush. It comes with a **pipeline chart** (rows are instructions,
   columns are cycles), with bubbles and forwarding arrows drawn on the chart.
   Its correctness criterion is the same retired architectural state as the ISA sim (differential test).

### 4.5 Rendering
- **Canvas 2D** with a small retained scene graph, not SVG. At gate level there are thousands of animated elements
  (value-coloured wires, travelling pulses, glow) at 60 fps. Hit-testing is manual, using per-layer spatial hashing.
  Text is cached as bitmaps per zoom bucket. Rendering is DPR-aware.
- **Layouts**: levels 0–2 are hand-authored coordinates and orthogonal wire waypoints in `viz/layouts/*.ts`,
  because auto-layout of schematics looks bad. Gate-level layouts for regular structures (adders, muxes, decoders,
  register bits) are **generated procedurally**.
- **Interaction**:
  - Hovering a wire shows its value in hex, signed decimal, unsigned decimal and binary.
  - Clicking a wire pins it to the **waveform viewer** (a GTKWave-like strip under the datapath).
  - Hovering a block shows what it does and which control signals drive it.
  - Unused paths for the current instruction are dimmed. For example, DMem is dimmed for `add`.
- **Accessibility**: `prefers-reduced-motion` turns off pulses and wavefronts. Values are shown by brightness and
  dash pattern, not only hue. A text "datapath narration" region describes each cycle for screen readers.

---

## 5. Assembler

It is GNU-`as`-compatible in syntax, so real-world snippets paste in and work.

- **Lexer**: a single shared tokenizer, also used by the editor highlighter, so highlighting and parsing never disagree.
- **Syntax**: labels, numeric local labels (`1:` … `1b`/`1f`), comments (`#`, `//`, `/* */`),
  ABI and numeric register names (`a0`, `x10`, `fp`), and char, string and escape literals.
- **Expressions**: `+ - * / % << >> & | ^ ~`, parentheses, symbols, `.`, and relocation operators
  `%hi()`, `%lo()`, `%pcrel_hi()` and `%pcrel_lo()`. These use the correct `+0x800` rounding for `lui`/`addi` pairs,
  and the reference explains the trick.
- **Directives**:
  - sections: `.text`, `.data`, `.rodata`, `.bss`, `.section`
  - data: `.byte`, `.half`, `.word`, `.dword`, `.ascii`, `.asciz`/`.string`, `.space`/`.zero`
  - alignment: `.align`/`.p2align`/`.balign`
  - symbols: `.globl`, `.equ`/`.set`
  - macros (stretch): `.macro`/`.endm`
- **Pseudo-instructions**: `nop li la mv not neg negw seqz snez sltz sgtz beqz bnez blez bgez bltz bgtz bgt ble
  bgtu bleu j jal(1-op) jr jalr(1-op) ret call tail csrr csrw csrs csrc rdcycle rdinstret`.
  `li` picks the shortest expansion (1 or 2 instructions). The **listing view shows each expansion**.
- **Two passes**:
  1. Parse, place items into sections, collect symbols, and fix sizes. Pseudo-instruction sizes are resolved
     iteratively when they depend on forward symbols.
  2. Evaluate expressions, range-check immediates, and encode.
- **Diagnostics**: exact source ranges, a severity level, and helpful messages, for example
  `immediate 5000 out of range for addi (−2048…2047) — did you mean li?`.
- **Source map**: each address maps back to a line, and each line to its addresses. This drives PC highlighting,
  breakpoints and the listing.
- **Output**: section images plus a symbol table (not ELF). An **ELF32 loader** is a stretch goal, so output from a
  real toolchain can be dropped in.
- **Disassembler**: the inverse, built from the same spec. Options cover ABI or numeric register names and
  pseudo-instruction reconstruction (`addi a0,zero,5` → `li a0,5`).

---

## 6. Lab (simulator and IDE)

### 6.1 Editor (hand-built, no CodeMirror)
- The editor is a **transparent `<textarea>` layered over a highlighted `<pre>`**, with identical font metrics
  and caret colour kept visible. This keeps native IME, selection, accessibility and undo.
  Programmatic edits go through `document.execCommand('insertText')` so they stay on the undo stack.
- Features:
  - **Gutter**: line numbers, click-to-toggle breakpoints, a current-PC arrow, and error and warning markers.
  - **Highlighting**: incremental re-highlight per line.
  - **Diagnostics**: squiggles and a problems list, fed by the assembler running on every edit (debounced about 150 ms).
  - **Autocomplete**: mnemonics, registers, labels and directives, with signature help from the spec.
  - **Hover**: a mini reference card for mnemonics, and resolved values for labels.
  - **Navigation**: Ctrl/⌘-click on a label to go to its definition.
  - **Commands**: format/align columns, and toggle comment.
  - **Listing column** (toggle): address and machine code next to each source line, with the encoding bit-field on hover.
- Programs persist to `localStorage` (wrapped in try/catch). Share-by-URL puts the compressed program in the hash,
  using `CompressionStream` with no deps.

### 6.2 Panels (dockable split panes)
- **Registers**: ABI name, hex, dec, and a flash on change. Click a value to edit it. Hover shows the ABI role
  (caller- or callee-saved).
- **Memory**: a hex and ASCII viewer with go-to-address, following `sp`/`pc`. Recently written bytes are highlighted,
  and bytes can be edited. A **stack view** shows frames annotated from `sp`/`fp`.
- **Disassembly**: live, around the PC.
- **Console**: MMIO/ecall output and input.
- **Framebuffer**: a 64×64 canvas.
- **Datapath**: §4.
- **Pipeline chart**: §4.4.
- **Stats**: instructions retired, cycles, CPI (in pipeline mode), and an instruction-mix histogram.

### 6.3 Controls
- Run, Pause, Step (with the granularity selector), **Step Back**, Run to cursor, Reset, and a speed slider
  (1 Hz → turbo). Breakpoints and **watchpoints** (on memory address or register).
- **Reverse execution**: a bounded journal of state deltas (register, pc and memory bytes changed per instruction).
  It is a ring buffer of about 1M entries, which allows scrubbing back through history.

### 6.4 Example programs
Hello world, sum 1..n, Fibonacci (iterative and recursive, to show the stack), bubble sort, strlen and
memcpy, integer sqrt, a Mandelbrot or plasma effect on the framebuffer, Game of Life on the framebuffer, and a tiny
Snake game (keyboard via an MMIO key register). Each example has a header comment explaining what to watch for.

**Performance targets:**
- Turbo mode runs at ≥ 20 M instr/s in the worker.
- Visual mode runs at 60 fps with the full block-level animation.
- At the gate level, the focused ALU (≈ 2–3k gates) re-evaluates in under 2 ms.

---

## 7. Instruction reference

- **Index**: filterable by extension, format and category (arithmetic, logic, shift, compare, branch, jump,
  load/store, system), plus fuzzy search.
- **Per-instruction card**:
  - **Syntax** and **assembly examples**.
  - **Encoding diagram**: 32 coloured bit cells grouped by field, with fixed bits filled in.
    Hovering a field explains it, and I-, S-, B-, U- and J-type immediate scrambling is animated to show *where each immediate bit goes*.
  - **Plain-English explanation**, then **edge cases**: overflow wraps, `x0` writes are discarded,
    `sra` vs `srl`, div-by-zero gives −1 or the dividend, `INT_MIN/−1`, and shift amounts using only the low 5 bits.
  - **Formal semantics**, rendered from the DSL in two notations:
    - *State update:* `x[rd] ← sext₃₂(M₃₂[x[rs1] + sext(imm)]);  pc ← pc + 4`
    - *Small-step operational rule*, drawn as an inference rule with premises over a horizontal line, then
      `⟨pc, R, M⟩ → ⟨pc+4, R[rd ↦ v], M⟩`.
  - **Datapath usage**: a thumbnail of the block diagram with the active paths and control-signal values lit.
    It is generated from `control`, so it cannot drift from the real control unit.
  - **"Try it"**: loads a snippet into the Lab and pre-sets registers.
- **Notation page**: bit-vectors, `sext`/`zext`, slicing `v[hi:lo]`, `<ₛ`/`<ᵤ`, `≫ₐ`/`≫ₗ`, `M_w[a]`, state tuples,
  and how to read inference rules.
- **Formats page**: R, I, S, B, U and J side by side, with the rationale (rs1, rs2 and rd are always in the same
  place, and the sign bit is always bit 31). **ABI page**: register roles and the calling convention.

---

## 8. Learn: guided tour chapters

Each chapter is a scroll-driven narrative with sticky interactive figures. The hardware figures reuse the same
netlist and renderer at a fixed abstraction level, so "what you learned" and "what's in the CPU" are literally the same objects.

1. **What a CPU does**: fetch → decode → execute, animated at system level.
2. **Bits and gates**: toggleable inputs, truth tables, and "build a XOR from NANDs".
3. **Arithmetic from gates**: half adder → full adder → 4-bit ripple adder, then two's complement and subtraction via invert+1.
4. **Choosing and remembering**: mux, decoder, D flip-flop, register, the clock and why edges matter.
5. **The register file and the ALU**, built from chapters 3–4.
6. **The ISA contract**: registers, instruction formats, and encoding one instruction by hand (an interactive bitfield).
7. **The single-cycle datapath**: tracing `add`, `addi`, `lw`, `sw`, `beq` and `jal` one at a time.
8. **Control**: how opcode bits become control signals (the truth table is generated from the spec).
9. **From text to bits**: the assembler's passes, labels, pseudo-instructions and the `%hi`/`%lo` trick.
10. **Calling functions**: the stack, `ra`, and the ABI, stepped through recursive Fibonacci.
11. **Going faster**: pipelining, hazards, forwarding and stalls, with the pipeline chart.
12. **Talking to the world**: MMIO, the console, the framebuffer. This chapter ends by sending the reader to the Lab.

Small "predict, then reveal" quizzes are embedded, for example "what value will the ALU output?". Progress is
stored locally.

---

## 9. Visual design direction

- **Dark theme ("night blueprint")**: deep ink background, hairline grid, and components drawn as crisp outlined shapes.
  Signal classes have their own colours: **data** is cyan, **control** is amber, **address** is violet, and the **clock** is white.
  Logic 1 is bright with a soft glow, and logic 0 is dim. Multi-bit buses are thicker and carry hex value chips.
- **Light theme ("datasheet paper")** uses the same tokens for print-like clarity. Both are defined as CSS custom
  properties on `:root`, and the canvas reads the tokens.
- **Type**: `system-ui` for prose and `ui-monospace` / SF Mono for code and values, with tabular numerals everywhere.
- **Motion**: every clock edge has a short, meaningful animation (wavefront, register flash, memory write ripple).
  There is no decorative motion, and all of it respects reduced-motion.
- **Layout**: the Lab is responsive with split panes. On mobile the panes become tabs, and the datapath gets pinch-zoom.

---

## 10. Testing strategy (`node --test`, zero deps)

- **Encoding golden tests**: a table of `asm text → expected 32-bit word` for every instruction and edge immediate,
  hand-verified against the spec. If a local `riscv64-*-as` happens to be installed, a script regenerates and
  cross-checks the goldens. This is optional and not a dependency.
- **Round-trip property**: assemble → disassemble → assemble produces the same words.
- **Semantics differential fuzzing**: compiled closures, the reference interpreter, single-cycle HW and the
  pipelined HW must reach identical architectural state on random instruction streams.
- **Module equivalence**: for every hardware module, `behave` equals the expanded structure on random and edge vectors.
- **Self-checking programs**: a port of a subset of the official `riscv-tests` rv32ui/rv32um (BSD-licensed, with macros
  inlined), run in all execution modes.
- **Assembler diagnostics**: snapshot tests of error messages and source ranges.
- **Perf smoke test**: turbo mode on a tight loop meets the MIPS target.
- A small hand-rolled `browser-check` page runs the UI invariants in dev (for example, the editor overlay alignment).

---

## 11. Milestones

Each milestone ends in something runnable and demoable.

| # | Milestone | Deliverable / definition of done |
|---|---|---|
| M0 | **Scaffold** | Vite and TS 7 configured, `check`/`test`/`dev`/`build` scripts, design tokens, `reactive.ts`, `h.ts`, router, and an app shell with 4 empty areas |
| M1 | **ISA core** | Spec table (RV32IM), semantics DSL with its three back-ends, decoder, memory, devices, syscalls, executor, and the reverse-step journal. Differential and golden tests green |
| M2 | **Assembler** | Full assembler and disassembler, diagnostics and source maps. Round-trip and golden tests green. riscv-tests subset passes |
| M3 | **Lab v1** | Editor with highlighting, diagnostics, completion and hover. Register, memory, console and disassembly panels. Run, step, back and breakpoints. Examples load. Turbo worker |
| M4 | **Reference** | All instruction cards with encoding diagrams, MathML semantics, notation, formats and ABI pages. "Try it" links into the Lab |
| M5 | **Datapath: blocks** | Netlist core and single-cycle CPU at block level. Canvas renderer, animated wavefront, wire hover, waveform viewer, and the Lab dock |
| M6 | **Abstraction slider** | System, RTL and gate levels, semantic zoom with morphing, bit-slice view, focus and breadcrumbs, gate-delta stepping, the CLA toggle, and the equivalence badge |
| M7 | **Pipeline** | 5-stage model with its view, the pipeline chart, and hazard and forwarding visualisation. Differential tests green |
| M8 | **Learn** | The 12 chapters with embedded widgets and quizzes |
| M9 | **Polish** | Framebuffer and keyboard MMIO games, share links, mobile layout, accessibility pass, performance tuning, and the transistor easter egg |

**Critical path:** M1 → M2 → M3 comes first, because it gives a working tool early. M4 can run in parallel after M1.
M5 → M6 is the riskiest part, so a **time-boxed spike during M1** should confirm that canvas semantic zoom plus the
levelized evaluator feel good (the ALU alone, expanded to gates). The expected size is about 15–20k LOC of TypeScript,
most of it in the hardware layouts and the Lab UI.

---

## 12. Decisions and open questions

These are the defaults chosen. Any of them can be changed.

1. **Execution model:** a spec-driven ISA sim plus a separate structural hardware model, kept in lockstep through
   shared architectural state. This is instead of running the gate-level CPU as the simulator, which would be too slow and too big.
2. **Gate level shows only the focused module, in a bit-slice view.** Showing a full-CPU gate soup was ruled out.
3. **Canvas 2D** for the datapath, and DOM/SVG for everything else (bitfields and diagrams in the reference).
4. **Misaligned access traps.** Syscalls use the **RARS numbering** plus Linux `write`/`exit`.
5. **Single-cycle first, pipeline in M7.** A multi-cycle (FSM-controlled) model is optional. It is pedagogically
   nice, but it would be a third CPU to lay out by hand.
6. **Open:**
   - Should students be able to *edit* hardware? For example, rewire the ALU or write a module in a mini-HDL and watch the equivalence badge.
     This would be a strong addition but a large one, so it is proposed as post-M9.
   - Is a machine-mode trap and interrupt chapter wanted, with a timer interrupt driving the framebuffer?
   - Is English the only language? Content lives in TS modules either way, so i18n could be added later.
