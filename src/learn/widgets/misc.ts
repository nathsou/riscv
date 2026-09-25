/** Smaller chapter widgets: fetch–decode–execute, the encoder, the assembler explorer, the control table. */
import { h, replace } from '../../ui/h.ts';
import { icon } from '../../ui/icons.ts';
import { onCleanup } from '../../ui/reactive.ts';
import { Machine } from '../../sim/machine.ts';
import { assemble } from '../../asm/assembler.ts';
import { disassemble } from '../../asm/disasm.ts';
import { decode } from '../../isa/decode.ts';
import { FORMAT_FIELDS } from '../../isa/formats.ts';
import { bitfield } from '../../ui/components/bitfield.ts';
import { INSTRUCTIONS, CATEGORY_LABELS } from '../../isa/spec/index.ts';
import { CONTROL_FIELDS, IMMSEL_NAMES, ASEL_NAMES, BRTYPE_NAMES, WBSEL_NAMES, SYS_NAMES } from '../../hw/lib/control.ts';
import { ALU_OP_NAMES } from '../../hw/lib/alu.ts';
import { ABI_NAMES } from '../../isa/regs.ts';
import { highlightLine } from '../../editor/highlight.ts';

const hex8 = (v: number) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// ------------------------------------------------------------------ fetch / decode / execute
export function fdeWidget(): HTMLElement {
  const src = `main:
    li   t0, 0
    li   t1, 5
loop:
    addi t0, t0, 1
    blt  t0, t1, loop
    ebreak
`;
  const r = assemble(src);
  const m = new Machine(1 << 12);
  m.loadProgram(r.image);
  const phases = ['Fetch', 'Decode', 'Execute'] as const;
  let phase = 0;
  const svg = h('div', { class: 'fde', html: `
  <svg viewBox="0 0 760 250" role="img" aria-label="Fetch, decode, execute">
    <rect class="box mem" x="20" y="20" width="230" height="210" rx="12"/><text class="ttl" x="40" y="46">Memory</text>
    <g id="memrows"></g>
    <rect class="box cpu" x="360" y="20" width="380" height="210" rx="12"/><text class="ttl" x="380" y="46">CPU</text>
    <rect class="reg" id="pcbox" x="380" y="62" width="120" height="40" rx="6"/><text class="lbl" x="390" y="78">PC</text><text class="val" id="pcval" x="440" y="92"></text>
    <rect class="reg" id="irbox" x="520" y="62" width="200" height="40" rx="6"/><text class="lbl" x="530" y="78">Instruction</text><text class="val" id="irval" x="620" y="92"></text>
    <rect class="reg" id="decbox" x="380" y="118" width="340" height="44" rx="6"/><text class="lbl" x="390" y="134">Decoded</text><text class="val" id="decval" x="550" y="150"></text>
    <rect class="reg" id="exbox" x="380" y="176" width="340" height="40" rx="6"/><text class="lbl" x="390" y="192">Effect</text><text class="val" id="exval" x="550" y="206"></text>
    <path class="bus" id="addrbus" d="M380 82H300V110H250"/>
    <path class="bus" id="databus" d="M250 130H320V82H520"/>
    <text class="bl" x="290" y="102">address</text><text class="bl" x="322" y="146">data</text>
  </svg>` });
  const phaseEls = phases.map(p => h('span', { class: 'fde-ph' }, p));
  const stepBtn = h('button', { class: 'btn small' }, icon('step'), 'Next phase');
  const playBtn = h('button', { class: 'btn small primary' }, icon('play'), 'Play');
  const resetBtn = h('button', { class: 'btn small ghost' }, icon('reset'), 'Reset');
  const root = svg.firstElementChild as SVGSVGElement;
  const $ = (id: string) => root.getElementById(id) as SVGElement;
  let lastEffect = '';
  const render = () => {
    const pc = m.pc;
    const w = m.peekLoad(pc, 4) >>> 0;
    phaseEls.forEach((e, i) => e.classList.toggle('on', i === phase));
    const rows = $('memrows');
    rows.replaceChildren();
    for (let i = 0; i < 6; i++) {
      const a = i * 4;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '40'); t.setAttribute('y', String(76 + i * 26));
      t.setAttribute('class', `mrow ${a === pc && phase === 0 ? 'hot' : a === pc ? 'cur' : ''}`);
      t.textContent = `${hex8(a).slice(6)}  ${hex8(m.peekLoad(a, 4)).slice(2)}`;
      rows.append(t);
    }
    $('pcval').textContent = hex8(pc);
    $('irval').textContent = phase >= 0 ? hex8(w) : '';
    const d = decode(w | 0);
    $('decval').textContent = phase >= 1 && d ? `${disassemble(w, pc).text}   (${d.spec.format}-type)` : '';
    $('exval').textContent = phase >= 2 ? lastEffect : '';
    root.classList.toggle('p0', phase === 0); root.classList.toggle('p1', phase === 1); root.classList.toggle('p2', phase === 2);
  };
  const next = () => {
    if (m.status !== 'ready') { m.loadProgram(r.image); phase = 0; lastEffect = ''; render(); return; }
    if (phase < 2) {
      phase++;
      if (phase === 2) {
        const before = Int32Array.from(m.x), pc = m.pc;
        m.step();
        const ch = [...m.x].map((v, i) => [i, v] as const).filter(([i, v]) => v !== before[i]);
        const jump = m.pc !== pc + 4 ? `, pc ← ${hex8(m.pc)}` : ', pc ← pc + 4';
        lastEffect = ch.length ? ch.map(([i, v]) => `${ABI_NAMES[i]} ← ${v}`).join(', ') + jump : (m.status as string) === 'break' ? 'ebreak: stop' : jump.slice(2);
        // show the executed instruction's state until the next fetch
        $('pcval').textContent = hex8(pc);
        phaseEls.forEach((e, i) => e.classList.toggle('on', i === 2));
        $('exval').textContent = lastEffect;
        root.classList.remove('p0', 'p1'); root.classList.add('p2');
        return;
      }
    } else phase = 0;
    render();
  };
  let timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; replace(playBtn, icon('play'), 'Play'); };
  playBtn.addEventListener('click', () => {
    if (timer) { stop(); return; }
    timer = window.setInterval(next, 900);
    replace(playBtn, icon('pause'), 'Pause');
  });
  stepBtn.addEventListener('click', () => { stop(); next(); });
  resetBtn.addEventListener('click', () => { stop(); m.loadProgram(r.image); phase = 0; lastEffect = ''; render(); });
  onCleanup(stop);
  render();
  return h('figure', { class: 'widget' }, h('div', { class: 'ms-bar' }, playBtn, stepBtn, resetBtn, h('span', { class: 'spacer' }), ...phaseEls), svg,
    h('figcaption', null, 'A program that counts to 5. Every instruction goes through the same three phases, forever.'));
}

// ------------------------------------------------------------------ encoder
const FIELD_MEANING: Record<string, string> = {
  opcode: 'major opcode: the instruction family', rd: 'destination register', rs1: 'first source register', rs2: 'second source register',
  funct3: 'selects the operation within the family', funct7: 'further selects the operation (e.g. add vs sub)',
};

export function encoderWidget(initial = 'addi a0, a0, 5'): HTMLElement {
  const input = h('input', { class: 'input enc-in mono', value: initial, 'aria-label': 'Instruction to encode', spellcheck: false });
  const out = h('div', { class: 'enc-out' });
  const render = () => {
    const line = input.value.trim();
    const r = assemble(`${line}\n`);
    if (!r.ok) { replace(out, h('p', { class: 'err' }, r.diagnostics[0]?.message ?? 'Cannot assemble')); return; }
    const t = r.image.segments.find(s => s.name === '.text');
    if (!t || t.bytes.length < 4) { replace(out, h('p', { class: 'dim' }, 'Type an instruction, e.g. sw t0, 8(sp)')); return; }
    const w = (t.bytes[0] | (t.bytes[1] << 8) | (t.bytes[2] << 16) | (t.bytes[3] << 24)) >>> 0;
    const d = decode(w | 0)!;
    const fields = FORMAT_FIELDS[d.spec.format];
    const extra = t.bytes.length > 4 ? h('p', { class: 'dim small' }, `This is a pseudo-instruction: it expands to ${t.bytes.length / 4} instructions; the first is shown.`) : null;
    replace(out,
      h('div', { class: 'enc-words' }, h('span', { class: 'mono big' }, hex8(w)), h('span', { class: 'mono dim' }, (w >>> 0).toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim())),
      bitfield(d.spec, { word: w, showBitNumbers: true }),
      h('table', { class: 'ref-table enc-table' }, h('tbody', null, ...fields.map(f => {
        const v = (w >>> f.lo) & ((1 << (f.hi - f.lo + 1)) - 1);
        const base = f.name.replace(/\[.*$/, '');
        const meaning = f.kind === 'imm' ? 'immediate bits' : FIELD_MEANING[base] ?? '';
        const shown = f.kind === 'rd' || f.kind === 'rs1' || f.kind === 'rs2' ? `x${v} (${ABI_NAMES[v]})` : (f.hi - f.lo < 8 ? v.toString(2).padStart(f.hi - f.lo + 1, '0') : '0x' + v.toString(16));
        return h('tr', null, h('td', { class: 'mono' }, f.name), h('td', { class: 'mono dim' }, `${f.hi}:${f.lo}`), h('td', { class: 'mono' }, shown), h('td', { class: 'dim' }, meaning));
      }))),
      d.spec.format !== 'R' && d.spec.format !== 'SYS' ? h('p', { class: 'dim small' }, `Immediate value: ${d.imm}`) : null,
      extra);
  };
  input.addEventListener('input', render);
  render();
  return h('figure', { class: 'widget enc' }, h('label', { class: 'enc-label' }, 'Instruction', input), out,
    h('figcaption', null, 'Edit the instruction: try changing a register, the immediate, or the mnemonic (sub, lw, beq x0, x0, 8…).'));
}

// ------------------------------------------------------------------ assembler explorer
export function asmExplorer(initial: string): HTMLElement {
  const ta = h('textarea', { class: 'ax-src mono', spellcheck: false, rows: String(Math.min(16, initial.split('\n').length + 1)), 'aria-label': 'Assembly source' });
  ta.value = initial;
  const listing = h('div', { class: 'ax-out' });
  const render = () => {
    const r = assemble(ta.value);
    const lines = ta.value.split('\n');
    if (!r.ok) {
      replace(listing, ...r.diagnostics.filter(d => d.severity === 'error').slice(0, 4).map(d => h('p', { class: 'err' }, `line ${d.line + 1}: ${d.message}`)));
      return;
    }
    const rows = r.listing.map(e => {
      const srcLine = lines[e.line] ?? '';
      const code = e.isData ? e.words.map(w => w.toString(16).padStart(2, '0')).join(' ').slice(0, 24) : e.words.map(w => hex8(w).slice(2)).join(' ');
      return h('tr', { class: e.isData ? 'data' : '' },
        h('td', { class: 'mono dim' }, hex8(e.addr).slice(2)), h('td', { class: 'mono code' }, code),
        h('td', { class: 'mono', html: highlightLine(srcLine.replace(/#.*/, '').trim(), false).html }),
        h('td', { class: 'mono dim small' }, e.asm.length > 1 || (e.asm.length === 1 && e.asm[0].split(' ')[0] !== srcLine.trim().split(/\s+/)[0]) ? e.asm.join('; ') : ''));
    });
    const syms = [...r.symbols].filter(([k]) => !/^\d/.test(k)).map(([k, v]) => h('span', { class: 'sym mono' }, `${k} = ${hex8(v.value)}`));
    replace(listing,
      h('table', { class: 'ref-table ax-table' }, h('thead', null, h('tr', null, h('th', null, 'Address'), h('th', null, 'Machine code'), h('th', null, 'Source'), h('th', null, 'Expansion'))), h('tbody', null, ...rows)),
      h('div', { class: 'ax-syms' }, h('b', null, 'Symbols: '), ...syms));
  };
  ta.addEventListener('input', render);
  render();
  return h('figure', { class: 'widget ax' }, h('div', { class: 'ax-grid' }, ta, listing),
    h('figcaption', null, 'Edit the program on the left; the listing shows what the assembler produced for each line.'));
}

// ------------------------------------------------------------------ control table
const DECODE: Record<string, (v: number) => string> = {
  immSel: v => IMMSEL_NAMES[v], aSel: v => ASEL_NAMES[v], bSel: v => (v ? 'imm' : 'rs2'), aluOp: v => ALU_OP_NAMES[v],
  brType: v => BRTYPE_NAMES[v], wbSel: v => WBSEL_NAMES[v], csrOp: v => ['—', 'rw', 'rs', 'rc'][v], sys: v => SYS_NAMES[v],
};

export function controlTable(filter?: string[]): HTMLElement {
  const specs = INSTRUCTIONS.filter(s => !filter || filter.includes(s.mnemonic));
  const head = h('tr', null, h('th', null, 'Instruction'), ...CONTROL_FIELDS.map(f => h('th', { title: f.doc }, f.name)));
  const rows = specs.map(s => h('tr', { title: `${s.mnemonic}: ${s.summary} (${CATEGORY_LABELS[s.category]})` },
    h('td', { class: 'mono mn' }, s.mnemonic),
    ...CONTROL_FIELDS.map(f => {
      const v = f.enc(s.control);
      const t = DECODE[f.name]?.(v) ?? String(v);
      return h('td', { class: `mono ${v === 0 && f.width === 1 ? 'z' : ''} ${f.width === 1 && v ? 'one' : ''}` }, f.width === 1 ? (v ? '1' : '·') : (v === 0 && ['brType', 'csrOp', 'sys'].includes(f.name) ? '·' : t));
    })));
  return h('figure', { class: 'widget ctl-wrap' }, h('div', { class: 'ctl-scroll' }, h('table', { class: 'ctl-big' }, h('thead', null, head), h('tbody', null, ...rows))),
    h('figcaption', null, 'Generated from the instruction table, the same data that builds the control unit. A dot is 0 (or “don’t care”).'));
}
