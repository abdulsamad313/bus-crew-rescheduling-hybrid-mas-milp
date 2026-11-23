// Builds the IJTST submission package for Paper 2 (manuscript + title page + highlights +
// cover letter + conflict of interest statement), following the IJTST Guide for Authors.
const fs = require('fs'); const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType,
  WidthType, BorderStyle, HeadingLevel, LevelFormat, Footer, PageNumber, PageBreak,
  LineNumberRestartFormat, TabStopType,
} = require('docx');

const R = path.join(__dirname, '..', 'results');
const OUT = process.argv[2] || path.join(R, 'ijtst');
fs.mkdirSync(OUT, { recursive: true });
const S = JSON.parse(fs.readFileSync(path.join(R, 'summary.json')));
function csv(f) {
  const [h, ...rows] = fs.readFileSync(path.join(R, f), 'utf8').trim().split('\n');
  const H = h.split(',');
  return rows.map(r => { const v = r.split(','); const o = {}; H.forEach((k, i) => o[k] = v[i]); return o; });
}
const OV = csv('table_overall.csv'); const MAIN = csv('table_main.csv'); const INST = csv('table_instances.csv');
const SIZE = csv('table_size.csv');
const f1 = x => Number(x).toFixed(1), f2 = x => Number(x).toFixed(2);
const pfmt = p => (p < 0.001 ? '< 0.001' : Number(p).toFixed(3));
const ov = m => OV.find(r => r.method === m);
const NAME = { 'CRSMAS': 'CRSMAS', 'CRSMAS-MR': 'CRSMAS-MR', 'MILP': 'Central MILP', 'HYB-S': 'HYB-S', 'HYB-PG': 'HYB-PG (proposed)' };
const ORDER = ['CRSMAS', 'CRSMAS-MR', 'MILP', 'HYB-S', 'HYB-PG'];

// ------------------------------------------------------------------ IJTST formatting helpers
// Times Roman 12 pt, single spacing, no justification, first-line indent 0.5 in, no blank
// line between paragraphs, one blank line before/after headings, equations, figures, tables.
const FONT = 'Times New Roman'; const SZ = 24; const BL = 276;   // one blank 12 pt line
function rich(text, opt = {}) {
  const out = []; const re = /_\{([^}]*)\}|_([A-Za-z0-9])|\^\{([^}]*)\}/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...opt }));
    if (m[3] !== undefined) out.push(new TextRun({ text: m[3], superScript: true, ...opt }));
    else out.push(new TextRun({ text: m[1] !== undefined ? m[1] : m[2], subScript: true, ...opt }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...opt }));
  return out;
}
const runs = t => (Array.isArray(t) ? t : [t]).flatMap(x => typeof x === 'string' ? rich(x) : [x]);
let firstAfterHeading = false;
const P = (text, o = {}) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 0, line: 240 },
  indent: o.noIndent ? undefined : { firstLine: 720 }, children: runs(text) });
const T = (t, o = {}) => new TextRun({ text: t, ...o });
const H1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const EQ = (t, n) => new Paragraph({ spacing: { before: BL, after: BL, line: 240 },
  tabStops: [{ type: TabStopType.CENTER, position: 4680 }, { type: TabStopType.RIGHT, position: 9360 }],
  children: [new TextRun('\t'), ...rich(t, { italics: true }), ...(n ? [new TextRun({ text: `\t(${n})` })] : [])] });
const B = t => new Paragraph({ numbering: { reference: 'bul', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 0, line: 240 }, children: runs(t) });
const N = t => new Paragraph({ numbering: { reference: 'num', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 0, line: 240 }, children: runs(t) });
// Figure: image then caption below, centred: "Fig. 1. Sentence."
const FIG = (f, w, h, cap) => [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: BL }, keepNext: true, children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(R, 'fig', f)), transformation: { width: w, height: h } })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: BL }, children: runs(cap) })];
// Table: caption above in two left-justified lines; no vertical rules, no shading
const rule = { style: BorderStyle.SINGLE, size: 6, color: '000000' }; const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
function TABLE(num, cap, head, rows, widths, note) {
  const W = widths.reduce((a, b) => a + b, 0);
  const cell = (t, i, top, bottom, hdr) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    borders: { top: top ? rule : none, bottom: bottom ? rule : none, left: none, right: none },
    margins: { top: 30, bottom: 30, left: 80, right: 80 },
    children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text: String(t), bold: !!hdr, size: 20 })] })],
  });
  const out = [
    new Paragraph({ spacing: { before: BL }, keepNext: true, children: [T(`Table ${num}`)] }),
    new Paragraph({ spacing: { after: 60 }, keepNext: true, children: runs(cap) }),
    new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths,
      rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true, true, true)) }),
        ...rows.map((r, k) => new TableRow({ children: r.map((c, i) => cell(c, i, false, k === rows.length - 1, false)) }))] }),
  ];
  out.push(new Paragraph({ spacing: { before: note ? 60 : 0, after: BL }, children: note ? [T(note, { size: 20 })] : [] }));
  return out;
}

// ------------------------------------------------------------------ numbers
const st = S.stats;
const cov = st.coverage_coverable, chg = st.drivers_changed;
const wil = (metric, vs) => st[metric].wilcoxon.find(w => w.vs === vs);
const hp = ov('HYB-PG'), mr = ov('CRSMAS-MR'), cr = ov('CRSMAS'), mi = ov('MILP'), hs = ov('HYB-S');
const NA = { coverage: NaN, cpu: NaN };
const big = SIZE.filter(r => r.size.startsWith('large'));
const bigv = m => big.find(r => r.method === m) || NA;
const bd20 = m => MAIN.find(r => r.source === 'BDSP' && r.rho === '0.2' && r.method === m) || NA;
const rk20 = m => MAIN.find(r => r.source === 'RapidKL' && r.rho === '0.2' && r.method === m) || NA;
const ev = S.events_by_type;
const nB = S.bdsp_instances, nR = S.rk_instances, nS = S.n_scenarios;
const legsB = INST.filter(r => r.source === 'BDSP').map(r => +r.n_legs), legsR = INST.filter(r => r.source === 'RapidKL').map(r => +r.n_legs);
const mm = a => a.length ? `${Math.min(...a)}–${Math.max(...a)}` : 'n/a';
const o = S.hybpg_vs_milp_opt, to = S.hybpg_vs_milp_timeout;

// ------------------------------------------------------------------ front matter
const TITLE = 'Price-guided agent bidding for real-time bus crew rescheduling under simultaneous disruptions';
const AUTHOR = 'Abdul Samad Shibghatullah';
const AUTHORS = [
  { name: 'Abdul Samad Shibghatullah', aff: 'a', corr: true, email: 'abdul.samad@uniten.edu.my' },
  { name: 'Tillal Eldabi', aff: 'b', email: 't.a.eldabi@bradford.ac.uk', orcid: '0000-0002-0045-4075' },
  { name: 'Samer Muthana Sarsam', aff: 'c', email: 'samer.sarsam@coventry.ac.uk', orcid: '0000-0002-7404-1150' },
];
const AFFILS = [
  ['a', 'College of Computing and Informatics, Universiti Tenaga Nasional, Putrajaya Campus, Jalan IKRAM-UNITEN, 43000 Kajang, Selangor, Malaysia'],
  ['b', 'School of Management, University of Bradford, Bradford, United Kingdom'],
  ['c', 'School of Management, Coventry University, Coventry, United Kingdom'],
];
const AUTHOR_LIST = AUTHORS.map(a => a.name).join(', ');
const FUNDING_RUNS = () => [T('This work was supported by Universiti Tenaga Nasional (UNITEN), Malaysia, through the REC research grant.')];
const CREDIT = 'Abdul Samad Shibghatullah: Conceptualization, Methodology, Software, Formal analysis, Investigation, Data curation, Writing – original draft, Funding acquisition, Project administration. Tillal Eldabi: Methodology, Validation, Writing – review & editing. Samer Muthana Sarsam: Validation, Visualization, Writing – review & editing.';
const AFFIL = 'College of Computing and Informatics, Universiti Tenaga Nasional, Putrajaya Campus, Jalan IKRAM-UNITEN, 43000 Kajang, Selangor, Malaysia';
const EMAIL = 'abdul.samad@uniten.edu.my';
const KEYWORDS = ['Bus crew rescheduling', 'Disruption management', 'Multi-agent system', 'Combinatorial auction', 'Column generation'];
const ABSTRACT = `Unpredictable events such as late sign-on, delays and sudden driver absence force bus dispatchers to reassign disrupted trips within minutes. Multi-agent systems (MAS) reschedule quickly through negotiation, but parallel negotiations can book the same driver twice, and rule-based matching leaves many trips uncovered when several events occur at once, while exact centralised optimisation does not scale to real-time use. This paper proposes HYB-PG, a hybrid approach in which driver agents check labour rules locally and bid for bundles of disrupted trips, and a coordinator selects the winning bids by solving a set-packing model. Shadow prices from the linear relaxation are broadcast to the agents, who return their most profitable bundles, so that bidding acts as the pricing step of column generation. HYB-PG was compared with the original crew rescheduling MAS (CRSMAS), CRSMAS with multi-round matching (CRSMAS-MR) and a centralised mixed-integer programme (MILP) on ${nB} public benchmark instances and ${nR} instances built from the Rapid Bus Kuala Lumpur timetable, in ${nS} scenarios affecting 2–20% of drivers. HYB-PG recovered ${f1(hp.coverage)}% of recoverable trips, against ${f1(cr.coverage)}% for CRSMAS, ${f1(mr.coverage)}% for CRSMAS-MR and ${f1(mi.coverage)}% for the MILP with a 30-second limit, and never recovered fewer trips than any other method. It changed fewer duties than CRSMAS-MR, matched the MILP wherever the MILP proved optimality, and recovered ${f1(to.mean_extra_legs)} more trips on average where the MILP timed out, with a mean decision time of ${f2(hp.cpu)} s. Combining local agent reasoning with central winner determination therefore gives near-optimal, conflict-free rescheduling in real time.`;
const HIGHLIGHTS = [
  'Driver agents bid for trip bundles; a coordinator resolves bids by set packing',
  'Shadow prices turn agent bidding into the pricing step of column generation',
  `Tested on public benchmark and Rapid Bus KL GTFS data in ${nS} scenarios`,
  'The hybrid recovers the most trips with no conflicts or labour-rule violations',
  'It matches the proven MILP optimum and scales where the MILP times out',
];
const wc = s => s.split(/\s+/).filter(Boolean).length;
console.log('title chars', TITLE.length, '| abstract words', wc(ABSTRACT), '| highlights', HIGHLIGHTS.map(h => h.length).join(','));
if (TITLE.length > 144 || wc(ABSTRACT) > 250 || HIGHLIGHTS.some(h => h.length > 85)) throw new Error('front matter exceeds limits');

function titlePage(C) {
  C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: BL }, children: [T(TITLE, { bold: true, size: 28 })] }));
  const runs = [];
  AUTHORS.forEach((a, i) => {
    runs.push(T(a.name)); runs.push(T(a.aff + (a.corr ? ',*' : ''), { superScript: true }));
    if (i < AUTHORS.length - 1) runs.push(T(', '));
  });
  C.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs }));
  AFFILS.forEach(([k, txt], i) => C.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: i === 0 ? BL : 0 }, children: [T(k, { superScript: true }), T(txt)] })));
  C.push(new Paragraph({ spacing: { before: BL * 2 }, children: [T('*', { superScript: true }), T('Corresponding author: ' + AUTHORS[0].name + '. E-mail address: ' + EMAIL)] }));
  C.push(new Paragraph({ children: [T('E-mail addresses: ' + AUTHORS.map(a => `${a.email} (${a.name.split(' ').slice(-1)[0] === 'Shibghatullah' ? 'A.S. Shibghatullah' : a.name === 'Tillal Eldabi' ? 'T. Eldabi' : 'S.M. Sarsam'})`).join(', ') + '.')] }));
  C.push(new Paragraph({ children: [T('ORCID: A.S. Shibghatullah 0000-0001-9114-7945; T. Eldabi ' + AUTHORS[1].orcid + '; S.M. Sarsam ' + AUTHORS[2].orcid + '.')] }));
}

// ------------------------------------------------------------------ manuscript content
const C = [];
titlePage(C);
C.push(new Paragraph({ children: [new PageBreak()] }));
C.push(new Paragraph({ spacing: { after: BL }, children: [T('Abstract', { bold: true })] }));
C.push(P(ABSTRACT, { noIndent: true }));
C.push(new Paragraph({ spacing: { before: BL }, children: [T('Keywords: ', { bold: true }), T(KEYWORDS.join('; '))] }));
C.push(new Paragraph({ children: [new PageBreak()] }));

// 1 Introduction
C.push(H1('1. Introduction'));
C.push(P('Bus operators plan vehicle and driver schedules in advance, but daily operation rarely follows the plan. Drivers arrive late for sign-on or for relief, traffic incidents delay them, and illness or accidents make them unavailable for part or all of their duty. Each of these unpredictable events (UE) leaves trips without a driver. If the dispatcher cannot reassign the trips within minutes, the trips are cancelled, passengers wait longer, and service reliability falls. In practice, rescheduling is still largely manual and depends on the experience of the supervisor, which becomes error-prone when several events occur at the same time (Shibghatullah, 2008; Ibarra-Rojas et al., 2015).'));
C.push(P('Two families of methods address this problem. Optimisation methods formulate rescheduling as an integer programme, often solved by column generation, and give high-quality solutions (Huisman, 2007; Potthoff et al., 2010; Veelenturf et al., 2012). Their running time, however, grows quickly with the size of the network and the number of disrupted duties, which conflicts with real-time decision making. Multi-agent systems (MAS) instead let agents representing drivers negotiate the reassignment. This is fast and naturally decentralised (Abbink et al., 2010; Shibghatullah, 2008). The crew rescheduling MAS (CRSMAS) proposed in the first author’s earlier work reschedules single events quickly, but its own evaluation identified two limitations: matching is done in a single round, and different events cannot be handled at the same time because agents in separate negotiation windows may claim the same driver (Shibghatullah, 2008; Rahman et al., 2020).'));
C.push(P('This paper revisits that problem with current data and methods. The research question is whether a hybrid design, in which agents keep their local knowledge of labour rules and a coordinator resolves their competing bids optimally, can deliver the solution quality of central optimisation at the speed of agent negotiation when many disruptions occur simultaneously. The contributions are:'));
C.push(N('A hybrid MAS–MILP rescheduling approach in which driver agents check the full set of labour rules locally and submit bids for bundles of disrupted trips, and a coordinator solves a winner-determination set-packing problem. Every accepted assignment is feasible by construction and no driver is double-booked.'));
C.push(N('A price-guided bidding mechanism in which the coordinator broadcasts shadow prices from the linear relaxation and each agent computes its best-response bundle. This turns agent negotiation into the pricing step of column generation and closes the gap to the exact optimum.'));
C.push(N('A reproducible benchmark for simultaneous-disruption crew rescheduling, built on the public bus driver scheduling benchmark (Kletzander and Musliu, 2020) and on the Rapid Bus Kuala Lumpur GTFS feed, with four event types including full absence, which the earlier work listed as future research.'));
C.push(N(`A comparison of five methods on ${nS} scenarios, with non-parametric statistical tests, showing where each approach succeeds and fails.`));
C.push(P('Section 2 reviews related work. Section 3 defines the problem and Section 4 describes the methods. Section 5 presents the data and experimental design, Section 6 the results and discussion, and Section 7 the conclusions.'));

// 2 Literature review
C.push(H1('2. Literature review'));
C.push(H2('2.1. Bus driver scheduling'));
C.push(P('Bus driver scheduling partitions vehicle blocks into legal driver duties at minimum cost. It is a classical problem in public transport planning, usually solved with set-covering or set-partitioning models and column generation (Wren and Rousseau, 1995; Ibarra-Rojas et al., 2015). Recent work on real-life instances with complex break rules from the Austrian collective agreement uses branch and price and large neighbourhood search (Kletzander and Musliu, 2020; Kletzander et al., 2021; Kletzander et al., 2025). The instances from this line of work are publicly available and are used in this paper as the planned schedules that disruptions act upon.'));
C.push(H2('2.2. Crew and vehicle rescheduling'));
C.push(P('Disruption management was developed first in the airline industry, where crew and aircraft recovery are solved with integer programming and decomposition (Clausen et al., 2010). In railways, Huisman (2007) formulated crew rescheduling as a set-covering problem solved by column generation, Potthoff et al. (2010) added dynamic selection of the duties allowed to change, and Veelenturf et al. (2012) combined crew rescheduling with small timetable changes. For buses, Visentini et al. (2014) reviewed real-time vehicle schedule recovery, Lai and Leung (2018) proposed rolling-horizon models for integrated vehicle and crew rescheduling in Hong Kong, Malucelli and Tresoldi (2019) used simulation-based optimisation on the Milan network, and Deng et al. (2024) studied bus rescheduling after breakdowns with dynamic programming and large neighbourhood search. These methods give strong solutions but rely on central solvers whose running time grows with network size.'));
C.push(H2('2.3. Multi-agent approaches'));
C.push(P('Agent-based methods are attractive for transport operations because the resources are distributed and the situation changes quickly (Davidsson et al., 2005; Barbati et al., 2012). Abbink et al. (2010) used actor-agent techniques for real-time train driver rescheduling, in which driver agents exchange tasks and a route analyser checks feasibility. For buses, CRSMAS modelled crews and duties as agents that negotiate replacements under rules derived from interviews with London bus companies (Shibghatullah, 2008), and later studies applied the approach to late-for-relief and late-for-second-piece-of-work events (Rahman et al., 2020; Mansor et al., 2020). More recently, multi-agent deep reinforcement learning has been applied to rail service rescheduling under disruptions (Ying et al., 2024). A common weakness of negotiation-based MAS is the lack of solution quality guarantees and the possibility of conflicting commitments when several negotiations run at once.'));
C.push(H2('2.4. Market-based coordination and column generation'));
C.push(P('Market-based coordination resolves competing claims through auctions. In the contract net protocol (Smith, 1980) a manager awards tasks to bidding contractors, and market-based methods are widely used for multi-robot task allocation (Dias et al., 2006). When bidders value bundles of items, the auctioneer must solve a winner determination problem, which is a weighted set-packing problem (Sandholm, 2002; de Vries and Vohra, 2003). Column generation solves large set-partitioning models by generating only the columns with negative reduced cost (Lübbecke and Desrosiers, 2005). The link between the two is that prices from the auctioneer’s linear relaxation tell each bidder which bundles are worth proposing. This paper uses that link: driver agents act as pricing oracles that know their own feasibility rules, and the coordinator acts as the master problem.'));
C.push(H2('2.5. Research gap'));
C.push(P('Table 1 positions this work. Optimisation methods give quality but not speed at scale, negotiation-based MAS give speed but not quality or conflict-freedom, and none of the reviewed bus studies evaluates many simultaneous events on public, reproducible data. HYB-PG targets this gap.'));
C.push(...TABLE(1, 'Positioning of this study.', ['Study', 'Mode', 'Method', 'Simultaneous events', 'Public data'], [
  ['Huisman (2007); Potthoff et al. (2010)', 'Rail crew', 'Column generation', 'Yes', 'No'],
  ['Abbink et al. (2010)', 'Rail crew', 'Actor-agent negotiation', 'Yes', 'No'],
  ['Lai and Leung (2018)', 'Bus vehicle + crew', 'Rolling-horizon MIP', 'Yes', 'No'],
  ['Malucelli and Tresoldi (2019)', 'Bus vehicle + crew', 'Simulation-based optimisation', 'Yes', 'No'],
  ['Shibghatullah (2008); Rahman et al. (2020)', 'Bus crew', 'MAS negotiation (CRSMAS)', 'Limited', 'No'],
  ['Ying et al. (2024)', 'Rail service', 'Multi-agent deep RL', 'Yes', 'Partly'],
  ['This paper', 'Bus crew', 'MAS bidding + MILP (price-guided)', 'Yes (up to 20% of drivers)', 'Yes'],
], [2700, 1400, 2300, 1700, 1260]));

// 3 Problem
C.push(H1('3. Problem description'));
C.push(H2('3.1. Planned schedule and labour rules'));
C.push(P('A day of operation consists of a set of trips (legs) L. Each leg l ∈ L belongs to a vehicle block (tour), starts at time s_l at position p_l and ends at time e_l at position q_l. A duty d is an ordered sequence of legs assigned to one driver. A duty is feasible if it satisfies the following rules, simplified from EC Regulation 561/2006 and the rules used in CRSMAS:'));
C.push(B('Changeover: for consecutive legs i and j, s_j ≥ e_i + τ(q_i, p_j), where τ is the travel time between positions (zero if the driver stays on the same bus).'));
C.push(B('Spread: sign-on to sign-off, including travel from and to the depot and fixed sign-on (15 min) and sign-off (10 min) times, does not exceed 600 minutes.'));
C.push(B('Driving: total driving time does not exceed 540 minutes, and continuous driving does not exceed 270 minutes without a break of at least 30 minutes.'));
C.push(P('The planned schedule is produced by a constructive heuristic that keeps drivers on their bus where possible and opens a new duty when no existing duty can feasibly take a leg. Every planned schedule used in the experiments was verified to satisfy all rules.'));
C.push(H2('3.2. Unpredictable events'));
C.push(P('A disruption scenario is a batch of k events reported at a common decision epoch t_0, for example heavy rain or a road incident at the start of the peak. Each event hits a different driver and begins at a time t ∈ [t_0, t_0 + 60]. Four event types are modelled, following the definitions in the earlier CRSMAS work and adding the absence event that it listed as future research: lateness (15–60 min), delay (80–180 min), unavailability for part of the duty (30–120 min) and absence for the rest of the duty. The legs of the affected driver that overlap the unavailable period, plus a five-minute readiness margin, become uncovered. Uncovered legs that start before t_0 + 5 cannot be recovered by any method and are excluded when computing the recovery rate.'));
C.push(H2('3.3. Rescheduling objective'));
C.push(P('The available resources are the non-disrupted drivers, whose planned duties are kept, and a small pool of reserve drivers on call at the depot (2% of the planned duties). A rescheduling solution adds uncovered legs to the duties of available drivers so that every modified duty remains feasible and no leg is covered twice. The objective is lexicographic: first maximise the number of recovered legs, then minimise the number of reserve drivers called, then minimise the number of regular drivers whose duties change. This is implemented with weights 1000, 10 and 1.'));

// 4 Methods
C.push(H1('4. Methodology'));
C.push(H2('4.1. CRSMAS'));
C.push(P('CRSMAS is implemented as described in the earlier work. For each event, the agent of the affected duty announces the uncovered pieces of work (runs of consecutive legs on the same bus), and the available crew agents respond. The piece goes to the agent with the nearest match, meaning the smallest idle time between the agent’s ready time and the start of the piece, with regular drivers preferred over reserves. Each event is handled in its own window on a snapshot of the schedule and in a single round. Assignments from different windows are merged afterwards; when a driver has been booked by two windows and the combined duty is infeasible, the later booking is dropped and counted as a conflict.'));
C.push(H2('4.2. CRSMAS-MR'));
C.push(P('CRSMAS-MR adds the two modifications proposed in the earlier work. A status flag marks committed drivers, so events are processed sequentially on a shared state and conflicts cannot occur. Pieces that find no match are split in half and offered again, for up to four rounds.'));
C.push(H2('4.3. Centralised MILP'));
C.push(P('The centralised model has a binary variable x_{dl} for every available driver d and recoverable leg l that d could take on its own, and a variable y_d indicating that d’s duty changes:'));
C.push(EQ('max  Σ_d Σ_l 1000·x_{dl}  −  Σ_d c_d·y_d', 1));
C.push(EQ('Σ_d x_{dl} ≤ 1  ∀ l;    x_{dl} ≤ y_d  ∀ d, l;    Σ_l (e_l − s_l)·x_{dl} ≤ 540 − D_d  ∀ d', 2));
C.push(EQ('x_{dl} + x_{dl′} ≤ 1  for every pair (l, l′) that d cannot take together', 3));
C.push(P('where c_d is 10 for reserves and 1 for regular drivers and D_d is the driving time already planned for d. Pairwise constraints capture overlaps and most spread and break interactions, but some break rules depend on three or more legs and cannot be expressed this way. Solutions are therefore checked afterwards, and legs are removed from any duty that violates a rule. The model is solved with HiGHS (Huangfu and Hall, 2018) through SciPy (Virtanen et al., 2020) with a 30-second limit, which reflects the time a dispatcher can wait for a decision.', { noIndent: true }));
C.push(H2('4.4. Proposed hybrid approach (HYB-PG)'));
C.push(P('HYB-PG separates two kinds of knowledge. Each driver agent knows its own duty and checks the full rule set when it considers taking extra legs. The coordinator knows the bids but not the rules, and decides which bids to accept.'));
C.push(P([T('Agent bidding. ', { italics: true }), 'A bid b of agent a is a bundle of recoverable legs that a can add to its duty feasibly. Agents enumerate bundles by depth-first search, adding legs in order of start time. A partial bundle that violates a rule cannot become feasible by appending later legs (later legs cannot shorten the spread, reduce driving, create an earlier break or change an earlier changeover), so infeasible partial bundles are pruned. Bundles are not restricted to legs that are feasible on their own: a leg that a driver cannot reach in time may become feasible when the same driver also takes the preceding leg on the same bus, because staying on the bus needs no changeover.']));
C.push(P([T('Winner determination. ', { italics: true }), 'With binary z_b for each bid, the coordinator solves the set-packing problem']));
C.push(EQ('max  Σ_b (1000·|b| − c_{a(b)})·z_b   s.t.  Σ_{b ∋ l} z_b ≤ 1  ∀ l;   Σ_{b ∈ B_a} z_b ≤ 1  ∀ a', 4));
C.push(P('Each leg is covered at most once and each agent wins at most one bid, so the result is conflict-free. Because every bid was checked against the full rules, every accepted duty is feasible and no repair is needed.', { noIndent: true }));
C.push(P([T('Price-guided bidding. ', { italics: true }), 'Enumerating all bundles is not possible for large instances. HYB-PG therefore starts from a small bid set (the single legs each agent can take, plus the bundles agreed in a CRSMAS-MR negotiation round) and improves it iteratively. In each round the coordinator solves the linear relaxation of Eq. (4) and broadcasts the dual price π_l of each leg and μ_a of each agent. Each agent then searches, by branch and bound, for bundles with positive reduced cost:']));
C.push(EQ('Σ_{l ∈ b} (1000 − π_l) − c_a − μ_a  >  0', 5));
C.push(P('and submits up to three of them. The process stops when no agent finds a profitable bundle or after 25 rounds, and the integer problem of Eq. (4) is then solved over all bids. This is column generation in which the pricing problem is solved independently by each agent, so the agents can run in parallel. Seeding the bid set with the CRSMAS-MR solution guarantees that HYB-PG never recovers fewer legs than CRSMAS-MR. As an ablation, HYB-S uses static bidding instead: each agent submits its largest bundles once, without prices. Algorithm 1 summarises HYB-PG.', { noIndent: true }));
C.push(new Paragraph({ spacing: { before: BL, after: 60 }, keepNext: true, children: [T('Algorithm 1. ', { bold: true }), T('Price-guided agent bidding (HYB-PG).')] }));
['1: Agents compute the legs they can take individually; run one CRSMAS-MR negotiation round; B ← singletons ∪ negotiated bundles',
 '2: for round = 1 to 25 do',
 '3:     Coordinator solves the LP relaxation of Eq. (4) over B and broadcasts prices (π, μ)',
 '4:     Each agent a (in parallel) finds up to 3 bundles with positive reduced cost, Eq. (5), by branch and bound',
 '5:     if no new bundle then stop; else add the new bundles to B',
 '6: Coordinator solves the integer problem of Eq. (4) over B and notifies the winning agents'].forEach((l, i, a) =>
  C.push(new Paragraph({ spacing: { after: i === a.length - 1 ? BL : 0 }, indent: { left: 400 }, keepNext: i < a.length - 1, children: [new TextRun({ text: l, font: 'Courier New', size: 20 })] })));

// 5 Data and experiments
C.push(H1('5. Data and experimental design'));
C.push(H2('5.1. Data sources and quality control'));
C.push(P(`Two public data sources are used. The first is the bus driver scheduling benchmark of realistic instances generated from Austrian operations (Kletzander and Musliu, 2020; Mannelli Mazzoli, 2025). One instance from each of the ${nB} size groups (10 to 250 vehicle tours, ${mm(legsB)} legs) is used. The second source is the GTFS static feed for Rapid Bus Kuala Lumpur published on the Malaysian government open data portal under CC BY 4.0 (Government of Malaysia, 2026). The weekday frequency-based trips were expanded into individual trips, terminal stops within 400 m were merged into relief points, routes were grouped geographically into ${nR} regional instances by k-means on route centroids, and trips were chained into vehicle blocks per route with a five-minute layover. Travel times between relief points assume 20 km/h plus a ten-minute change time. The Rapid KL instances have ${mm(legsR)} trips each. Table 2 lists all instances.`));
C.push(P('Three quality checks were applied. In the benchmark, missing direct links in the travel-time matrix (coded 99,999) were completed with shortest paths, so that every position can be reached from the depot. In the GTFS feed, stop identifiers of opposite directions at the same terminal were merged, because otherwise each trip forms its own vehicle block; the chaining was then checked so that no block contains overlapping trips. Finally, every planned schedule and every rescheduled solution was verified independently against the full rule set and for duplicate coverage.'));
C.push(...TABLE(2, 'Test instances and planned schedules.', ['Instance', 'Source', 'Trips (legs)', 'Vehicle tours', 'Planned duties'],
  INST.map(r => [r.instance, r.source === 'BDSP' ? 'BDSP benchmark' : 'Rapid Bus KL', r.n_legs, r.n_tours, r.n_duties]), [2500, 1900, 1650, 1650, 1660]));
C.push(H2('5.2. Scenarios and parameters'));
C.push(P(`For each instance, four disruption levels were tested, with 2%, 5%, 10% and 20% of the planned drivers affected, and five random seeds per level. This gives ${nS} scenarios with ${S.events_total} events in total (${ev.LATE} lateness, ${ev.DELAY} delay, ${ev.UNV} unavailability and ${ev.ABS} absence events). On average a scenario leaves ${f1(S.uncovered_mean)} legs uncovered, of which ${f1(100 * S.coverable_share)}% can still be recovered. All methods use the same scenarios, the same reserve pool and the same objective weights. HYB-S keeps the 60 largest bundles per regular agent and 180 per reserve. HYB-PG uses at most 25 rounds and 20,000 search nodes per agent per round. The MILPs and linear relaxations are solved with HiGHS in SciPy under a 30-second limit, on a two-core virtual machine with 7 GB of memory. All code is written in Python.`));
C.push(H2('5.3. Performance measures and statistical tests'));
C.push(P('The main measure is the recovery rate, the share of recoverable legs that are reassigned. Secondary measures are the number of reserve drivers called, the number of regular duties changed, the number of conflicts (CRSMAS only), rule violations after rescheduling, and CPU time. Methods are compared with the Friedman test over all scenarios, followed by Wilcoxon signed-rank tests of HYB-PG against each other method with Holm correction (Demšar, 2006; Holm, 1979).'));

// 6 Results and discussion
C.push(H1('6. Results and discussion'));
C.push(H2('6.1. Overall performance'));
C.push(P(`Table 3 summarises the results over all ${nS} scenarios. HYB-PG has the highest recovery rate (${f1(hp.coverage)}%), followed by HYB-S (${f1(hs.coverage)}%), CRSMAS-MR (${f1(mr.coverage)}%), the centralised MILP (${f1(mi.coverage)}%) and the original CRSMAS (${f1(cr.coverage)}%). No method produced duties that violate the rules after its own final step, but the centralised MILP needed post-repair: ${S.milp_repaired_total} legs in total were removed from its solutions because their combined break structure was not captured by the pairwise constraints. The original CRSMAS produced conflicts in ${f1(100 * S.crsmas_conflict_share)}% of the scenarios, with an average of ${f2(cr.conflicts)} double bookings per scenario.`));
C.push(...TABLE(3, `Overall results (means over ${nS} scenarios).`, ['Method', 'Recovered (%)', 'Reserves called', 'Duties changed', 'Conflicts', 'Mean CPU (s)', 'Max CPU (s)'],
  ORDER.map(m => { const r = ov(m); return [NAME[m], f1(r.coverage), f2(r.reserves), f2(r.changed), f2(r.conflicts), f2(r.cpu), f1(r.cpu_max)]; }),
  [2200, 1200, 1200, 1200, 1100, 1180, 1280]));
C.push(H2('6.2. Effect of disruption level'));
C.push(P(`Fig. 1 shows the recovery rate by disruption level. With 2% of drivers affected, all methods except the original CRSMAS reach almost the same recovery rate (about 89%); the remaining legs cannot be covered because no available driver can reach them in time. The original CRSMAS already loses about a fifth of the recoverable legs at this level. As the number of simultaneous events grows, the original CRSMAS degrades sharply because its independent windows book the same drivers. At 20% disruption on the BDSP instances it recovers ${f1(bd20('CRSMAS').coverage)}% of recoverable legs, against ${f1(bd20('HYB-PG').coverage)}% for HYB-PG. On the Rapid KL instances, which have fewer idle drivers in the peak, the corresponding values are ${f1(rk20('CRSMAS').coverage)}% and ${f1(rk20('HYB-PG').coverage)}%, and the centralised MILP reaches ${f1(rk20('MILP').coverage)}%.`));
C.push(...FIG('fig_coverage.png', 600, 258, 'Fig. 1. Recovered trips (% of recoverable) by disruption level and data source.'));
C.push(H2('6.3. Scalability'));
C.push(P(`Fig. 2 plots CPU time against instance size. Both CRSMAS variants run in milliseconds. HYB-PG takes on average ${f2(hp.cpu)} s (maximum ${f1(hp.cpu_max)} s). If the agents price in parallel, as the design allows, the mean decision time falls to ${f2(S.hybpg_cpu_parallel_mean)} s. The centralised MILP grows fastest: it reached the 30-second limit in ${S.milp_timeouts} of ${S.milp_scen} scenarios, all on larger instances, and in those cases its best solution recovered far fewer legs. On large instances (1,200 trips or more) the MILP recovers ${f1(bigv('MILP').coverage)}% of recoverable legs, against ${f1(bigv('HYB-PG').coverage)}% for HYB-PG.`));
C.push(...FIG('fig_cpu.png', 380, 271, 'Fig. 2. Mean CPU time against instance size (log scale).'));
C.push(H2('6.4. Conflicts in parallel negotiation'));
C.push(P(`Fig. 3 shows the mean number of conflicts produced by the original CRSMAS as the number of simultaneous events grows. Conflicts grow faster than the number of events, from ${f2(S.conflicts_by_k['1–5'])} per scenario with up to five events to ${f1(S.conflicts_by_k['41–80'])} with more than forty, because every additional window competes for the same pool of idle drivers. This confirms the limitation identified in the earlier work and explains why status flags (CRSMAS-MR) or central winner determination (HYB-PG) are needed.`));
C.push(...FIG('fig_conflicts.png', 380, 271, 'Fig. 3. Mean number of double bookings produced by CRSMAS.'));
C.push(H2('6.5. Comparison with the exact optimum'));
C.push(P(`In the ${o.n} scenarios where the centralised MILP proved optimality within the time limit, HYB-PG recovered exactly the same number of legs in ${o.equal} scenarios${o.hyb_better ? `, more legs in ${o.hyb_better}` : ''} and fewer in ${o.milp_better}. The ${o.hyb_better} cases where HYB-PG did better arise because the leg-level MILP only contains legs that a driver can take on their own; it cannot represent a leg that becomes feasible only when the driver also takes the preceding leg on the same bus without a changeover, which the bundles of HYB-PG capture. In the ${to.n} scenarios where the MILP timed out, HYB-PG recovered more legs in ${to.hyb_better}, on average ${f1(to.mean_extra_legs)} additional legs per scenario. HYB-PG needed ${f1(S.hybpg_rounds_mean)} pricing rounds and ${Math.round(S.hybpg_bids_mean)} bids on average.`));
C.push(H2('6.6. Statistical tests'));
C.push(P(`The Friedman test shows significant differences between the methods for the recovery rate (χ² = ${f1(cov.friedman_chi2)}, p ${pfmt(cov.friedman_p)}, n = ${cov.n}) and for the number of duties changed (χ² = ${f1(chg.friedman_chi2)}, p ${pfmt(chg.friedman_p)}). Table 4 reports the pairwise Wilcoxon tests of HYB-PG against each other method. For the recovery rate, HYB-PG is significantly better than every other method after Holm correction and has no losses: the differences come from the scenarios in which it recovers more legs, while the remaining scenarios are ties. For the number of duties changed, HYB-PG changes significantly fewer duties than CRSMAS-MR; the original CRSMAS changes fewer duties only because it recovers far fewer legs.`));
C.push(...TABLE(4, 'Wilcoxon signed-rank tests of HYB-PG against each method (Holm-adjusted p-values).', ['HYB-PG vs.', 'Recovery: win / tie / loss', 'Holm p', 'Duties changed: fewer / tie / more', 'Holm p'],
  ['CRSMAS', 'CRSMAS-MR', 'MILP', 'HYB-S'].map(m => { const a = wil('coverage_coverable', m), b = wil('drivers_changed', m);
    return [NAME[m], `${a.win} / ${a.tie} / ${a.loss}`, pfmt(a.p_holm), `${b.loss} / ${b.tie} / ${b.win}`, pfmt(b.p_holm)]; }),
  [1900, 2300, 1100, 2960, 1100]));
C.push(H2('6.7. Ablation: static versus price-guided bidding'));
C.push(P(`Static bidding (HYB-S) already removes conflicts and violations, but it recovers fewer legs than HYB-PG (${f1(hs.coverage)}% versus ${f1(hp.coverage)}%) because the largest bundles are not always the ones that fit together. Prices tell each agent which legs are scarce, so the agents propose complementary bundles. The cost is extra computation: ${f2(hp.cpu)} s against ${f2(hs.cpu)} s on average.`));
C.push(H2('6.8. Discussion'));
C.push(P('The results answer the research question positively. Agent negotiation alone is fast but, without coordination, its quality collapses when many events occur together. Central optimisation is accurate on small and medium instances but cannot meet a real-time limit on large ones, and its compact model cannot express every labour rule. Letting agents handle the rules and the coordinator handle conflicts combines the strengths of both: HYB-PG is never worse than CRSMAS-MR by design, is never worse than the MILP in the experiments, and remains within seconds on the largest instances. Its average advantage over CRSMAS-MR is modest when few events occur, because the decentralised matching with status flags already works well there; the advantage grows with the number of simultaneous events and comes with fewer changed duties.'));

// 7 Conclusions
C.push(H1('7. Conclusions'));
C.push(P(`This paper proposed HYB-PG, a hybrid multi-agent and mixed-integer programming approach to real-time bus crew rescheduling under simultaneous disruptions. Driver agents check labour rules locally and bid for bundles of disrupted trips, a coordinator resolves the bids with a set-packing model, and shadow prices guide the agents towards complementary bundles. On ${nS} scenarios built from two public data sets, HYB-PG recovered the most trips, produced no conflicts or rule violations, matched the exact optimum where it was available and scaled to the largest instances within seconds.`));
C.push(P('The scientific contribution is to show that agent negotiation can be cast as the pricing step of column generation, which gives a decentralised method with the solution quality of a central model and without its scalability limits. The study also provides a reproducible benchmark for simultaneous-disruption crew rescheduling on public data.'));
C.push(P('For the transport system, the method fits existing dispatching practice. Each driver agent can run on the scheduling server or on a depot tablet using only the driver’s duty and the rule set, and the dispatcher receives one consistent proposal instead of several competing ones. Recovering more trips within seconds reduces cancellations and passenger waiting time, and the lexicographic objective limits the number of drivers whose day changes, which matters for driver acceptance.'));
C.push(P('The study has limitations. The labour rules are a simplified version of EC Regulation 561/2006 rather than the full collective agreement of an operator. The Rapid KL instances are built from a timetable rather than from actual vehicle and duty schedules, and the travel times between relief points are approximations. Events are assumed to be known at a common decision epoch, whereas in practice they arrive one by one, and the parallel decision times are estimated on a single computer.'));
C.push(P('Future research will extend the approach to a rolling horizon in which events arrive over time, to integrated vehicle and crew rescheduling, to the full rule sets of Malaysian operators, and to learning-based price prediction that reduces the number of bidding rounds.'));

// Acknowledgements and declarations (unnumbered)
C.push(H1('Acknowledgements and Declarations'));
C.push(P(FUNDING_RUNS(), { noIndent: true }));
C.push(P('The authors declare that the contents of this article have not been published previously. All authors have contributed to the work described, read and approved the contents for publication in this journal. All authors declare that they have no conflict of interest with any funding entity or any organization mentioned in this article in the past three years that may have influenced the conduct of this research and the findings.'));
C.push(P([T('CRediT authorship contribution statement. ', { italics: true }), CREDIT]));
C.push(P([T('Data availability. ', { italics: true }), 'The bus driver scheduling benchmark is available at https://tommanmaz.github.io/bdsp.html. The Rapid Bus KL GTFS feed is available from https://developer.data.gov.my/realtime-api/gtfs-static under CC BY 4.0. The instance builder, scenario generator and all methods will be released in a public repository on acceptance.']));
C.push(P([T('Declaration of generative AI and AI-assisted technologies in the research and writing process. ', { italics: true }), 'During the preparation of this work the authors used Claude (Anthropic) to assist with code development, data analysis and language editing. After using this tool, the authors reviewed and edited the content as needed and take full responsibility for the content of the publication.']));

// References
C.push(H1('References'));
const REFS = [
  'Abbink, E.J.W., Mobach, D.G.A., Fioole, P.J., Kroon, L.G., van der Heijden, E.H.T., Wijngaards, N.J.E., 2010. Real-time train driver rescheduling by actor-agent techniques. Public Transp. 2(3), 249–268. https://doi.org/10.1007/s12469-010-0033-6',
  'Barbati, M., Bruno, G., Genovese, A., 2012. Applications of agent-based models for optimization problems: A literature review. Expert Syst. Appl. 39(5), 6020–6028.',
  'Clausen, J., Larsen, A., Larsen, J., Rezanova, N.J., 2010. Disruption management in the airline industry—Concepts, models and methods. Comput. Oper. Res. 37(5), 809–821.',
  'Davidsson, P., Henesey, L., Ramstedt, L., Törnquist, J., Wernstedt, F., 2005. An analysis of agent-based approaches to transport logistics. Transp. Res. Part C 13(4), 255–271.',
  'de Vries, S., Vohra, R.V., 2003. Combinatorial auctions: A survey. INFORMS J. Comput. 15(3), 284–309. https://doi.org/10.1287/ijoc.15.3.284.16077',
  'Demšar, J., 2006. Statistical comparisons of classifiers over multiple data sets. J. Mach. Learn. Res. 7, 1–30.',
  'Deng, S., He, Z., Zhong, J., Xie, J., 2024. Bus rescheduling for long-term benefits: An integrated model focusing on service capability and regularity. Appl. Sci. 14(5), 1872. https://doi.org/10.3390/app14051872',
  'Dias, M.B., Zlot, R., Kalra, N., Stentz, A., 2006. Market-based multirobot coordination: A survey and analysis. Proc. IEEE 94(7), 1257–1270.',
  'European Parliament and Council, 2006. Regulation (EC) No 561/2006 on the harmonisation of certain social legislation relating to road transport. Off. J. Eur. Union L 102, 1–14.',
  '[dataset] Government of Malaysia, 2026. GTFS Static: Rapid Bus KL. data.gov.my open data portal, CC BY 4.0. https://developer.data.gov.my/realtime-api/gtfs-static (accessed 14 November 2026).',
  'Holm, S., 1979. A simple sequentially rejective multiple test procedure. Scand. J. Stat. 6(2), 65–70.',
  'Huangfu, Q., Hall, J.A.J., 2018. Parallelizing the dual revised simplex method. Math. Program. Comput. 10(1), 119–142. https://doi.org/10.1007/s12532-017-0130-5',
  'Huisman, D., 2007. A column generation approach for the rail crew re-scheduling problem. Eur. J. Oper. Res. 180(1), 163–173.',
  'Ibarra-Rojas, O.J., Delgado, F., Giesen, R., Muñoz, J.C., 2015. Planning, operation, and control of bus transport systems: A literature review. Transp. Res. Part B 77, 38–75.',
  'Kletzander, L., Musliu, N., 2020. Solving large real-life bus driver scheduling problems with complex break constraints. Proc. Int. Conf. Autom. Plan. Sched. 30(1), 421–429. https://doi.org/10.1609/icaps.v30i1.6688',
  'Kletzander, L., Musliu, N., Van Hentenryck, P., 2021. Branch and price for bus driver scheduling with complex break constraints. Proc. AAAI Conf. Artif. Intell. 35. https://ojs.aaai.org/index.php/AAAI/article/view/17408',
  'Kletzander, L., Mannelli Mazzoli, T., Musliu, N., Van Hentenryck, P., 2025. Integrating column generation and large neighborhood search for bus driver scheduling with complex break constraints. J. Artif. Intell. Res. https://doi.org/10.1613/jair.1.19027',
  'Lai, D.S.W., Leung, J.M.Y., 2018. Real-time rescheduling and disruption management for public transit. Transportmetrica B 6(1), 17–33. https://doi.org/10.1080/21680566.2017.1358678',
  'Lübbecke, M.E., Desrosiers, J., 2005. Selected topics in column generation. Oper. Res. 53(6), 1007–1023.',
  'Malucelli, F., Tresoldi, E., 2019. Delay and disruption management in local public transportation via real-time vehicle and crew re-scheduling: A case study. Public Transp. 11(1), 1–25. https://doi.org/10.1007/s12469-019-00196-y',
  '[dataset] Mannelli Mazzoli, T., 2025. Bus Driver Scheduling Problem benchmark collection. https://tommanmaz.github.io/bdsp.html (accessed 14 November 2026).',
  'Mansor, N.F., Shibghatullah, A.S., Amir Hussin, A.A., Chit, S.M., Eldabi, T., 2020. Multi agent system (MAS) for bus driver duty reassignment in the event of late for second piece of work (LSPW). J. Phys.: Conf. Ser. 1529(4), 042092. https://doi.org/10.1088/1742-6596/1529/4/042092',
  'Potthoff, D., Huisman, D., Desaulniers, G., 2010. Column generation with dynamic duty selection for railway crew rescheduling. Transp. Sci. 44(4), 493–505.',
  'Rahman, A.F.N.A., Shibghatullah, A.S., Abas, Z.A., Eldabi, T., Mon, C.S., Hussin, A.A.A., 2020. Solving late for relief event in bus crew rescheduling using multi agent system. J. Eng. Sci. Technol. 15(3), 1972–1983.',
  'Sandholm, T., 2002. Algorithm for optimal winner determination in combinatorial auctions. Artif. Intell. 135(1–2), 1–54.',
  'Shibghatullah, A.S., 2008. A Multi-Agent System for a Bus Crew Rescheduling System. PhD thesis, Brunel University, London. https://bura.brunel.ac.uk/handle/2438/5423',
  'Smith, R.G., 1980. The contract net protocol: High-level communication and control in a distributed problem solver. IEEE Trans. Comput. C-29(12), 1104–1113.',
  'Veelenturf, L.P., Potthoff, D., Huisman, D., Kroon, L.G., 2012. Railway crew rescheduling with retiming. Transp. Res. Part C 20(1), 95–110. https://doi.org/10.1016/j.trc.2010.09.008',
  'Virtanen, P., et al., 2020. SciPy 1.0: Fundamental algorithms for scientific computing in Python. Nat. Methods 17, 261–272.',
  'Visentini, M.S., Borenstein, D., Li, J.-Q., Mirchandani, P.B., 2014. Review of real-time vehicle schedule recovery methods in transportation services. J. Sched. 17(6), 541–567. https://doi.org/10.1007/s10951-013-0339-8',
  'Wren, A., Rousseau, J.-M., 1995. Bus driver scheduling—An overview. In: Daduna, J.R., Branco, I., Paixão, J.M.P. (Eds.), Computer-Aided Transit Scheduling. Lecture Notes in Economics and Mathematical Systems 430, Springer, Berlin, pp. 173–187.',
  'Ying, C., Chow, A.H.F., Yan, Y., Kuo, Y.-H., Wang, S., 2024. Adaptive rescheduling of rail transit services with short-turnings under disruptions via a multi-agent deep reinforcement learning approach. Transp. Res. Part B 188, 103067. https://doi.org/10.1016/j.trb.2024.103067',
];
REFS.forEach(r => C.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 0 }, indent: { left: 360, hanging: 360 }, children: [T(r)] })));

// ------------------------------------------------------------------ documents
const styles = {
  default: { document: { run: { font: FONT, size: SZ } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: FONT, size: SZ, bold: true }, paragraph: { spacing: { before: BL, after: BL }, keepNext: true, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: FONT, size: SZ, italics: true }, paragraph: { spacing: { before: BL, after: BL }, keepNext: true, outlineLevel: 1 } },
  ],
};
const numbering = { config: [
  { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '(%1)', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
] };
const LETTER = { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };
const footer = () => ({ default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) });
function save(name, children, lineNumbers) {
  const props = { page: LETTER };
  if (lineNumbers) props.lineNumbers = { countBy: 1, restart: LineNumberRestartFormat.CONTINUOUS };
  const doc = new Document({ creator: AUTHOR_LIST, title: TITLE, styles, numbering,
    sections: [{ properties: props, footers: footer(), children }] });
  return Packer.toBuffer(doc).then(b => { fs.writeFileSync(path.join(OUT, name), b); console.log('written', name); });
}

// Title page (separate file)
const TP = []; titlePage(TP);
TP.push(new Paragraph({ spacing: { before: BL * 2 }, children: [T('Declaration of interest: ', { bold: true }), T('none.')] }));
TP.push(new Paragraph({ children: [T('Funding: ', { bold: true }), ...FUNDING_RUNS()] }));
TP.push(new Paragraph({ spacing: { before: BL }, children: [T('CRediT authorship contribution statement: ', { bold: true }), T(CREDIT)] }));

// Highlights (separate file)
const HL = [new Paragraph({ spacing: { after: BL }, children: [T('Highlights', { bold: true })] }), ...HIGHLIGHTS.map(h => B(h))];

// Conflict of interest statement
const COI = [new Paragraph({ spacing: { after: BL }, children: [T('Declaration of Competing Interest', { bold: true })] }),
  P('The authors declare that they have no known competing financial interests or personal relationships that could have appeared to influence the work reported in this paper. The authors have no conflict of interest with any funding entity or any organization mentioned in this article in the past three years that may have influenced the conduct of this research and the findings.', { noIndent: true }),
  new Paragraph({ spacing: { before: BL }, children: [T(AUTHOR_LIST)] }),
  new Paragraph({ children: [T('On behalf of all authors: ' + AUTHOR + ', ' + AFFIL)] }),
  new Paragraph({ children: [T('Date: '), T('22 November 2026')] })];

// Cover letter
const CL = [
  new Paragraph({ children: [T('22 November 2026')] }),
  new Paragraph({ spacing: { before: BL }, children: [T('The Editor-in-Chief')] }),
  new Paragraph({ children: [T('International Journal of Transportation Science and Technology')] }),
  new Paragraph({ spacing: { before: BL, after: BL }, children: [T('Dear Editor,')] }),
  P(`I am pleased to submit the manuscript “${TITLE}” for consideration as a research paper in the International Journal of Transportation Science and Technology.`, { noIndent: true }),
  P('Bus operators must reassign the trips of late, delayed or absent drivers within minutes, and the task becomes difficult when several disruptions occur at the same time. The manuscript proposes a hybrid method in which driver agents check labour rules locally and bid for bundles of disrupted trips, while a coordinator resolves the bids with a set-packing model. Shadow prices from the linear relaxation guide the agents, so negotiation becomes the pricing step of column generation. On public data from the bus driver scheduling benchmark and the Rapid Bus Kuala Lumpur GTFS feed, the method recovered more trips than multi-agent negotiation and a centralised integer programme, produced no rule violations or double bookings, and needed well under one second on average.', { noIndent: true }),
  P('The paper fits the journal’s scope in public transport operations and intelligent transportation systems, and it offers operators a decision-support approach that can be deployed with existing scheduling data.', { noIndent: true }),
  P('I confirm that the manuscript is original, has not been published previously, and is not under consideration for publication elsewhere. The manuscript is co-authored by Abdul Samad Shibghatullah (Universiti Tenaga Nasional), Tillal Eldabi (University of Bradford) and Samer Muthana Sarsam (Coventry University). All authors have approved the manuscript for submission and declare no conflict of interest. The work was supported by Universiti Tenaga Nasional through the REC research grant. Generative AI assistance used during the work is disclosed in the manuscript.', { noIndent: true }),
  new Paragraph({ spacing: { before: BL }, children: [T('Yours sincerely,')] }),
  new Paragraph({ spacing: { before: BL * 2 }, children: [T(AUTHOR)] }),
  new Paragraph({ children: [T('Associate Professor')] }), new Paragraph({ children: [T(AFFIL)] }),
  new Paragraph({ children: [T('E-mail: '), T(EMAIL)] })];

(async () => {
  await save('Manuscript.docx', C, true);
  await save('Title page.docx', TP, false);
  await save('Highlights.docx', HL, false);
  await save('Declaration of competing interest.docx', COI, false);
  await save('Cover letter.docx', CL, false);
})();
