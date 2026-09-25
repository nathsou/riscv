/** Circuit-building challenges for the HDL sandbox (checked exhaustively). */

export interface Challenge {
  id: string;
  title: string;
  goal: string;
  inputs: string[];
  outputs: string[];
  target?: (ins: number[]) => number[];
  allowed?: string[];
  starter: string;
  best?: string;
  solution?: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'xor-nand', title: 'XOR from NANDs', goal: 'Build y = a XOR b using <b>only NAND gates</b>.',
    inputs: ['a', 'b'], outputs: ['y'], target: ([a, b]) => [a ^ b], allowed: ['nand'], best: '4 NAND gates',
    starter: `in a, b\nout y\n# only nand(…) is allowed here\nn1 = nand(a, b)\ny = nand(n1, n1)   # this is just AND — fix me!\n`,
    solution: `in a, b\nout y\nn1 = nand(a, b)\nn2 = nand(a, n1)\nn3 = nand(b, n1)\ny = nand(n2, n3)\n`,
  },
  {
    id: 'mux', title: 'A multiplexer', goal: 'Build a 2:1 multiplexer: y = d0 when s = 0, and d1 when s = 1. Use and, or and not.',
    inputs: ['d0', 'd1', 's'], outputs: ['y'], target: ([d0, d1, s]) => [s ? d1 : d0], allowed: ['and', 'or', 'not'], best: '4 gates',
    starter: `in d0, d1, s\nout y\nns = not(s)\n# …\ny = and(d0, ns)\n`,
    solution: `in d0, d1, s\nout y\nns = not(s)\nt0 = and(d0, ns)\nt1 = and(d1, s)\ny = or(t0, t1)\n`,
  },
  {
    id: 'fa-ha', title: 'Full adder from half adders', goal: 'Build a full adder (s, cout) from two half adders — <span class="mono">sum, carry = ha(x, y)</span> — and one more gate.',
    inputs: ['a', 'b', 'cin'], outputs: ['s', 'cout'], target: ([a, b, c]) => [a ^ b ^ c, (a & b) | (c & (a ^ b))], allowed: ['ha', 'or', 'xor', 'and'], best: '2 half adders + 1 OR',
    starter: `in a, b, cin\nout s, cout\ns1, c1 = ha(a, b)\n# …\ns = xor(s1, cin)\ncout = c1\n`,
    solution: `in a, b, cin\nout s, cout\ns1, c1 = ha(a, b)\ns, c2 = ha(s1, cin)\ncout = or(c1, c2)\n`,
  },
  {
    id: 'majority', title: 'Majority vote', goal: 'y is 1 when at least two of a, b, c are 1. (This is exactly the carry-out of a full adder.)',
    inputs: ['a', 'b', 'c'], outputs: ['y'], target: ([a, b, c]) => [a + b + c >= 2 ? 1 : 0], best: '4 gates (three ANDs and a 3-input OR)',
    starter: `in a, b, c\nout y\ny = and(a, b)\n`,
    solution: `in a, b, c\nout y\nab = and(a, b)\nbc = and(b, c)\nac = and(a, c)\ny = or(ab, bc, ac)\n`,
  },
  {
    id: 'eq2', title: '2-bit comparator', goal: 'eq is 1 when the 2-bit numbers a1a0 and b1b0 are equal.',
    inputs: ['a1', 'a0', 'b1', 'b0'], outputs: ['eq'], target: ([a1, a0, b1, b0]) => [a1 === b1 && a0 === b0 ? 1 : 0], best: '3 gates',
    starter: `in a1, a0, b1, b0\nout eq\neq = xnor(a0, b0)\n`,
    solution: `in a1, a0, b1, b0\nout eq\ne0 = xnor(a0, b0)\ne1 = xnor(a1, b1)\neq = and(e0, e1)\n`,
  },
  {
    id: 'free', title: 'Free build', goal: 'Anything you like. Available: and, or, xor, nand, nor, xnor (any number of inputs), not, ha, fa, mux(d0, d1, s), and the constants 0 and 1.',
    inputs: [], outputs: [], starter: `in a, b, c\nout sum, carry\nsum, carry = fa(a, b, c)\n`,
  },
];
