/** Landing page: a live CPU in the hero, the four areas, and the chapter list. */
import { h } from '../ui/h.ts';
import { icon } from '../ui/icons.ts';
import { onCleanup } from '../ui/reactive.ts';
import { Machine } from '../sim/machine.ts';
import { assemble } from '../asm/assembler.ts';
import { SingleCycleEngine } from '../hw/cpu/single.ts';
import { Renderer } from '../viz/renderer.ts';
import { CPU_RECT } from '../viz/interiors.ts';
import { disassemble } from '../asm/disasm.ts';
import { chapterList } from './learn.ts';

const HERO_PROGRAM = `main:
    li   s0, 0
    li   s1, 1
loop:                   # Fibonacci, forever
    add  t0, s0, s1
    mv   s0, s1
    mv   s1, t0
    sw   t0, -4(sp)
    lw   t1, -4(sp)
    bnez t1, loop
    j    main
`;

function heroCpu(): HTMLElement {
  const canvas = h('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });
  const label = h('div', { class: 'hero-insn mono' });
  const wrap = h('div', { class: 'hero-cpu' }, canvas, label);
  const m = new Machine(1 << 10);
  const r = assemble(HERO_PROGRAM);
  m.loadProgram(r.image);
  const eng = new SingleCycleEngine(m);
  let t0 = 0, tmax = 1;
  const DUR = 1500, PERIOD = 2000;
  const ren = new Renderer(canvas, eng.cpu, {
    machine: m,
    time: () => { const e = performance.now() - t0; return e >= DUR ? Infinity : (e / DUR) * tmax; },
    showValues: () => false,
    compact: true,
  });
  let raf = 0, last = 0, visible = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const w = wrap.clientWidth, hh = wrap.clientHeight;
    if (!w || !hh) return;
    if (ren.vw !== w || ren.vh !== hh) { ren.resize(w, hh); ren.cam = ren.fitCamera(CPU_RECT, 0.02); }
    if (t - last > (reduce ? PERIOD * 2 : PERIOD)) {
      last = t;
      eng.step();
      m.history.clear();
      tmax = 0;
      for (const n of eng.structure.nets) if (Number.isFinite(n.arrival)) tmax = Math.max(tmax, n.arrival);
      t0 = reduce ? -1e9 : performance.now();
      label.textContent = disassemble(m.peekLoad(eng.structure.net('pc')!.value, 4), eng.structure.net('pc')!.value).text;
    }
    ren.draw();
  };
  raf = requestAnimationFrame(frame);
  const io = new IntersectionObserver(es => { visible = es[0]?.isIntersecting ?? true; });
  io.observe(wrap);
  onCleanup(() => { cancelAnimationFrame(raf); io.disconnect(); });
  return wrap;
}

export function mount(el: HTMLElement): void {
  const card = (href: string, ic: Parameters<typeof icon>[0], title: string, text: string) =>
    h('a', { class: 'area-card', href }, h('span', { class: 'ac-icon' }, icon(ic)), h('b', null, title), h('span', null, text), h('span', { class: 'ac-go' }, icon('arrowRight')));
  el.append(h('div', { class: 'scroll-page home' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('div', { class: 'kicker' }, 'An interactive RISC-V processor'),
        h('h1', null, 'See a CPU think,', h('br'), 'gate by gate.'),
        h('p', { class: 'lead' }, 'Write RISC-V assembly, run it on a real datapath, and zoom from the system bus down to the logic gates of the adder. Every wire is live; every instruction is formally defined.'),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn primary big', href: '#/learn' }, icon('book'), 'Start the guided tour'),
          h('a', { class: 'btn big', href: '#/lab' }, icon('code'), 'Open the Lab'))),
      heroCpu()),
    h('section', { class: 'areas' },
      card('#/learn', 'book', 'Learn', 'Fourteen chapters, from bits and gates to pipelines and interrupts, with circuits you can poke and build.'),
      card('#/lab', 'code', 'Lab', 'An editor, assembler and simulator with reverse stepping, breakpoints, a console and a 64×64 screen.'),
      card('#/datapath', 'cpu', 'Datapath', 'The single-cycle and pipelined CPU, with an abstraction slider from system to gates.'),
      card('#/ref', 'list', 'Reference', 'All 56 RV32IM instructions: encodings, formal semantics, and the paths they light up.')),
    h('section', { class: 'home-chapters' }, h('h2', null, 'The guided tour'), chapterList()),
    h('footer', { class: 'home-foot' }, 'RV32IM · machine-mode traps · built from scratch in TypeScript, with no dependencies.')));
}
