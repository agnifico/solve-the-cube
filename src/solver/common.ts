/** Shared helpers and output types for the method solvers. */
import { Cube, parseAlg, algToString, type Move } from '../cube/cube.ts';
import { fromCube, cornerSolved, edgeSolved, C, E, type Pieces } from './coords.ts';

export interface SolvePart {
  /** Short human label, e.g. "White–green edge" or "OLL 27 · Sune". */
  label: string;
  /** Space separated moves in standard notation. */
  moves: string;
  /** Solving-frame piece names this part is about (for highlights / callouts). */
  pieces?: string[];
  /** Optional one-line explanation shown in the player. */
  note?: string;
  /** y-rotation (1..3) a human would hold the cube in; absent means the standard view. */
  view?: number;
  /** `moves` as read from that view (same length, token for token). */
  display?: string;
}

export interface SolveStep {
  id: string;
  parts: SolvePart[];
  /** For algorithm steps: the recognised case. */
  case?: { set: string; id: string; name: string; alg: string };
}

export interface MethodSolve {
  steps: SolveStep[];
  moveCount: number;
}

export const CROSS_EDGES = [E.DF, E.DR, E.DB, E.DL];
export const D_CORNERS = [C.DFR, C.DFL, C.DBL, C.DBR];
export const MID_EDGES = [E.FR, E.FL, E.BL, E.BR];

export const crossSolved = (p: Pieces) => CROSS_EDGES.every((e) => edgeSolved(p, e));
export const firstLayerSolved = (p: Pieces) => crossSolved(p) && D_CORNERS.every((c) => cornerSolved(p, c));
export const f2lSolved = (p: Pieces) => firstLayerSolved(p) && MID_EDGES.every((e) => edgeSolved(p, e));

export function ollSolved(p: Pieces): boolean {
  for (let i = 0; i < 4; i++) if (p.c[i] % 3 !== 0 || p.e[i] % 2 !== 0) return false;
  return true;
}

/** Orientation pattern of the U layer, canonical under AUF. */
export function llPatternKey(p: Pieces): string {
  const co = new Array<number>(4).fill(0);
  const eo = new Array<number>(4).fill(0);
  for (let j = 0; j < 8; j++) {
    const pos = (p.c[j] / 3) | 0;
    if (pos < 4) co[pos] = p.c[j] % 3;
  }
  for (let j = 0; j < 12; j++) {
    const pos = (p.e[j] / 2) | 0;
    if (pos < 4) eo[pos] = p.e[j] % 2;
  }
  let best = '';
  for (let r = 0; r < 4; r++) {
    const k = [0, 1, 2, 3].map((i) => co[(i + r) % 4]).join('') + '|' + [0, 1, 2, 3].map((i) => eo[(i + r) % 4]).join('');
    if (!best || k < best) best = k;
  }
  return best;
}

export function solvedUpToAuf(c: Cube): boolean {
  const t = c.clone();
  for (let a = 0; a < 4; a++) {
    if (t.isSolved()) return true;
    t.alg('U');
  }
  return false;
}

/** Remove cancellations like "U U'" or "R R" → "R2" (face moves only, same face adjacent). */
export function simplify(moves: Move[]): Move[] {
  const out: Move[] = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && last.base === m.base && last.axis === m.axis && last.layers.join() === m.layers.join()) {
      out.pop();
      const q = (((last.q + m.q) % 4) + 4) % 4;
      if (q === 0) continue;
      // Re-express using the clockwise sign of the family.
      const dirCw = parseAlg(last.base)[0].q; // q of the clockwise move
      const amount = q === 2 ? 2 : q === (((dirCw % 4) + 4) % 4) ? 1 : -1;
      out.push(parseAlg(`${last.base}${amount === 2 ? '2' : amount === -1 ? "'" : ''}`)[0]);
      continue;
    }
    out.push(m);
  }
  return out;
}

export const AUF = ['', 'U', 'U2', "U'"];

/** Move count in the usual "every turn counts once, rotations are free" sense. */
export const countMoves = (moves: string) => (moves.trim() ? parseAlg(moves).filter((m) => !'xyz'.includes(m.base)).length : 0);

export const totalMoves = (steps: SolveStep[]) => steps.reduce((n, s) => n + s.parts.reduce((m, p) => m + countMoves(p.moves), 0), 0);

export function mergeParts(parts: SolvePart[]): string {
  return algToString(simplify(parts.flatMap((p) => parseAlg(p.moves))));
}

export { fromCube };
