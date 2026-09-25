/** One instruction's reference card. */
import { h } from '../ui/h.ts';
import { icon } from '../ui/icons.ts';
import { bitfield } from '../ui/components/bitfield.ts';
import type { InsnSpec } from '../isa/spec/index.ts';
import { INSTRUCTIONS, CATEGORY_LABELS } from '../isa/spec/index.ts';
import { stateUpdateMath, inferenceRules } from '../isa/dsl/mathml.ts';
import { FORMAT_FIELDS } from '../isa/formats.ts';
import { CONTROL_FIELDS, IMMSEL_NAMES, ASEL_NAMES, BRTYPE_NAMES, WBSEL_NAMES, SYS_NAMES } from '../hw/lib/control.ts';
import { ALU_OP_NAMES } from '../hw/lib/alu.ts';
import { immDiagram } from './immdiagram.ts';
import { datapathThumb } from './thumb.ts';
import { tryItProgram } from './tryit.ts';
import { codeBlock } from './code.ts';
import { loadIntoLab } from './lab-link.ts';

const OPERAND_TEXT: Record<string, string> = {
  rd: 'rd', rs1: 'rs1', rs2: 'rs2', imm12: 'imm', shamt: 'shamt', mem: 'offset(rs1)', branch: 'label', jump: 'label',
  uimm20: 'imm20', csr: 'csr', zimm: 'uimm5', fence: 'pred, succ',
};

export function syntaxOf(spec: InsnSpec): string {
  return `${spec.mnemonic}${spec.operands.length ? ' ' + spec.operands.map(o => OPERAND_TEXT[o]).join(', ') : ''}`;
}

const FORMAT_NAMES: Record<string, string> = {
  R: 'R-type', I: 'I-type', Ish: 'I-type (shift)', S: 'S-type', B: 'B-type', U: 'U-type', J: 'J-type',
  CSR: 'I-type (CSR)', CSRI: 'I-type (CSR, imm)', SYS: 'I-type (system)', FENCE: 'I-type (fence)',
};

const DECODE: Record<string, (v: number) => string> = {
  immSel: v => IMMSEL_NAMES[v] ?? '?', aSel: v => ASEL_NAMES[v] ?? '?', bSel: v => (v ? 'imm' : 'rs2'),
  aluOp: v => ALU_OP_NAMES[v] ?? '?', brType: v => BRTYPE_NAMES[v] ?? '?', wbSel: v => WBSEL_NAMES[v] ?? '?',
  csrOp: v => ['none', 'rw', 'rs', 'rc'][v] ?? '?', sys: v => SYS_NAMES[v] ?? '?',
};

const bin = (v: number, n: number) => v.toString(2).padStart(n, '0');

export function instructionCard(spec: InsnSpec): HTMLElement {
  const i = INSTRUCTIONS.indexOf(spec);
  const prev = INSTRUCTIONS[i - 1], next = INSTRUCTIONS[i + 1];
  const tryBtn = h('button', { class: 'btn primary' }, icon('play'), 'Try it in the Lab');
  tryBtn.addEventListener('click', () => { const t = tryItProgram(spec); loadIntoLab(t.source, `Try it: ${spec.mnemonic}`); });

  const fixed: string[] = [`opcode = ${bin(spec.opcode, 7)}`];
  if (spec.funct3 !== undefined && FORMAT_FIELDS[spec.format].some(f => f.name === 'funct3')) fixed.push(`funct3 = ${bin(spec.funct3, 3)}`);
  if (spec.funct7 !== undefined) fixed.push(`funct7 = ${bin(spec.funct7, 7)}`);
  if (spec.fixedWord !== undefined) fixed.push(`word = 0x${(spec.fixedWord >>> 0).toString(16).padStart(8, '0')}`);

  const imm = immDiagram(spec.format);
  const rules = inferenceRules(spec);
  const ctl = CONTROL_FIELDS.map(f => {
    const v = f.enc(spec.control);
    const off = v === 0 && !['aluOp', 'immSel', 'aSel', 'wbSel'].includes(f.name);
    return h('tr', { class: off ? 'off' : '' }, h('td', null, f.name), h('td', { class: 'v' }, DECODE[f.name]?.(v) ?? String(v)), h('td', { class: 'm' }, f.doc));
  });

  return h('article', { class: 'card insn-card' },
    h('header', { class: 'card-head' },
      h('div', null,
        h('div', { class: 'badges' },
          h('span', { class: `badge ext-${spec.ext}` }, spec.ext), h('span', { class: 'badge' }, FORMAT_NAMES[spec.format]),
          h('span', { class: `badge cat-${spec.category}` }, CATEGORY_LABELS[spec.category])),
        h('h1', { class: 'mn' }, spec.mnemonic),
        h('p', { class: 'lead' }, spec.summary)),
      tryBtn),
    h('section', null,
      h('h2', null, 'Syntax'),
      h('div', { class: 'syntax mono' }, syntaxOf(spec)),
      h('p', null, spec.description),
      codeBlock(spec.example)),
    h('section', null,
      h('h2', null, 'Encoding'),
      bitfield(spec, { showBitNumbers: true }),
      h('p', { class: 'fixed mono' }, fixed.join('   ·   ')),
      imm ? [h('h3', null, 'Where the immediate bits come from'),
        h('p', { class: 'dim' }, 'Hover a bit to trace its wire. Bit 31 of the instruction is always the sign bit, so sign extension (pink) needs no decoding.'), imm] : null),
    h('section', null,
      h('h2', null, 'Semantics'),
      h('div', { class: 'sem-grid' },
        h('div', { class: 'sem-box' }, h('h3', null, 'State update'), h('div', { class: 'math', html: stateUpdateMath(spec).join('') })),
        h('div', { class: 'sem-box' }, h('h3', null, 'Operational rule', rules.length > 1 ? 's' : ''),
          ...rules.map(r => h('div', { class: 'rule' }, h('div', { class: 'math', html: r.math }), h('div', { class: 'rule-name' }, r.name))))),
      h('p', { class: 'dim small' }, h('a', { href: '#/ref/notation' }, 'How to read this notation →'))),
    spec.notes?.length ? h('section', null, h('h2', null, 'Edge cases'), h('ul', { class: 'notes' }, ...spec.notes.map(n => h('li', null, n)))) : null,
    h('section', null,
      h('h2', null, 'In the datapath'),
      h('p', { class: 'dim' }, 'The single-cycle CPU executing this instruction. Paths it does not use are dimmed. The control word below is generated from the same instruction table as the control unit’s PLA.'),
      datapathThumb(spec),
      h('table', { class: 'ctl-table' }, h('tbody', null, ...ctl)),
      h('p', null, h('a', { href: '#/datapath', class: 'btn small' }, icon('cpu'), 'Open the datapath'))),
    h('nav', { class: 'card-nav' },
      prev ? h('a', { href: `#/ref/${prev.mnemonic}`, class: 'btn ghost' }, icon('arrowLeft'), prev.mnemonic) : h('span'),
      next ? h('a', { href: `#/ref/${next.mnemonic}`, class: 'btn ghost' }, next.mnemonic, icon('arrowRight')) : h('span')),
  );
}
