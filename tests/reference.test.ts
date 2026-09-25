import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../src/isa/spec/index.ts';
import { tryItProgram } from '../src/reference/tryit.ts';
import { asmOk, run } from './helpers.ts';
import { findSpec } from '../src/isa/decode.ts';

test('every Try-it program assembles, features its instruction and terminates', () => {
  for (const spec of INSTRUCTIONS) {
    const { source, line } = tryItProgram(spec);
    const r = asmOk(source);
    const addr = r.lineToAddrs.get(line)?.[0];
    assert.ok(addr !== undefined, `${spec.mnemonic}: marked line ${line} has no code`);
    const seg = r.image.segments.find(s => s.name === '.text')!;
    const o = addr - seg.base;
    const w = seg.bytes[o] | (seg.bytes[o + 1] << 8) | (seg.bytes[o + 2] << 16) | (seg.bytes[o + 3] << 24);
    assert.equal(findSpec(w)?.mnemonic, spec.mnemonic, `${spec.mnemonic}: marked line encodes ${findSpec(w)?.mnemonic}`);
    const m = run(source, 10_000);
    assert.ok(['halted', 'break'].includes(m.status), `${spec.mnemonic}: status ${m.status} ${m.message}`);
  }
});
