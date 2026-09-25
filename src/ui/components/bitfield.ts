/** Instruction encoding diagram: 32 bit cells grouped into coloured fields. */
import { h } from '../h.ts';
import { FORMAT_FIELDS } from '../../isa/formats.ts';
import type { Field } from '../../isa/formats.ts';
import type { InsnSpec } from '../../isa/spec/index.ts';

export interface BitfieldOptions {
  /** Concrete instruction word; if omitted, fixed bits come from the spec and others show as field names. */
  word?: number;
  compact?: boolean;
  showBitNumbers?: boolean;
  onFieldHover?: (f: Field | null) => void;
}

function fixedMask(spec: InsnSpec): number {
  return spec.mask;
}

export function bitfield(spec: InsnSpec, opts: BitfieldOptions = {}): HTMLElement {
  const fields = FORMAT_FIELDS[spec.format];
  const mask = fixedMask(spec);
  const word = opts.word;
  const root = h('div', { class: `bitfield ${opts.compact ? 'compact' : ''}` });
  for (const f of fields) {
    const width = f.hi - f.lo + 1;
    const cells = h('div', { class: 'bf-cells' });
    for (let b = f.hi; b >= f.lo; b--) {
      const isFixed = ((mask >>> b) & 1) === 1;
      const bitVal = word !== undefined ? (word >>> b) & 1 : isFixed ? (spec.match >>> b) & 1 : null;
      cells.append(h('span', { class: `bf-bit ${isFixed ? 'fixed' : ''} ${bitVal === 1 ? 'one' : ''}`, title: `bit ${b}` }, bitVal === null ? '' : String(bitVal)));
    }
    let valueLabel = '';
    if (word !== undefined) {
      const v = width >= 32 ? word >>> 0 : (word >>> f.lo) & ((1 << width) - 1);
      valueLabel = f.kind === 'rd' || f.kind === 'rs1' || f.kind === 'rs2' ? `x${v}` : width > 4 ? '0x' + v.toString(16) : v.toString(2).padStart(width, '0');
    }
    const el = h('div', { class: `bf-field k-${f.kind}`, style: { flex: String(width) } },
      opts.showBitNumbers !== false ? h('div', { class: 'bf-nums' }, h('span', null, String(f.hi)), width > 1 ? h('span', null, String(f.lo)) : null) : null,
      cells,
      h('div', { class: 'bf-name' }, f.name, valueLabel ? h('span', { class: 'bf-val' }, ' ' + valueLabel) : null),
    );
    if (opts.onFieldHover) {
      el.addEventListener('mouseenter', () => opts.onFieldHover!(f));
      el.addEventListener('mouseleave', () => opts.onFieldHover!(null));
    }
    root.append(el);
  }
  return root;
}
