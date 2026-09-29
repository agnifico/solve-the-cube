import { Cube, parseAlg, algToString, pieceColors, COLOR_NAMES, amountOf, formatToken } from '../cube/cube.ts';
import { MOVE_TOKENS } from './coords.ts';
import { simplify, type SolvePart } from './common.ts';

/** Parse, cancel adjacent same-face moves, and re-serialise. */
export function cleanAlg(s: string): string {
  return algToString(simplify(parseAlg(s.trim())));
}

/**
 * y-conjugation (y A y') on every move family: R→B, F→R, L→F, B→L, M→S, S→M',
 * x→z', z→x, and the same for wide turns. U/D/E/y are unchanged.
 */
const Y_CONJ: Record<string, [string, number]> = {
  R: ['B', 1], F: ['R', 1], L: ['F', 1], B: ['L', 1], U: ['U', 1], D: ['D', 1],
  r: ['b', 1], f: ['r', 1], l: ['f', 1], b: ['l', 1], u: ['u', 1], d: ['d', 1],
  M: ['S', 1], S: ['M', -1], E: ['E', 1],
  x: ['z', -1], z: ['x', 1], y: ['y', 1],
};

function conjToken(tok: string): string {
  const m = parseAlg(tok)[0];
  const [base, sign] = Y_CONJ[m.base];
  const amount = amountOf(m) * sign;
  return formatToken(base, amount === -2 ? 2 : amount);
}

/** Re-target an algorithm as if performed after k y-rotations: y^k A y^-k. */
export function yConj(alg: string, k: number): string {
  let moves = alg.split(/\s+/).filter(Boolean);
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) moves = moves.map(conjToken);
  return moves.join(' ');
}

/**
 * A "view" k means the solver has turned the cube with y^k (k=1: the right
 * face is now in front). Fixed-frame moves then read as yConj(moves, -k).
 */
export const displayFor = (moves: string, view: number) => (moves ? yConj(moves, 4 - (((view % 4) + 4) % 4)) : '');

const VIEW_WEIGHTS: Record<string, number> = { U: 0, R: 0, L: 0.3, F: 0.55, D: 1.3, B: 2.2 };

/** How pleasant an algorithm is to read/execute from view k (lower is better). */
export function viewCost(moves: string, view: number): number {
  const disp = displayFor(moves, view);
  let c = view % 4 ? 0.3 : 0;
  for (const tok of disp.split(' ').filter(Boolean)) c += VIEW_WEIGHTS[tok[0]] ?? 0.5;
  return c;
}

export function bestView(moves: string, candidates = [0, 1, 2, 3]): number {
  let best = candidates[0];
  let bestC = Infinity;
  for (const k of candidates) {
    const c = viewCost(moves, k);
    if (c < bestC - 1e-9) {
      bestC = c;
      best = k;
    }
  }
  return best;
}

/** "DF" → "White–Green edge", "DFR" → "White–Green–Orange corner". */
export function pieceLabel(name: string): string {
  const cols = pieceColors(name).map((c) => COLOR_NAMES[c]);
  const kind = name.length === 3 ? 'corner' : name.length === 2 ? 'edge' : 'centre';
  return `${cols.join('–')} ${kind}`;
}

export class StepBuilder {
  cube: Cube;
  parts: SolvePart[] = [];

  constructor(cube: Cube) {
    this.cube = cube;
  }

  /**
   * Record a part. `view` is the y-rotation (0..3) a human would hold the cube
   * in for these moves; pass an array of candidates to pick the most readable.
   */
  add(moves: string, label: string, pieces: string[] = [], note?: string, view: number | number[] = 0): void {
    const clean = moves.trim() ? cleanAlg(moves) : '';
    if (clean) this.cube.alg(clean);
    const v = Array.isArray(view) ? bestView(clean, view) : view;
    const part: SolvePart = { label, moves: clean };
    if (v) {
      part.view = v;
      part.display = displayFor(clean, v);
    }
    if (pieces.length) part.pieces = pieces;
    if (note) part.note = note;
    this.parts.push(part);
  }

  addMoves(seq: number[], label: string, pieces: string[] = [], note?: string, view: number | number[] = 0): void {
    this.add(seq.map((m) => MOVE_TOKENS[m]).join(' '), label, pieces, note, view);
  }
}
