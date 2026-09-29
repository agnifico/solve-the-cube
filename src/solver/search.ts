/**
 * Generic search over a subset of pieces: pattern databases (exact BFS distance
 * tables) and IDA* that enumerates every optimal solution so a scoring function
 * can pick the most "human" one.
 */
import { CMOVE, EMOVE, N_MOVES, moveFace, OPPOSITE, type Pieces } from './coords.ts';

export interface PieceRef {
  k: 'c' | 'e';
  id: number;
}

export const cRef = (id: number): PieceRef => ({ k: 'c', id });
export const eRef = (id: number): PieceRef => ({ k: 'e', id });

export const goalOf = (refs: PieceRef[]) => refs.map((r) => (r.k === 'c' ? r.id * 3 : r.id * 2));
export const stateOf = (p: Pieces, refs: PieceRef[]) => refs.map((r) => (r.k === 'c' ? p.c[r.id] : p.e[r.id]));

const tableFor = (r: PieceRef) => (r.k === 'c' ? CMOVE : EMOVE);

/** Exact distance table for a small set of pieces (≤ 5) under a move set. */
export class PDB {
  readonly refs: PieceRef[];
  readonly moves: number[];
  readonly table: Uint8Array;
  private readonly pow: number[];

  constructor(refs: PieceRef[], moves: number[]) {
    this.refs = refs;
    this.moves = moves;
    const n = refs.length;
    this.pow = Array.from({ length: n }, (_, i) => 24 ** i);
    const size = 24 ** n;
    const table = new Uint8Array(size).fill(255);
    const tables = refs.map(tableFor);
    let frontier = new Uint32Array(1);
    frontier[0] = this.index(goalOf(refs));
    table[frontier[0]] = 0;
    let depth = 0;
    const digits = new Array<number>(n);
    while (frontier.length) {
      const next: number[] = [];
      for (let fi = 0; fi < frontier.length; fi++) {
        const idx = frontier[fi];
        let rem = idx;
        for (let i = 0; i < n; i++) {
          digits[i] = rem % 24;
          rem = (rem / 24) | 0;
        }
        for (const m of moves) {
          let j = 0;
          for (let i = 0; i < n; i++) j += tables[i][digits[i] * N_MOVES + m] * this.pow[i];
          if (table[j] === 255) {
            table[j] = depth + 1;
            next.push(j);
          }
        }
      }
      frontier = Uint32Array.from(next);
      depth++;
    }
    this.table = table;
  }

  index(states: number[]): number {
    let j = 0;
    for (let i = 0; i < states.length; i++) j += states[i] * this.pow[i];
    return j;
  }

  dist(states: number[]): number {
    return this.table[this.index(states)];
  }

  /** Map the PDB's pieces into positions of a larger tracked list. */
  mapInto(refs: PieceRef[]): number[] {
    return this.refs.map((r) => {
      const i = refs.findIndex((q) => q.k === r.k && q.id === r.id);
      if (i < 0) throw new Error('PDB piece not tracked');
      return i;
    });
  }
}

/** Is move m allowed right after a move on face `last`? (skip same face, order commuting opposite faces) */
export function allowedAfter(m: number, last: number): boolean {
  if (last < 0) return true;
  const f = moveFace(m);
  if (f === last) return false;
  if (OPPOSITE[f] === last && f > last) return false;
  return true;
}

export interface Heuristic {
  pdb: PDB;
  map: number[];
}

export function heuristic(pdb: PDB, refs: PieceRef[]): Heuristic {
  return { pdb, map: pdb.mapInto(refs) };
}

export interface IdaOptions {
  refs: PieceRef[];
  start: number[];
  moves: number[];
  heuristics: Heuristic[];
  maxDepth: number;
  /** Number of optimal solutions to collect (they are all the same length). */
  maxSolutions?: number;
  /** Extra goal predicate on top of "all tracked pieces home". */
  goal?: (s: number[]) => boolean;
  /** Which tracked pieces must be home at the goal (default: all). */
  mustBeHome?: boolean[];
}

/** IDA*: returns every optimal-length solution (up to maxSolutions), or [] if none within maxDepth. */
export function ida(o: IdaOptions): number[][] {
  const n = o.refs.length;
  const tables = o.refs.map(tableFor);
  const goal = goalOf(o.refs);
  const maxSol = o.maxSolutions ?? 64;
  const hs = o.heuristics;
  const sub = hs.map((h) => new Array<number>(h.map.length));

  const h = (s: number[]) => {
    let best = 0;
    for (let k = 0; k < hs.length; k++) {
      const { pdb, map } = hs[k];
      const arr = sub[k];
      for (let i = 0; i < map.length; i++) arr[i] = s[map[i]];
      const d = pdb.dist(arr);
      if (d > best) best = d;
    }
    return best;
  };
  const home = o.mustBeHome ?? new Array<boolean>(n).fill(true);
  const isGoal = (s: number[]) => {
    for (let i = 0; i < n; i++) if (home[i] && s[i] !== goal[i]) return false;
    return o.goal ? o.goal(s) : true;
  };

  const stack: number[][] = Array.from({ length: o.maxDepth + 2 }, () => new Array<number>(n));
  const path: number[] = [];
  const solutions: number[][] = [];

  const dfs = (depth: number, bound: number, lastFace: number): void => {
    const s = stack[depth];
    const hv = h(s);
    if (depth + hv > bound) return;
    if (hv === 0 && isGoal(s)) {
      if (depth === bound) solutions.push(path.slice());
      return;
    }
    if (depth === bound) return;
    const nextS = stack[depth + 1];
    for (const m of o.moves) {
      if (!allowedAfter(m, lastFace)) continue;
      for (let i = 0; i < n; i++) nextS[i] = tables[i][s[i] * N_MOVES + m];
      path.push(m);
      dfs(depth + 1, bound, moveFace(m));
      path.pop();
      if (solutions.length >= maxSol) return;
    }
  };

  for (let i = 0; i < n; i++) stack[0][i] = o.start[i];
  for (let bound = h(stack[0]); bound <= o.maxDepth; bound++) {
    dfs(0, bound, -1);
    if (solutions.length) return solutions;
  }
  return [];
}

/** All optimal paths down an exact PDB's distance gradient (up to `limit`). */
export function descend(pdb: PDB, start: number[], moves: number[], limit = 4000): number[][] {
  const tables = pdb.refs.map(tableFor);
  const n = start.length;
  const out: number[][] = [];
  const path: number[] = [];
  const d0 = pdb.dist(start);
  if (d0 === 255) return [];
  const walk = (s: number[], d: number, lastFace: number) => {
    if (out.length >= limit) return;
    if (d === 0) {
      out.push(path.slice());
      return;
    }
    for (const m of moves) {
      if (!allowedAfter(m, lastFace)) continue;
      const t = new Array<number>(n);
      for (let i = 0; i < n; i++) t[i] = tables[i][s[i] * N_MOVES + m];
      if (pdb.dist(t) !== d - 1) continue;
      path.push(m);
      walk(t, d - 1, moveFace(m));
      path.pop();
    }
  };
  walk(start, d0, -1);
  return out;
}

/** Pick the lowest-cost sequence; `cost` scores a single move given its index in the sequence. */
export function pickBest(solutions: number[][], cost: (seq: number[]) => number): number[] {
  let best = solutions[0];
  let bestC = Infinity;
  for (const s of solutions) {
    const c = cost(s);
    if (c < bestC) {
      bestC = c;
      best = s;
    }
  }
  return best;
}

/**
 * Human-feel scoring: prefer R/U/L (and F) over B and D, prefer fewer changes of
 * the turning axis (fewer regrips), and lightly prefer quarter turns.
 */
export function humanCost(weights: Partial<Record<string, number>> = {}) {
  const w: Record<string, number> = { U: 0, R: 0, L: 0.35, F: 0.9, D: 1.1, B: 1.6, ...weights };
  const faces = 'URFDLB';
  return (seq: number[]) => {
    let c = 0;
    let lastAxis = -1;
    for (const m of seq) {
      const f = moveFace(m);
      c += w[faces[f]];
      const axis = f % 3;
      if (lastAxis >= 0 && axis !== lastAxis && axis !== 0 && lastAxis !== 0) c += 0.25;
      lastAxis = axis;
      if (m % 3 === 1) c += 0.05;
    }
    return c;
  };
}
