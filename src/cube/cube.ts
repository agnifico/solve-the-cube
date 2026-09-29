/**
 * Logical 3×3 cube model shared by the offline solver pipeline and the 3D view.
 *
 * Frame: +x = R, +y = U, +z = F. Every one of the 26 visible cubies stores its
 * home position (in the WCA scrambling orientation: white U, green F) plus its
 * current integer position and an integer rotation matrix. Moves are geometric
 * quarter turns of the layers that sit on a given axis, which makes face turns,
 * slices, wide turns and whole-cube rotations all the same operation.
 */

export type Vec3 = [number, number, number];
/** Row-major 3×3 integer rotation matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Axis = 0 | 1 | 2;
export type Color = 'W' | 'Y' | 'G' | 'B' | 'R' | 'O';

export interface Move {
  /** Canonical token, e.g. "R'", "r2", "M", "y'". */
  token: string;
  /** Move family: a face (URFDLB), wide face (urfdlb), slice (MES) or rotation (xyz). */
  base: string;
  axis: Axis;
  layers: readonly number[];
  /** Signed quarter turns about the +axis (right-hand rule). R = -1, R' = +1, R2 = -2. */
  q: number;
}

interface BaseDef {
  axis: Axis;
  layers: number[];
  /** Rotation sign (about +axis) of the clockwise version of the move. */
  dir: number;
}

const ALL = [-1, 0, 1];
const BASES: Record<string, BaseDef> = {
  R: { axis: 0, layers: [1], dir: -1 },
  L: { axis: 0, layers: [-1], dir: 1 },
  U: { axis: 1, layers: [1], dir: -1 },
  D: { axis: 1, layers: [-1], dir: 1 },
  F: { axis: 2, layers: [1], dir: -1 },
  B: { axis: 2, layers: [-1], dir: 1 },
  M: { axis: 0, layers: [0], dir: 1 },
  E: { axis: 1, layers: [0], dir: 1 },
  S: { axis: 2, layers: [0], dir: -1 },
  x: { axis: 0, layers: ALL, dir: -1 },
  y: { axis: 1, layers: ALL, dir: -1 },
  z: { axis: 2, layers: ALL, dir: -1 },
  r: { axis: 0, layers: [0, 1], dir: -1 },
  l: { axis: 0, layers: [-1, 0], dir: 1 },
  u: { axis: 1, layers: [0, 1], dir: -1 },
  d: { axis: 1, layers: [-1, 0], dir: 1 },
  f: { axis: 2, layers: [0, 1], dir: -1 },
  b: { axis: 2, layers: [-1, 0], dir: 1 },
};

export const FACE_BASES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;

/* ------------------------------------------------------------------ math */

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotationMatrix(axis: Axis, k: number): Mat3 {
  const kk = ((k % 4) + 4) % 4;
  const c = [1, 0, -1, 0][kk];
  const s = [0, 1, 0, -1][kk];
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** ROT[axis][k] = rotation by k quarter turns about +axis. */
export const ROT: Mat3[][] = ([0, 1, 2] as Axis[]).map((a) => [0, 1, 2, 3].map((k) => rotationMatrix(a, k)));

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return o;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export const vecEq = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const matEq = (a: Mat3, b: Mat3) => a.every((v, i) => v === b[i]);

/* -------------------------------------------------------------- notation */

const TOKEN_RE = /^([URFDLBurfdlbMESxyz])(w?)(\d?)('?)$/;

export function formatToken(base: string, amount: number): string {
  if (amount === 1) return base;
  if (amount === -1) return `${base}'`;
  if (amount === 2) return `${base}2`;
  if (amount === -2) return `${base}2'`;
  throw new Error(`bad amount ${amount}`);
}

export function parseMove(token: string): Move {
  const m = TOKEN_RE.exec(token);
  if (!m) throw new Error(`Unknown move "${token}"`);
  let base = m[1];
  if (m[2]) {
    if (!'URFDLB'.includes(base)) throw new Error(`Unknown move "${token}"`);
    base = base.toLowerCase();
  }
  const n = m[3] ? parseInt(m[3], 10) : 1;
  if (n < 1 || n > 3) throw new Error(`Unknown move "${token}"`);
  let amount = m[4] ? -n : n;
  if (amount === 3) amount = -1;
  if (amount === -3) amount = 1;
  const def = BASES[base];
  return { token: formatToken(base, amount), base, axis: def.axis, layers: def.layers, q: def.dir * amount };
}

/** Parse an algorithm string. Parentheses, brackets and commas are ignored. */
export function parseAlg(alg: string | readonly Move[]): Move[] {
  if (typeof alg !== 'string') return [...alg];
  return alg
    .replace(/[()[\],]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(parseMove);
}

export function amountOf(m: Move): number {
  return m.q * BASES[m.base].dir;
}

export function invertMove(m: Move): Move {
  const amount = -amountOf(m);
  return { ...m, q: -m.q, token: formatToken(m.base, amount) };
}

export function invertAlg(moves: readonly Move[]): Move[] {
  return moves.slice().reverse().map(invertMove);
}

export const algToString = (moves: readonly Move[]) => moves.map((m) => m.token).join(' ');

export const isRotation = (m: Move) => m.base === 'x' || m.base === 'y' || m.base === 'z';

/* ---------------------------------------------------------------- colors */

/** Colours in the WCA scrambling orientation (white top, green front). */
export function homeColor(n: Vec3): Color {
  if (n[0] === 1) return 'R';
  if (n[0] === -1) return 'O';
  if (n[1] === 1) return 'W';
  if (n[1] === -1) return 'Y';
  if (n[2] === 1) return 'G';
  return 'B';
}

export const COLOR_NAMES: Record<Color, string> = {
  W: 'White',
  Y: 'Yellow',
  G: 'Green',
  B: 'Blue',
  R: 'Red',
  O: 'Orange',
};

/* ----------------------------------------------------------------- cubie */

export interface Cubie {
  /** Stable index 0..25. */
  id: number;
  /** Home position in the WCA orientation. */
  home: Vec3;
  pos: Vec3;
  rot: Mat3;
}

export interface Sticker {
  color: Color;
  /** Sticker normal in the cubie's home frame. */
  homeNormal: Vec3;
  /** Current world normal. */
  normal: Vec3;
}

export function cubieStickers(c: Cubie): Sticker[] {
  const out: Sticker[] = [];
  for (let a = 0; a < 3; a++) {
    if (c.home[a] === 0) continue;
    const n: Vec3 = [0, 0, 0];
    n[a] = c.home[a];
    out.push({ color: homeColor(n), homeNormal: n, normal: mulVec(c.rot, n) });
  }
  return out;
}

/** Position → canonical name, e.g. [1,-1,1] → "DFR", [0,1,1] → "UF", [0,0,1] → "F". */
export function positionName(p: Vec3): string {
  return (p[1] ? (p[1] > 0 ? 'U' : 'D') : '') + (p[2] ? (p[2] > 0 ? 'F' : 'B') : '') + (p[0] ? (p[0] > 0 ? 'R' : 'L') : '');
}

export function positionFromName(name: string): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (const ch of name) {
    if (ch === 'U') p[1] = 1;
    else if (ch === 'D') p[1] = -1;
    else if (ch === 'F') p[2] = 1;
    else if (ch === 'B') p[2] = -1;
    else if (ch === 'R') p[0] = 1;
    else if (ch === 'L') p[0] = -1;
    else throw new Error(`bad position name ${name}`);
  }
  return p;
}

/**
 * The solving orientation used by every method on the site is reached from the
 * WCA orientation with a z2: yellow U, white D, green F, orange R, red L, blue B.
 */
export const toSolvingFrame = (p: Vec3): Vec3 => [-p[0], -p[1], p[2]];

/** Name of the piece in the solving orientation (e.g. the white-green edge is "DF"). */
export const pieceName = (c: Cubie) => positionName(toSolvingFrame(c.home));

export const SOLVING_FACE_COLORS: Record<string, Color> = { U: 'Y', D: 'W', F: 'G', B: 'B', R: 'O', L: 'R' };

/** Colours of a piece in the solving orientation, in name order ("DFR" → White, Green, Orange). */
export function pieceColors(name: string): Color[] {
  return [...name].map((f) => SOLVING_FACE_COLORS[f]);
}

/* ------------------------------------------------------------------ cube */

const FACE_ORDER: { n: Vec3; key: string }[] = [
  { n: [0, 1, 0], key: 'U' },
  { n: [1, 0, 0], key: 'R' },
  { n: [0, 0, 1], key: 'F' },
  { n: [0, -1, 0], key: 'D' },
  { n: [-1, 0, 0], key: 'L' },
  { n: [0, 0, -1], key: 'B' },
];

function faceletIndex(face: string, p: Vec3): number {
  const [x, y, z] = p;
  let row: number;
  let col: number;
  switch (face) {
    case 'U':
      row = z + 1;
      col = x + 1;
      break;
    case 'R':
      row = 1 - y;
      col = 1 - z;
      break;
    case 'F':
      row = 1 - y;
      col = x + 1;
      break;
    case 'D':
      row = 1 - z;
      col = x + 1;
      break;
    case 'L':
      row = 1 - y;
      col = z + 1;
      break;
    default:
      row = 1 - y;
      col = 1 - x;
  }
  return row * 3 + col;
}

export class Cube {
  cubies: Cubie[];

  constructor(cubies?: Cubie[]) {
    if (cubies) {
      this.cubies = cubies;
      return;
    }
    this.cubies = [];
    let id = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          this.cubies.push({ id: id++, home: [x, y, z], pos: [x, y, z], rot: [...IDENTITY] as Mat3 });
        }
      }
    }
  }

  clone(): Cube {
    return new Cube(this.cubies.map((c) => ({ id: c.id, home: c.home, pos: [...c.pos] as Vec3, rot: [...c.rot] as Mat3 })));
  }

  /** Cubies that a move turns, evaluated against the current state. */
  layerCubies(m: Move): Cubie[] {
    return this.cubies.filter((c) => m.layers.includes(c.pos[m.axis]));
  }

  move(m: Move): this {
    const R = ROT[m.axis][((m.q % 4) + 4) % 4];
    for (const c of this.cubies) {
      if (!m.layers.includes(c.pos[m.axis])) continue;
      c.pos = mulVec(R, c.pos);
      c.rot = mulMat(R, c.rot);
    }
    return this;
  }

  alg(alg: string | readonly Move[]): this {
    for (const m of parseAlg(alg)) this.move(m);
    return this;
  }

  /** 54-character facelet string, faces in URFDLB order, using sticker colour letters. */
  facelets(): string {
    const out = new Array<string>(54).fill('?');
    for (const c of this.cubies) {
      for (const s of cubieStickers(c)) {
        const fi = FACE_ORDER.findIndex((f) => vecEq(f.n, s.normal));
        out[fi * 9 + faceletIndex(FACE_ORDER[fi].key, c.pos)] = s.color;
      }
    }
    return out.join('');
  }

  /** Solved means every face shows a single colour (whole-cube orientation is irrelevant). */
  isSolved(): boolean {
    const f = this.facelets();
    for (let i = 0; i < 6; i++) {
      const c = f[i * 9 + 4];
      for (let j = 0; j < 9; j++) if (f[i * 9 + j] !== c) return false;
    }
    return true;
  }

  /** Find a cubie by its solving-frame piece name ("DF", "UFR", ...). */
  piece(name: string): Cubie {
    const home = toSolvingFrame(positionFromName(name));
    const c = this.cubies.find((k) => vecEq(k.home, home));
    if (!c) throw new Error(`no piece ${name}`);
    return c;
  }

  /** Colour currently showing on the face with world normal `n` at position `p`. */
  stickerAt(p: Vec3, n: Vec3): Color | null {
    const c = this.cubies.find((k) => vecEq(k.pos, p));
    if (!c) return null;
    const s = cubieStickers(c).find((st) => vecEq(st.normal, n));
    return s ? s.color : null;
  }

  /** Colour of the centre currently on the face with normal `n`. */
  centerColor(n: Vec3): Color {
    return this.stickerAt(n, n)!;
  }
}
