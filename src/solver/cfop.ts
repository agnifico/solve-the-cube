/**
 * CFOP (Fridrich): optimal white cross; F2L the way people do it — pick the
 * easiest pair, take a stuck piece out of the wrong slot if needed, then insert
 * with only U and the slot's own two faces, viewed from the slot's side; then
 * full OLL and PLL from the verified algorithm tables.
 */
import { Cube } from '../cube/cube.ts';
import { fromCube, C, E, ALL_MOVES, movesOf, CORNER_NAMES, EDGE_NAMES, MOVE_TOKENS, edgeSolved, cornerSolved, type Pieces } from './coords.ts';
import { PDB, eRef, cRef, stateOf, descend, pickBest, humanCost, ida, heuristic, type PieceRef } from './search.ts';
import { OLL, PLL, type LLAlg } from './algs.ts';
import { CROSS_EDGES, AUF, ollSolved, solvedUpToAuf, totalMoves, type SolveStep, type MethodSolve } from './common.ts';
import { StepBuilder, pieceLabel, viewCost } from './util.ts';

export const SLOTS = [
  { name: 'FR', where: 'front-right', corner: C.DFR, edge: E.FR, cross: [E.DF, E.DR], faces: 'RF', views: [0, 1] },
  { name: 'FL', where: 'front-left', corner: C.DFL, edge: E.FL, cross: [E.DF, E.DL], faces: 'LF', views: [3, 0] },
  { name: 'BL', where: 'back-left', corner: C.DBL, edge: E.BL, cross: [E.DB, E.DL], faces: 'LB', views: [2, 3] },
  { name: 'BR', where: 'back-right', corner: C.DBR, edge: E.BR, cross: [E.DB, E.DR], faces: 'RB', views: [1, 2] },
];
const slotMoves = (i: number) => movesOf('U' + SLOTS[i].faces);

const pdbs = new Map<string, PDB>();
function cached(key: string, make: () => PDB): PDB {
  let p = pdbs.get(key);
  if (!p) {
    p = make();
    pdbs.set(key, p);
  }
  return p;
}
const crossPdb = () => cached('cross', () => new PDB(CROSS_EDGES.map(eRef), ALL_MOVES));
/** Pieces of `slot` plus its two cross edges, under the move group of `group`. */
const slotPdb = (slot: number, group: number) =>
  cached(`slot${slot}/${group}`, () => {
    const s = SLOTS[slot];
    return new PDB([cRef(s.corner), eRef(s.edge), eRef(s.cross[0]), eRef(s.cross[1])], slotMoves(group));
  });
const crossUnder = (group: number) => cached(`cross/${group}`, () => new PDB(CROSS_EDGES.map(eRef), slotMoves(group)));

const crossCost = humanCost({ D: 0.3, B: 1.3, F: 0.3, L: 0.25 });

export function solveCross(b: StepBuilder, label = 'White cross') {
  const pdb = crossPdb();
  const sols = descend(pdb, stateOf(fromCube(b.cube), pdb.refs), ALL_MOVES, 3000);
  const seq = pickBest(sols, crossCost);
  b.addMoves(seq, label, ['DF', 'DR', 'DB', 'DL'], `${seq.length} moves, planned during the 15-second inspection.`);
}

/* --------------------------------------------------------------- F2L */

/** -1: top layer, 0..3: inside that slot, -2: anywhere else. */
function slotOf(p: Pieces, r: PieceRef): number {
  if (r.k === 'c') {
    const pos = (p.c[r.id] / 3) | 0;
    return pos < 4 ? -1 : pos - 4;
  }
  const pos = (p.e[r.id] / 2) | 0;
  if (pos < 4) return -1;
  return pos >= 8 ? pos - 8 : -2;
}

const seqCost = (seq: number[], views: number[]) => {
  const s = seq.map((m) => MOVE_TOKENS[m]).join(' ');
  return Math.min(...views.map((v) => viewCost(s, v)));
};

function trackedRefs(target: number, solved: number[]) {
  const t = SLOTS[target];
  const refs: PieceRef[] = [...CROSS_EDGES.map(eRef)];
  for (const j of solved) refs.push(cRef(SLOTS[j].corner), eRef(SLOTS[j].edge));
  const ti = refs.length;
  refs.push(cRef(t.corner), eRef(t.edge));
  return { refs, ti };
}

/** Take the target pieces out of the wrong slot X (only U and X's faces). */
function extract(cube: Cube, target: number, X: number, solved: number[]): number[] | null {
  const { refs, ti } = trackedRefs(target, solved);
  const mustBeHome = refs.map((_, i) => i < ti);
  const okSlot = (s: number, k: 'c' | 'e') => {
    const pos = k === 'c' ? (s / 3) | 0 : (s / 2) | 0;
    if (k === 'c') return pos < 4 || pos - 4 === target;
    return pos < 4 || pos - 8 === target;
  };
  const hs = [heuristic(crossUnder(X), refs), ...solved.map((j) => heuristic(slotPdb(j, X), refs))];
  const sols = ida({
    refs,
    start: stateOf(fromCube(cube), refs),
    moves: slotMoves(X),
    heuristics: hs,
    maxDepth: 7,
    maxSolutions: 80,
    mustBeHome,
    goal: (s) => okSlot(s[ti], 'c') && okSlot(s[ti + 1], 'e'),
  });
  if (!sols.length) return null;
  return pickBest(sols, (q) => seqCost(q, SLOTS[X].views));
}

/** Pair up and insert, using only U and the slot's two faces. */
function insert(cube: Cube, target: number, solved: number[]): number[] | null {
  const { refs } = trackedRefs(target, solved);
  const hs = [heuristic(slotPdb(target, target), refs), ...solved.map((j) => heuristic(slotPdb(j, target), refs))];
  const sols = ida({ refs, start: stateOf(fromCube(cube), refs), moves: slotMoves(target), heuristics: hs, maxDepth: 16, maxSolutions: 400 });
  if (!sols.length) return null;
  return pickBest(sols, (q) => seqCost(q, SLOTS[target].views));
}

interface PairPlan {
  slot: number;
  chunks: { seq: number[]; from?: number }[];
  len: number;
  cost: number;
}

function planPair(cube: Cube, slot: number, solved: number[]): PairPlan | null {
  const sim = cube.clone();
  const chunks: PairPlan['chunks'] = [];
  const t = SLOTS[slot];
  for (let guard = 0; guard < 3; guard++) {
    const p = fromCube(sim);
    const X = [slotOf(p, cRef(t.corner)), slotOf(p, eRef(t.edge))].find((x) => x >= 0 && x !== slot);
    if (X === undefined) break;
    const seq = extract(sim, slot, X, solved);
    if (!seq) return null;
    chunks.push({ seq, from: X });
    sim.alg(seq.map((m) => MOVE_TOKENS[m]).join(' '));
  }
  const seq = insert(sim, slot, solved);
  if (!seq) return null;
  chunks.push({ seq });
  const len = chunks.reduce((n, c) => n + c.seq.length, 0);
  const cost = chunks.reduce((n, c) => n + seqCost(c.seq, SLOTS[c.from ?? slot].views), 0);
  return { slot, chunks, len, cost };
}

function f2l(b: StepBuilder) {
  const solved: number[] = [];
  let n = 0;
  while (solved.length < 4) {
    const p = fromCube(b.cube);
    for (let i = 0; i < 4; i++) {
      if (!solved.includes(i) && cornerSolved(p, SLOTS[i].corner) && edgeSolved(p, SLOTS[i].edge)) {
        solved.push(i);
        n++;
        b.add('', `Pair ${n} · ${pairName(i)}`, slotPieces(i), 'Already solved — a free pair!');
      }
    }
    if (solved.length === 4) break;
    let best: PairPlan | null = null;
    for (let i = 0; i < 4; i++) {
      if (solved.includes(i)) continue;
      const plan = planPair(b.cube, i, solved);
      if (!plan) continue;
      if (!best || plan.len < best.len || (plan.len === best.len && plan.cost < best.cost)) best = plan;
    }
    if (!best) throw new Error('F2L planning failed');
    n++;
    const s = SLOTS[best.slot];
    for (const ch of best.chunks) {
      if (ch.from !== undefined) {
        const X = SLOTS[ch.from];
        b.addMoves(
          ch.seq,
          `Free a piece from the ${X.where} slot`,
          slotPieces(best.slot),
          `Part of pair ${n} is trapped in the ${X.where} slot. Lift it into the top layer first.`,
          X.views,
        );
      } else {
        b.addMoves(ch.seq, `Pair ${n} · ${pairName(best.slot)}`, slotPieces(best.slot), `Join the corner and edge in the top layer, then drop them into the ${s.where} slot together.`, s.views);
      }
    }
    solved.push(best.slot);
  }
}

const slotPieces = (i: number) => [CORNER_NAMES[SLOTS[i].corner], EDGE_NAMES[SLOTS[i].edge]];

export function pairName(slot: number): string {
  return pieceLabel(EDGE_NAMES[SLOTS[slot].edge]).replace(' edge', '');
}

/* ---------------------------------------------------------- last layer */

export const U_PIECES = ['UFR', 'UFL', 'UBL', 'UBR', 'UF', 'UR', 'UB', 'UL'];

export function solveOLL(b: StepBuilder, table: LLAlg[], setName = 'OLL'): SolveStep['case'] {
  if (ollSolved(fromCube(b.cube))) {
    b.add('', `${setName} skip`, U_PIECES, 'The top is already all yellow — a lucky skip.');
    return { set: setName, id: 'skip', name: 'Skip', alg: '' };
  }
  let best: { a: number; alg: LLAlg; len: number } | null = null;
  for (let a = 0; a < 4; a++) {
    for (const alg of table) {
      const t = b.cube.clone().alg(`${AUF[a]} ${alg.alg}`);
      if (!ollSolved(fromCube(t))) continue;
      const len = alg.alg.split(' ').length + (a ? 1 : 0);
      if (!best || len < best.len) best = { a, alg, len };
    }
  }
  if (!best) throw new Error(`${setName} recognition failed`);
  if (best.a) b.add(AUF[best.a], 'Set up the case', U_PIECES, 'Turn the top so the pattern matches the algorithm’s starting angle.');
  const title = best.alg.name === best.alg.group ? `${setName} ${best.alg.id} · ${best.alg.group}` : `${setName} ${best.alg.id} · ${best.alg.name}`;
  b.add(best.alg.alg, title, U_PIECES, `Recognise the ${best.alg.group.toLowerCase()} pattern, then orient the whole last layer in one algorithm.`);
  return { set: setName, id: best.alg.id, name: best.alg.name, alg: best.alg.alg };
}

export function solvePLL(b: StepBuilder): SolveStep['case'] {
  if (solvedUpToAuf(b.cube)) {
    for (const auf of AUF) {
      if (b.cube.clone().alg(auf).isSolved()) {
        b.add(auf, 'PLL skip', U_PIECES, 'Everything is already permuted — just align the top.');
        break;
      }
    }
    return { set: 'PLL', id: 'skip', name: 'Skip', alg: '' };
  }
  let best: { a: number; alg: LLAlg; c: number; len: number } | null = null;
  for (let a = 0; a < 4; a++) {
    for (const alg of PLL) {
      const t = b.cube.clone().alg(`${AUF[a]} ${alg.alg}`);
      for (let c = 0; c < 4; c++) {
        if (!t.clone().alg(AUF[c]).isSolved()) continue;
        const len = alg.alg.split(' ').length + (a ? 1 : 0) + (c ? 1 : 0);
        if (!best || len < best.len) best = { a, alg, c, len };
      }
    }
  }
  if (!best) throw new Error('PLL recognition failed');
  if (best.a) b.add(AUF[best.a], 'Set up the case', U_PIECES, 'Spot the headlights or the solved bar, and turn the top to the algorithm’s angle.');
  b.add(best.alg.alg, `PLL · ${best.alg.name}`, U_PIECES, `${best.alg.group}: permute the last layer without disturbing anything else.`);
  if (best.c) b.add(AUF[best.c], 'Final turn', U_PIECES, 'Align the top layer — solved.');
  return { set: 'PLL', id: best.alg.id, name: best.alg.name, alg: best.alg.alg };
}

export function solveCFOP(start: Cube): MethodSolve {
  const cube = start.clone();
  const steps: SolveStep[] = [];
  const run = (id: string, fn: (b: StepBuilder) => SolveStep['case'] | void) => {
    const b = new StepBuilder(cube);
    const c = fn(b);
    steps.push(c ? { id, parts: b.parts, case: c } : { id, parts: b.parts });
  };
  run('cross', (b) => solveCross(b));
  run('f2l', f2l);
  run('oll', (b) => solveOLL(b, OLL));
  run('pll', solvePLL);
  if (!cube.isSolved()) throw new Error('CFOP solve failed');
  return { steps, moveCount: totalMoves(steps) };
}
