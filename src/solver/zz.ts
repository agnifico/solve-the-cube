/**
 * ZZ: EOLine (orient every edge, then place white-green and white-blue on the
 * bottom), F2L built as a left block with <R, U, L> and a right block with
 * <R, U> only, then OCLL and PLL. Every sub-step is solved optimally within
 * its move group with look-ahead to the following sub-step.
 */
import { Cube } from '../cube/cube.ts';
import { fromCube, applyMoves, C, E, EMOVE, N_MOVES, ALL_MOVES, movesOf, mv, CORNER_NAMES, EDGE_NAMES, type Pieces } from './coords.ts';
import { PDB, eRef, cRef, stateOf, descend, pickBest, humanCost, allowedAfter, type PieceRef } from './search.ts';
import { OCLL } from './algs.ts';
import { totalMoves, type SolveStep, type MethodSolve } from './common.ts';
import { StepBuilder } from './util.ts';
import { solveOLL, solvePLL } from './cfop.ts';

/* ------------------------------------------------ edge orientation */

const EPERM: number[][] = [];
const EFLIP: number[][] = [];
for (let m = 0; m < N_MOVES; m++) {
  EPERM.push([]);
  EFLIP.push([]);
  for (let pos = 0; pos < 12; pos++) {
    const s = EMOVE[pos * 2 * N_MOVES + m];
    EPERM[m].push(s >> 1);
    EFLIP[m].push(s & 1);
  }
}

/** Edge-orientation bits by position (bit i = edge at position i is bad). */
export function eoBits(p: Pieces): number {
  let bits = 0;
  for (let id = 0; id < 12; id++) if (p.e[id] & 1) bits |= 1 << (p.e[id] >> 1);
  return bits;
}

function applyEo(bits: number, m: number): number {
  let out = 0;
  for (let pos = 0; pos < 12; pos++) if (((bits >> pos) & 1) ^ EFLIP[m][pos]) out |= 1 << EPERM[m][pos];
  return out;
}

/** Positions of the bad edges, as solving-frame names. */
export function badEdges(p: Pieces): string[] {
  const out: string[] = [];
  for (let id = 0; id < 12; id++) if (p.e[id] & 1) out.push(EDGE_NAMES[id]);
  return out;
}

let eoDist: Uint8Array | null = null;
function eoTable(): Uint8Array {
  if (eoDist) return eoDist;
  const t = new Uint8Array(4096).fill(255);
  t[0] = 0;
  let frontier = [0];
  for (let d = 0; frontier.length; d++) {
    const next: number[] = [];
    for (const s of frontier) {
      for (const m of ALL_MOVES) {
        const n = applyEo(s, m);
        if (t[n] === 255) {
          t[n] = d + 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return (eoDist = t);
}

function eoSolutions(bits: number, limit = 3000): number[][] {
  const t = eoTable();
  const out: number[][] = [];
  const path: number[] = [];
  const walk = (s: number, lastFace: number) => {
    if (out.length >= limit) return;
    const d = t[s];
    if (d === 0) {
      out.push(path.slice());
      return;
    }
    for (const m of ALL_MOVES) {
      if (!allowedAfter(m, lastFace)) continue;
      const n = applyEo(s, m);
      if (t[n] !== d - 1) continue;
      path.push(m);
      walk(n, (m / 3) | 0);
      path.pop();
    }
  };
  walk(bits, -1);
  return out;
}

/* ------------------------------------------------------------ line */

const EO_SAFE = [...movesOf('UDRL'), mv('F2'), mv('B2')];
let linePdb: PDB | null = null;
const getLinePdb = () => (linePdb ??= new PDB([eRef(E.DF), eRef(E.DB)], EO_SAFE));

const eoCost = humanCost({ F: 0, B: 0.4, D: 0.6, L: 0.2 });
const lineCost = humanCost({ D: 0.3, L: 0.1, F: 0.6, B: 0.9 });

function eoLine(b: StepBuilder) {
  const p = fromCube(b.cube);
  const bad = badEdges(p);
  const pdb = getLinePdb();
  // Among optimal EO solutions, prefer the one that leaves the shortest line.
  const sols = eoSolutions(eoBits(p));
  let best: { eo: number[]; line: number } | null = null;
  for (const s of sols) {
    const after = applyMoves(p, s);
    const line = pdb.dist(stateOf(after, pdb.refs));
    if (!best || line < best.line || (line === best.line && eoCost(s) < eoCost(best.eo))) best = { eo: s, line };
  }
  b.addMoves(
    best!.eo,
    bad.length ? `Orient ${bad.length} bad edges` : 'Edges already oriented',
    bad,
    bad.length
      ? 'A bad edge can only be fixed by an F or B quarter turn — each one flips four edges at once.'
      : 'Lucky: every edge is already good.',
  );
  const p2 = fromCube(b.cube);
  const line = descend(pdb, stateOf(p2, pdb.refs), EO_SAFE, 2000);
  b.addMoves(pickBest(line, lineCost), 'Place the line', ['DF', 'DB'], 'White–green and white–blue go to the bottom using only moves that keep edges good.');
}

/* ----------------------------------------------------------- blocks */

interface BlockDef {
  side: 'Left' | 'Right';
  moves: number[];
  base: number; // bottom edge (DL / DR)
  back: { corner: number; edge: number };
  front: { corner: number; edge: number };
}

const LEFT: BlockDef = {
  side: 'Left',
  moves: movesOf('RUL'),
  base: E.DL,
  back: { corner: C.DBL, edge: E.BL },
  front: { corner: C.DFL, edge: E.FL },
};
const RIGHT: BlockDef = {
  side: 'Right',
  moves: movesOf('RU'),
  base: E.DR,
  back: { corner: C.DBR, edge: E.BR },
  front: { corner: C.DFR, edge: E.FR },
};

const pdbCache = new Map<string, PDB>();
function pdbFor(refs: PieceRef[], moves: number[]): PDB {
  const key = refs.map((r) => r.k + r.id).join(',') + '|' + moves.join(',');
  let p = pdbCache.get(key);
  if (!p) {
    p = new PDB(refs, moves);
    pdbCache.set(key, p);
  }
  return p;
}

const blockCost = humanCost({ R: 0, U: 0, L: 0.15 });

function block(b: StepBuilder, def: BlockDef) {
  const p = fromCube(b.cube);
  const fullRefs = [eRef(def.base), cRef(def.back.corner), eRef(def.back.edge), cRef(def.front.corner), eRef(def.front.edge)];
  const full = pdbFor(fullRefs, def.moves);

  type Option = { which: 'back' | 'front'; seq: number[]; total: number };
  let best: Option | null = null;
  for (const which of ['back', 'front'] as const) {
    const pair = def[which];
    const refs = [eRef(def.base), cRef(pair.corner), eRef(pair.edge)];
    const sq = pdbFor(refs, def.moves);
    const d = sq.dist(stateOf(p, refs));
    if (d === 255) continue;
    for (const seq of descend(sq, stateOf(p, refs), def.moves, 1500)) {
      const after = stateOf(applyMoves(p, seq), fullRefs);
      const rest = full.dist(after);
      const total = seq.length + rest;
      if (!best || total < best.total || (total === best.total && blockCost(seq) < blockCost(best.seq))) best = { which, seq, total };
    }
  }
  if (!best) throw new Error(`${def.side} block unreachable`);
  const sqPair = def[best.which];
  const other = def[best.which === 'back' ? 'front' : 'back'];
  const baseName = EDGE_NAMES[def.base];
  b.addMoves(
    best.seq,
    `${def.side} square`,
    [baseName, CORNER_NAMES[sqPair.corner], EDGE_NAMES[sqPair.edge]],
    best.seq.length
      ? `Build a 1×2×2 square at the ${best.which}-${def.side.toLowerCase()} using only ${def.side === 'Left' ? 'R, U and L' : 'R and U'}.`
      : 'Already built.',
  );
  const p2 = fromCube(b.cube);
  const pairSols = descend(full, stateOf(p2, fullRefs), def.moves, 1500);
  if (!pairSols.length) throw new Error('block pair failed');
  const pairSeq = pickBest(pairSols, blockCost);
  b.addMoves(
    pairSeq,
    `${def.side} pair`,
    [CORNER_NAMES[other.corner], EDGE_NAMES[other.edge]],
    pairSeq.length
      ? `Pair the last corner and edge, then insert to finish the ${def.side.toLowerCase()} 1×2×3 block.`
      : 'Already in place after the square — a free pair!',
  );
}

/* ------------------------------------------------------------ public */

export function solveZZ(start: Cube): MethodSolve {
  const cube = start.clone();
  const steps: SolveStep[] = [];
  const run = (id: string, fn: (b: StepBuilder) => SolveStep['case'] | void) => {
    const b = new StepBuilder(cube);
    const c = fn(b);
    steps.push(c ? { id, parts: b.parts, case: c } : { id, parts: b.parts });
  };
  run('eoline', eoLine);
  run('left-block', (b) => block(b, LEFT));
  run('right-block', (b) => block(b, RIGHT));
  run('ocll', (b) => solveOLL(b, OCLL, 'OLL'));
  run('pll', solvePLL);
  if (!cube.isSolved()) throw new Error('ZZ solve failed');
  return { steps, moveCount: totalMoves(steps) };
}
