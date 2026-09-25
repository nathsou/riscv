/** Small teaching circuits built from the same library as the CPU. */
import type { Def } from '../hw/netlist.ts';
import { NAND } from '../hw/lib/gates.ts';
import { RIPPLE_ADDER, COND_INVERT } from '../hw/lib/blocks.ts';

export const XOR_FROM_NAND: Def = {
  type: 'XorFromNand', name: 'XOR from four NANDs',
  inputs: [{ name: 'a', width: 1, kind: 'ctrl' }, { name: 'b', width: 1, kind: 'ctrl' }],
  outputs: [{ name: 'y', width: 1, kind: 'ctrl' }],
  behave: ([a, b]) => [a ^ b],
  build(b) {
    const a = b.in('a'), c = b.in('b');
    const [n1] = b.add(NAND(), [a, c], { name: 'n1', netNames: ['¬(a·b)'] });
    const [n2] = b.add(NAND(), [a, n1], { name: 'n2' });
    const [n3] = b.add(NAND(), [c, n1], { name: 'n3' });
    b.out('y', b.add(NAND(), [n2, n3], { name: 'n4', netNames: ['y'] })[0]);
  },
  doc: 'Four NAND gates make an exclusive-or. NAND is universal: every other gate, and so the whole CPU, can be built from it.',
};

export const ADDSUB4: Def = {
  type: 'AddSub4', name: '4-bit adder / subtractor',
  inputs: [{ name: 'a', width: 4 }, { name: 'b', width: 4 }, { name: 'sub', width: 1, kind: 'ctrl', side: 'b' }],
  outputs: [{ name: 'y', width: 4 }, { name: 'cout', width: 1, kind: 'ctrl' }],
  behave: ([a, b, s]) => {
    const r = a + (s ? (~b & 15) : b) + s;
    return [r & 15, r >> 4 & 1];
  },
  build(b) {
    const [nb] = b.add(COND_INVERT(4), [b.in('b'), b.in('sub')], { name: 'inv', netNames: ['b or ¬b'] });
    const [y, c] = b.add(RIPPLE_ADDER(4), [b.in('a'), nb, b.in('sub')], { name: 'adder', netNames: ['y', 'cout'] });
    b.out('y', y);
    b.out('cout', c);
  },
  doc: 'a − b = a + ¬b + 1. When sub is 1, the XOR gates invert b and the carry-in supplies the +1.',
};
