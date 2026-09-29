/**
 * Builds src/data/solves.json: a pool of scrambles, each solved with all three
 * methods, every step re-verified by simulation.
 *
 *   node scripts/generate-solves.ts            # default pool
 *   node scripts/generate-solves.ts --count 4  # quick run
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Cube } from '../src/cube/cube.ts';
import { solveBeginner } from '../src/solver/beginner.ts';
import { solveCFOP } from '../src/solver/cfop.ts';
import { solveZZ, eoBits } from '../src/solver/zz.ts';
import { fromCube } from '../src/solver/coords.ts';
import { crossSolved, firstLayerSolved, f2lSolved, ollSolved, countMoves, type MethodSolve } from '../src/solver/common.ts';

const args = process.argv.slice(2);
const argVal = (k: string, d: number) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const COUNT = argVal('--count', 24);
const SEED = argVal('--seed', 20260929);
const OUT = new URL('../src/data/solves.json', import.meta.url);

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
const FACES = 'URFDLB';
const axis = (f: number) => f % 3;

function randomScramble(length = 20): string {
  const out: string[] = [];
  let last = -1;
  let prev = -1;
  while (out.length < length) {
    const f = Math.floor(rng() * 6);
    if (f === last) continue;
    if (last >= 0 && prev >= 0 && axis(f) === axis(last) && axis(f) === axis(prev)) continue;
    out.push(FACES[f] + ['', "'", '2'][Math.floor(rng() * 3)]);
    prev = last;
    last = f;
  }
  return out.join(' ');
}

/** Independent re-check: replay every step and test its goal. */
const GOALS: Record<string, (c: Cube) => boolean> = {
  cross: (c) => crossSolved(fromCube(c)),
  corners: (c) => firstLayerSolved(fromCube(c)),
  middle: (c) => f2lSolved(fromCube(c)),
  'yellow-cross': (c) => f2lSolved(fromCube(c)),
  'yellow-edges': (c) => f2lSolved(fromCube(c)),
  'position-corners': (c) => f2lSolved(fromCube(c)),
  'orient-corners': (c) => c.isSolved(),
  f2l: (c) => f2lSolved(fromCube(c)),
  oll: (c) => f2lSolved(fromCube(c)) && ollSolved(fromCube(c)),
  ocll: (c) => f2lSolved(fromCube(c)) && ollSolved(fromCube(c)),
  pll: (c) => c.isSolved(),
  eoline: (c) => eoBits(fromCube(c)) === 0,
  'left-block': (c) => eoBits(fromCube(c)) === 0,
  'right-block': (c) => f2lSolved(fromCube(c)),
};

function verify(start: Cube, solve: MethodSolve, name: string) {
  const c = start.clone();
  for (const step of solve.steps) {
    for (const part of step.parts) if (part.moves) c.alg(part.moves);
    const g = GOALS[step.id];
    if (!g) throw new Error(`${name}: no goal for ${step.id}`);
    if (!g(c)) throw new Error(`${name}: step ${step.id} does not reach its goal`);
  }
  if (!c.isSolved()) throw new Error(`${name}: not solved`);
}

const stepMoves = (s: MethodSolve, id: string) => s.steps.find((x) => x.id === id)!.parts.reduce((n, p) => n + countMoves(p.moves), 0);

function interesting(b: MethodSolve, c: MethodSolve, z: MethodSolve, start: Cube): boolean {
  if (b.steps.some((s) => s.parts.every((p) => !p.moves))) return false;
  const cross = stepMoves(c, 'cross');
  if (cross < 5) return false;
  const f2l = c.steps.find((s) => s.id === 'f2l')!;
  // Every pair should be a real case (no free pairs, no 3-move inserts).
  if (f2l.parts.some((p) => p.label.startsWith('Pair') && countMoves(p.moves) < 5)) return false;
  // Keep the F2L readable: at most one "free a trapped piece" detour.
  if (f2l.parts.filter((p) => p.label.startsWith('Free')).length > 1) return false;
  for (const s of [...c.steps, ...z.steps]) if (s.case && s.case.id === 'skip') return false;
  const bad = fromCube(start).e.filter((v) => v & 1).length;
  if (bad < 4 || bad > 8) return false;
  if (z.steps.some((s) => s.parts.some((p) => !p.moves && !p.label.startsWith('Set up')))) return false;
  // Beginner solves over ~170 moves make the page drag.
  if (b.moveCount > 165) return false;
  return true;
}

interface Entry {
  scramble: string;
  methods: { beginner: MethodSolve; cfop: MethodSolve; zz: MethodSolve };
}

const pool: Entry[] = [];
const seenOll = new Map<string, number>();
const seenPll = new Map<string, number>();
const seenOcll = new Map<string, number>();
let tried = 0;
const t0 = Date.now();

while (pool.length < COUNT && tried < COUNT * 120) {
  tried++;
  const scramble = randomScramble(20);
  const start = new Cube().alg(scramble).alg('z2');
  const ts = Date.now();
  const beginner = solveBeginner(start);
  const cfop = solveCFOP(start);
  const zz = solveZZ(start);
  verify(start, beginner, 'beginner');
  verify(start, cfop, 'cfop');
  verify(start, zz, 'zz');
  const dt = Date.now() - ts;
  if (!interesting(beginner, cfop, zz, start)) continue;
  // Keep the pool varied: at most two of any OLL / PLL / OCLL case.
  const oll = cfop.steps.find((s) => s.id === 'oll')!.case!.id;
  const pll = cfop.steps.find((s) => s.id === 'pll')!.case!.id;
  const ocll = zz.steps.find((s) => s.id === 'ocll')!.case!.id;
  const zpll = zz.steps.find((s) => s.id === 'pll')!.case!.id;
  if ((seenOll.get(oll) ?? 0) >= 1 || (seenPll.get(pll) ?? 0) >= 2 || (seenOcll.get(ocll) ?? 0) >= 5) continue;
  if ((seenPll.get(zpll) ?? 0) >= 3) continue;
  seenOll.set(oll, (seenOll.get(oll) ?? 0) + 1);
  seenPll.set(pll, (seenPll.get(pll) ?? 0) + 1);
  seenPll.set(zpll, (seenPll.get(zpll) ?? 0) + 1);
  seenOcll.set(ocll, (seenOcll.get(ocll) ?? 0) + 1);
  pool.push({ scramble, methods: { beginner, cfop, zz } });
  console.log(
    `#${String(pool.length).padStart(2)}  ${scramble.padEnd(60)}  LBL ${String(beginner.moveCount).padStart(3)}  CFOP ${String(cfop.moveCount).padStart(2)} (OLL ${oll}, ${pll})  ZZ ${String(zz.moveCount).padStart(2)} (OCLL ${ocll}, ${zpll})  ${dt}ms`,
  );
}

mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), seed: SEED, scrambles: pool }));
const avg = (k: keyof Entry['methods']) => (pool.reduce((n, e) => n + e.methods[k].moveCount, 0) / pool.length).toFixed(1);
console.log(`\n${pool.length} scrambles from ${tried} tries in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`average moves — beginner ${avg('beginner')}, CFOP ${avg('cfop')}, ZZ ${avg('zz')}`);
