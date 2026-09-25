/**
 * The pipelined datapath: five stage columns separated by pipeline
 * registers, with the forwarding paths, the hazard unit and the branch
 * redirect lit when they act, and a classic pipeline chart underneath.
 * Each instruction keeps its own colour as it flows through the stages.
 */
import { h } from '../ui/h.ts';
import { STAGES } from '../hw/cpu/pipeline.ts';
import type { PipelineEngine, Slot } from '../hw/cpu/pipeline.ts';

const hue = (seq: number) => (seq * 67) % 360;
const hex8 = (v: number | undefined) => (v === undefined ? '' : '0x' + (v >>> 0).toString(16).padStart(8, '0'));
const short = (v: number | undefined) => (v === undefined ? '' : (v | 0) > -1000 && (v | 0) < 10000 ? String(v | 0) : hex8(v));

const SVG = `
<svg class="pipe-svg" viewBox="0 0 1000 430" role="img" aria-label="Five-stage pipelined datapath">
  <defs>
    <marker id="pa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" class="arrow"/></marker>
  </defs>
  <g class="cols">
    <rect x="12" y="44" width="190" height="370" rx="10" data-col="0"/>
    <rect x="214" y="44" width="190" height="370" rx="10" data-col="1"/>
    <rect x="416" y="44" width="206" height="370" rx="10" data-col="2"/>
    <rect x="634" y="44" width="170" height="370" rx="10" data-col="3"/>
    <rect x="816" y="44" width="172" height="370" rx="10" data-col="4"/>
  </g>
  <!-- wires -->
  <g class="wires">
    <path id="w-pc-imem" d="M88 215H104"/>
    <path id="w-pc-add" d="M68 190V120H104"/>
    <path id="w-add-mux" d="M144 120H156V76H26V195H30"/>
    <path id="w-imem-ifid" d="M184 215H202"/>
    <path id="w-ifid-ctl" d="M214 215H224V96H240"/>
    <path id="w-ifid-rf" d="M224 215H240"/>
    <path id="w-ifid-imm" d="M224 215V320H240"/>
    <path id="w-rf-a" d="M330 190H404"/>
    <path id="w-rf-b" d="M330 250H404"/>
    <path id="w-imm-idex" d="M330 320H404"/>
    <path id="w-ctl-idex" d="M310 96H404" class="ctl"/>
    <path id="w-idex-fa" d="M416 190H440"/>
    <path id="w-idex-fb" d="M416 250H440"/>
    <path id="w-idex-imm" d="M416 320H478V262H500"/>
    <path id="w-fa-alu" d="M458 190H500"/>
    <path id="w-fb-alu" d="M458 250H478V240H500"/>
    <path id="w-alu-exmem" d="M570 225H622"/>
    <path id="w-exmem-dmem" d="M634 225H660"/>
    <path id="w-exmem-bypass" d="M634 225H648V352H790V250H804"/>
    <path id="w-dmem-memwb" d="M770 210H804"/>
    <path id="w-memwb-wb" d="M816 210H850"/>
    <path id="w-memwb-wb2" d="M816 250H850"/>
    <path id="w-wb-rf" d="M870 230H900V404H282V280" class="wb"/>
    <path id="w-fwd-mem" d="M628 300H430V272H440M430 272V212H440" class="fwd"/>
    <path id="w-fwd-wb" d="M900 380H424V280H440M424 280V204H440" class="fwd"/>
    <path id="w-redirect" d="M535 170V58H18V205H30" class="redirect"/>
    <path id="w-haz-pc" d="M352 110V30H60V190" class="haz"/>
    <path id="w-haz-ifid" d="M352 110V36H208V60" class="haz"/>
    <path id="w-haz-idex" d="M390 90H410V60" class="haz"/>
  </g>
  <!-- blocks -->
  <g class="blocks">
    <path class="mux" id="b-pcmux" d="M30 185L44 192V228L30 235Z"/>
    <rect class="reg" id="b-pc" x="48" y="190" width="40" height="50" rx="4"/><text x="68" y="219">PC</text>
    <rect id="b-add" x="104" y="104" width="40" height="32" rx="4"/><text x="124" y="124">+4</text>
    <rect id="b-imem" x="104" y="170" width="80" height="90" rx="6"/><text x="144" y="212">Instr.</text><text x="144" y="228">memory</text>
    <rect id="b-ctl" x="240" y="74" width="70" height="44" rx="6"/><text x="275" y="100">Control</text>
    <rect id="b-haz" x="322" y="68" width="68" height="42" rx="6" class="hazbox"/><text x="356" y="86" class="sm">Hazard</text><text x="356" y="100" class="sm">unit</text>
    <rect id="b-rf" x="240" y="160" width="90" height="120" rx="6"/><text x="285" y="214">Registers</text><text x="285" y="230" class="sm" id="t-rf">x—, x—</text>
    <rect id="b-imm" x="240" y="302" width="90" height="36" rx="6"/><text x="285" y="324">Imm gen</text>
    <path class="mux" id="b-fa" d="M440 176L458 184V218L440 226Z"/>
    <path class="mux" id="b-fb" d="M440 236L458 244V278L440 286Z"/>
    <path class="alu" id="b-alu" d="M500 170L570 196V254L500 280V240L512 225L500 210Z"/><text x="542" y="229">ALU</text>
    <rect id="b-dmem" x="660" y="160" width="110" height="120" rx="6"/><text x="715" y="214">Data</text><text x="715" y="230">memory</text>
    <path class="mux" id="b-wb" d="M850 190L870 198V262L850 270Z"/>
  </g>
  <!-- pipeline registers -->
  <g class="pregs">
    <rect x="202" y="60" width="12" height="340" rx="3" id="r-0"/><text class="rl" x="208" y="422">IF/ID</text>
    <rect x="404" y="60" width="12" height="340" rx="3" id="r-1"/><text class="rl" x="410" y="422">ID/EX</text>
    <rect x="622" y="60" width="12" height="340" rx="3" id="r-2"/><text class="rl" x="628" y="422">EX/MEM</text>
    <rect x="804" y="60" width="12" height="340" rx="3" id="r-3"/><text class="rl" x="810" y="422">MEM/WB</text>
  </g>
  <!-- values -->
  <g class="vals">
    <text id="v-pc" x="68" y="256"></text>
    <text id="v-a" x="476" y="170"></text>
    <text id="v-b" x="476" y="300"></text>
    <text id="v-alu" x="596" y="216"></text>
    <text id="v-mem" x="715" y="262"></text>
    <text id="v-wb" x="900" y="222" class="l"></text>
    <text id="v-fwdmem" x="530" y="294"></text>
    <text id="v-fwdwb" x="660" y="374"></text>
    <text id="v-redirect" x="300" y="52"></text>
    <text id="v-haz" x="300" y="26"></text>
  </g>
</svg>`;

export interface PipelineView { el: HTMLElement; update(e: PipelineEngine): void }

export function pipelineView(): PipelineView {
  const heads = STAGES.map(s => h('div', { class: 'ps-head' }, h('span', { class: 'ps-name' }, s), h('span', { class: 'ps-insn' }, '—'), h('span', { class: 'ps-tag' })));
  const headRow = h('div', { class: 'ps-heads' }, ...heads);
  const diagram = h('div', { class: 'pipe-diagram', html: SVG });
  const svg = diagram.firstElementChild as SVGSVGElement;
  const chart = h('div', { class: 'pipe-chart' });
  const stats = h('div', { class: 'pipe-stats' });
  const el = h('div', { class: 'pipe-view' }, headRow, diagram, h('div', { class: 'pipe-lower' }, h('div', { class: 'pipe-chart-wrap' }, h('h4', null, 'Pipeline chart'), chart), stats));
  const $ = (id: string) => svg.getElementById(id) as SVGElement | null;
  const on = (id: string, v: boolean, cls = 'on') => $(id)?.classList.toggle(cls, v);
  const txt = (id: string, s: string) => { const t = $(id); if (t) t.textContent = s; };
  const tint = (id: string, s: Slot | null) => {
    const e = $(id);
    if (!e) return;
    if (s && !s.flushed) { e.style.setProperty('--ih', String(hue(s.seq))); e.classList.add('busy'); }
    else e.classList.remove('busy');
  };

  function update(e: PipelineEngine): void {
    const st = e.state;
    const [IF, ID, EX, MEM, WB] = st.stages;
    STAGES.forEach((_, i) => {
      const s = st.stages[i];
      const hd = heads[i];
      const insn = hd.querySelector('.ps-insn')!;
      const tag = hd.querySelector('.ps-tag')!;
      insn.textContent = s ? s.text : 'bubble';
      hd.classList.toggle('bubble', !s);
      hd.classList.toggle('flushed', !!s?.flushed);
      if (s) hd.style.setProperty('--ih', String(hue(s.seq)));
      let t = '';
      if (s?.flushed) t = 'flushed';
      else if (i === 1 && st.stall) t = 'stall';
      else if (i === 0 && st.stall) t = 'stall';
      else if (i === 2 && s?.trap) t = 'trap';
      else if (i === 2 && s?.redirect !== undefined) t = 'taken';
      tag.textContent = t;
      tag.className = `ps-tag ${t}`;
      (svg.querySelector(`[data-col="${i}"]`) as SVGElement).classList.toggle('flush', !!s?.flushed);
    });
    // blocks tinted by the instruction occupying them
    tint('b-pc', IF); tint('b-imem', IF); tint('b-add', IF);
    tint('b-ctl', ID); tint('b-rf', ID); tint('b-imm', ID);
    tint('b-alu', EX); tint('b-fa', EX); tint('b-fb', EX);
    tint('b-dmem', MEM && MEM.mem ? MEM : null);
    tint('b-wb', WB);
    for (let i = 0; i < 4; i++) tint(`r-${i}`, st.stages[i]);
    // forwarding
    const fa = EX && !EX.flushed ? EX.fwdA : 'none', fb = EX && !EX.flushed ? EX.fwdB : 'none';
    on('w-fwd-mem', fa === 'mem' || fb === 'mem');
    on('w-fwd-wb', fa === 'wb' || fb === 'wb');
    txt('v-fwdmem', fa === 'mem' || fb === 'mem' ? `forward ${short(MEM?.rdVal)} from EX/MEM` : '');
    txt('v-fwdwb', fa === 'wb' || fb === 'wb' ? `forward ${short(WB?.rdVal)} from MEM/WB` : '');
    on('b-fa', fa !== 'none', 'sel'); on('b-fb', fb !== 'none', 'sel');
    // hazard & redirect
    on('w-haz-pc', st.stall); on('w-haz-ifid', st.stall); on('w-haz-idex', st.stall); on('b-haz', st.stall);
    txt('v-haz', st.stall ? 'load-use hazard: stall IF & ID, insert a bubble' : '');
    const red = EX && EX.redirect !== undefined;
    on('w-redirect', !!red);
    txt('v-redirect', red ? `redirect → ${hex8(EX!.redirect)} (flush IF, ID)` : '');
    // values
    txt('v-pc', IF ? hex8(IF.pc) : '');
    txt('t-rf', ID?.d ? `x${ID.d.rs1}, x${ID.d.rs2}` : '');
    txt('v-a', EX && !EX.flushed ? short(EX.opA) : '');
    txt('v-b', EX && !EX.flushed ? short(EX.opB) : '');
    txt('v-alu', EX && !EX.flushed ? short(EX.mem ? EX.mem.addr : EX.rdVal) : '');
    txt('v-mem', MEM?.mem ? `${MEM.mem.write ? 'store' : 'load'} [${hex8(MEM.mem.addr)}]` : '');
    const wbv = WB && !WB.flushed && WB.rdVal !== undefined && WB.d ? `x${WB.d.rd} ← ${short(WB.rdVal)}` : '';
    txt('v-wb', wbv);
    on('w-wb-rf', !!wbv);
    on('w-exmem-dmem', !!MEM?.mem); on('w-dmem-memwb', !!(WB?.mem && !WB.mem.write));
    renderChart(e);
    const retired = e.m.instret, cyc = e.m.cycles;
    let stalls = 0, flushes = 0;
    for (const c of e.chart) { if (c.stalled) stalls++; flushes += c.flushed.filter(Boolean).length ? 1 : 0; }
    stats.innerHTML = `<div class="tile"><div class="tv">${cyc}</div><div class="tl">cycles</div></div>
      <div class="tile"><div class="tv">${retired}</div><div class="tl">executed</div></div>
      <div class="tile"><div class="tv">${retired ? (cyc / retired).toFixed(2) : '—'}</div><div class="tl">CPI</div></div>
      <div class="tile"><div class="tv">${stalls}</div><div class="tl">stall cycles (recent)</div></div>`;
  }

  function renderChart(e: PipelineEngine): void {
    const N = 16;
    const cycles = e.chart.slice(-N);
    const seqs: number[] = [];
    for (const c of cycles) for (const s of c.stages) if (s !== null && !seqs.includes(s)) seqs.push(s);
    seqs.sort((a, b) => a - b);
    const rows = seqs.slice(-12);
    const head = h('div', { class: 'pc-row head' }, h('div', { class: 'pc-name' }), ...cycles.map(c => h('div', { class: 'pc-cell' }, String(c.cycle))));
    const body = rows.map(seq => {
      const slot = e.slots.get(seq);
      const cells = cycles.map((c, ci) => {
        const i = c.stages.indexOf(seq);
        if (i < 0) return h('div', { class: 'pc-cell' });
        const prev = ci > 0 ? cycles[ci - 1].stages.indexOf(seq) : -1;
        const stalled = prev === i;
        const flushed = c.flushed[i];
        return h('div', { class: `pc-cell st ${flushed ? 'fl' : ''} ${stalled ? 'stl' : ''}`, style: `--ih:${hue(seq)}`, title: `${STAGES[i]}${stalled ? ' (stalled)' : ''}${flushed ? ' (flushed)' : ''}` }, stalled ? '·' : STAGES[i]);
      });
      return h('div', { class: 'pc-row' }, h('div', { class: 'pc-name mono', style: `--ih:${hue(seq)}`, title: slot?.text ?? '' }, slot?.text ?? '?'), ...cells);
    });
    chart.replaceChildren(head, ...body);
    chart.style.setProperty('--cols', String(cycles.length));
  }

  return { el, update };
}
