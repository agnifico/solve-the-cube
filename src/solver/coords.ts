/**
 * Fast piece-level coordinates for the offline solvers.
 *
 * Works in the solving orientation (yellow U, white D, green F, orange R) with
 * the 18 face turns only. A piece state packs position and orientation into
 * one small integer: corners pos*3+ori (0..23), edges pos*2+ori (0..23).
 * Orientation conventions:
 *  - corners: 0 when the U/D sticker is on the U/D face,
 *  - edges: the usual F/B-axis "good edge" definition used by ZZ, so
 *    U, D, R and L never change edge orientation while F and B quarter turns do.
 * All tables are derived from the geometric model so they cannot drift from it.
 */
import { Cube, cubieStickers, mulVec, parseMove, ROT, toSolvingFrame, vecEq, type Vec3 } from '../cube/cube.ts';

export const CORNER_POS: Vec3[] = [
  [1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1],
  [1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1],
];
export const CORNER_NAMES = ['UFR', 'UFL', 'UBL', 'UBR', 'DFR', 'DFL', 'DBL', 'DBR'];

export const EDGE_POS: Vec3[] = [
  [1, 1, 0], [0, 1, 1], [-1, 1, 0], [0, 1, -1],
  [1, -1, 0], [0, -1, 1], [-1, -1, 0], [0, -1, -1],
  [1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1],
];
export const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

export const C = Object.fromEntries(CORNER_NAMES.map((n, i) => [n, i])) as Record<string, number>;
export const E = Object.fromEntries(EDGE_NAMES.map((n, i) => [n, i])) as Record<string, number>;

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const MOVE_TOKENS = FACES.flatMap((f) => [f, `${f}2`, `${f}'`]);
export const N_MOVES = 18;
export const moveFace = (m: number) => (m / 3) | 0;
export const OPPOSITE = [3, 4, 5, 0, 1, 2];
export const mv = (token: string) => {
  const i = MOVE_TOKENS.indexOf(token);
  if (i < 0) throw new Error(`not a face move: ${token}`);
  return i;
};
export const movesOf = (faces: string) => [...faces].flatMap((f) => [0, 1, 2].map((p) => FACES.indexOf(f) * 3 + p));
export const ALL_MOVES = movesOf('URFDLB');

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Faces of a corner position ordered: U/D face first, then clockwise as seen from outside. */
export function cornerFaces(p: Vec3): Vec3[] {
  const ny: Vec3 = [0, p[1], 0];
  const nx: Vec3 = [p[0], 0, 0];
  const nz: Vec3 = [0, 0, p[2]];
  return dot(cross(ny, nx), p) < 0 ? [ny, nx, nz] : [ny, nz, nx];
}

/** Faces of an edge position: reference face (U/D, or F/B for E-slice edges) first. */
export function edgeFaces(p: Vec3): Vec3[] {
  const faces: Vec3[] = [];
  if (p[1]) faces.push([0, p[1], 0]);
  if (p[2]) faces.push([0, 0, p[2]]);
  if (p[0]) faces.push([p[0], 0, 0]);
  return faces;
}

const posIndex = (list: Vec3[], p: Vec3) => list.findIndex((q) => vecEq(q, p));

function buildTable(list: Vec3[], faceFn: (p: Vec3) => Vec3[], nOri: number): Uint8Array {
  const t = new Uint8Array(list.length * nOri * N_MOVES);
  for (let m = 0; m < N_MOVES; m++) {
    const mo = parseMove(MOVE_TOKENS[m]);
    const R = ROT[mo.axis][((mo.q % 4) + 4) % 4];
    for (let i = 0; i < list.length; i++) {
      for (let o = 0; o < nOri; o++) {
        const p = list[i];
        const d = faceFn(p)[o];
        let ni = i;
        let no = o;
        if (mo.layers.includes(p[mo.axis])) {
          const p2 = mulVec(R, p);
          const d2 = mulVec(R, d);
          ni = posIndex(list, p2);
          no = faceFn(p2).findIndex((f) => vecEq(f, d2));
        }
        t[(i * nOri + o) * N_MOVES + m] = ni * nOri + no;
      }
    }
  }
  return t;
}

/** CMOVE[state*18+m] → state after move m. */
export const CMOVE = buildTable(CORNER_POS, cornerFaces, 3);
/** EMOVE[state*18+m] → state after move m. */
export const EMOVE = buildTable(EDGE_POS, edgeFaces, 2);

export interface Pieces {
  /** corner piece id → state (pos*3+ori) */
  c: number[];
  /** edge piece id → state (pos*2+ori) */
  e: number[];
}

/** Read piece coordinates from the geometric model (must be in the solving orientation). */
export function fromCube(cube: Cube): Pieces {
  const centerOk =
    cube.centerColor([0, 1, 0]) === 'Y' && cube.centerColor([0, 0, 1]) === 'G' && cube.centerColor([1, 0, 0]) === 'O';
  if (!centerOk) throw new Error('cube is not in the solving orientation');
  const c = new Array<number>(8).fill(-1);
  const e = new Array<number>(12).fill(-1);
  for (const k of cube.cubies) {
    const hs = toSolvingFrame(k.home);
    const nz = hs.filter((v) => v !== 0).length;
    if (nz < 2) continue;
    const stickers = cubieStickers(k);
    if (nz === 3) {
      const id = posIndex(CORNER_POS, hs);
      const ref = stickers.find((s) => s.homeNormal[1] !== 0)!;
      const pi = posIndex(CORNER_POS, k.pos);
      const o = cornerFaces(k.pos).findIndex((f) => vecEq(f, ref.normal));
      c[id] = pi * 3 + o;
    } else {
      const id = posIndex(EDGE_POS, hs);
      const refAxis = hs[1] !== 0 ? 1 : 2;
      const ref = stickers.find((s) => s.homeNormal[refAxis] !== 0)!;
      const pi = posIndex(EDGE_POS, k.pos);
      const o = edgeFaces(k.pos).findIndex((f) => vecEq(f, ref.normal));
      e[id] = pi * 2 + o;
    }
  }
  return { c, e };
}

export const clonePieces = (p: Pieces): Pieces => ({ c: p.c.slice(), e: p.e.slice() });

export function applyMoves(p: Pieces, moves: number[]): Pieces {
  const o = clonePieces(p);
  for (const m of moves) {
    for (let i = 0; i < 8; i++) o.c[i] = CMOVE[o.c[i] * N_MOVES + m];
    for (let i = 0; i < 12; i++) o.e[i] = EMOVE[o.e[i] * N_MOVES + m];
  }
  return o;
}

export const cornerSolved = (p: Pieces, id: number) => p.c[id] === id * 3;
export const edgeSolved = (p: Pieces, id: number) => p.e[id] === id * 2;

export const movesToString = (moves: number[]) => moves.map((m) => MOVE_TOKENS[m]).join(' ');
