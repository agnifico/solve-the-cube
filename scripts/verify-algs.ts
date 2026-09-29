/* Proves the OLL/PLL tables are complete and F2L-preserving. Run: node scripts/verify-algs.ts */
import { Cube, invertAlg, mulMat, parseAlg, ROT, vecEq, type Mat3, type Vec3 } from '../src/cube/cube.ts';
import { OLL, PLL, BEGINNER } from '../src/solver/algs.ts';
import { fromCube, CORNER_POS, EDGE_POS } from '../src/solver/coords.ts';
import { f2lSolved, ollSolved, llPatternKey, solvedUpToAuf } from '../src/solver/common.ts';

let bad = 0;
const fail = (msg: string) => {
  bad++;
  console.log('✗', msg);
};

const base = () => new Cube().alg('z2');
const U_LAYER_CORNERS = [0, 1, 2, 3];
const U_LAYER_EDGES = [0, 1, 2, 3];

// ---- every algorithm must keep F2L + centres and leave nothing else broken
for (const a of [...OLL, ...PLL]) {
  const c = base().alg(invertAlg(parseAlg(a.alg)));
  try {
    const p = fromCube(c);
    if (!f2lSolved(p)) fail(`${a.set} ${a.id} breaks F2L`);
    if (a.set === 'PLL' && !ollSolved(p)) fail(`PLL ${a.id} changes orientation`);
    if (a.set === 'PLL' && solvedUpToAuf(c)) fail(`PLL ${a.id} does nothing`);
    if (a.set === 'OLL' && ollSolved(p)) fail(`OLL ${a.id} does nothing`);
  } catch (e) {
    fail(`${a.set} ${a.id}: ${(e as Error).message}`);
  }
}

// ---- OLL: distinct cases and full coverage of the 57 orientation classes
const ollKeys = new Map<string, string>();
for (const a of OLL) {
  const key = llPatternKey(fromCube(base().alg(invertAlg(parseAlg(a.alg)))));
  if (ollKeys.has(key)) fail(`OLL ${a.id} duplicates OLL ${ollKeys.get(key)}`);
  ollKeys.set(key, a.id);
}

function twistMatrix(p: Vec3, t: number): Mat3 {
  const M: Mat3 = [0, 0, 1, 1, 0, 0, 0, 1, 0];
  const S: Mat3 = [p[0], 0, 0, 0, p[1], 0, 0, 0, p[2]];
  const Mp = mulMat(mulMat(S, M), S);
  let r: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < t; i++) r = mulMat(Mp, r);
  return r;
}
function flipMatrix(p: Vec3): Mat3 {
  const o = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = p[i] * p[j] - (i === j ? 1 : 0);
  return o;
}

let ollStates = 0;
const allOllKeys = new Set<string>();
for (let tw = 0; tw < 81; tw++) {
  for (let fl = 0; fl < 16; fl++) {
    const c = base();
    let t = tw;
    for (const ci of U_LAYER_CORNERS) {
      const p = CORNER_POS[ci];
      const k = c.cubies.find((q) => vecEq(q.pos, p))!;
      k.rot = mulMat(twistMatrix(p, t % 3), k.rot);
      t = (t / 3) | 0;
    }
    for (const [i, ei] of U_LAYER_EDGES.entries()) {
      if (!((fl >> i) & 1)) continue;
      const p = EDGE_POS[ei];
      const k = c.cubies.find((q) => vecEq(q.pos, p))!;
      k.rot = mulMat(flipMatrix(p), k.rot);
    }
    const pcs = fromCube(c);
    const coSum = pcs.c.reduce((s, v) => s + (v % 3), 0);
    const eoSum = pcs.e.reduce((s, v) => s + (v % 2), 0);
    if (coSum % 3 !== 0 || eoSum % 2 !== 0) continue;
    ollStates++;
    const key = llPatternKey(pcs);
    allOllKeys.add(key);
    if (ollSolved(pcs)) continue;
    // Recogniser: some AUF + algorithm must orient everything.
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      for (const alg of OLL) {
        const t2 = c.clone().alg('U '.repeat(a) + alg.alg);
        if (ollSolved(fromCube(t2))) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) fail(`OLL state not covered: ${key}`);
  }
}
if (ollStates !== 216) fail(`expected 216 OLL states, got ${ollStates}`);
if (allOllKeys.size !== 58) fail(`expected 58 OLL classes, got ${allOllKeys.size}`);
if (ollKeys.size !== 57) fail(`expected 57 distinct OLL algs, got ${ollKeys.size}`);
console.log(`OLL: ${ollKeys.size} algs, ${ollStates} states, ${allOllKeys.size} classes`);

// ---- PLL: all 288 even permutations of the last layer are solvable
function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i < n; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}
const parity = (p: number[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) s++;
  return s % 2;
};
function yTurnsBetween(a: Vec3, b: Vec3): number {
  for (let k = 0; k < 4; k++) {
    const R = ROT[1][k];
    const r: Vec3 = [R[0] * a[0] + R[2] * a[2], a[1], R[6] * a[0] + R[8] * a[2]];
    if (vecEq(r, b)) return k;
  }
  throw new Error('not in U layer');
}

const perms = permutations(4);
let pllStates = 0;
const pllUsed = new Set<string>();
for (const cp of perms) {
  for (const ep of perms) {
    if (parity(cp) !== parity(ep)) continue;
    pllStates++;
    const c = base();
    const moves: { k: (typeof c.cubies)[number]; to: Vec3 }[] = [];
    cp.forEach((dst, src) => {
      const from = CORNER_POS[U_LAYER_CORNERS[src]];
      moves.push({ k: c.cubies.find((q) => vecEq(q.pos, from))!, to: CORNER_POS[U_LAYER_CORNERS[dst]] });
    });
    ep.forEach((dst, src) => {
      const from = EDGE_POS[U_LAYER_EDGES[src]];
      moves.push({ k: c.cubies.find((q) => vecEq(q.pos, from))!, to: EDGE_POS[U_LAYER_EDGES[dst]] });
    });
    for (const { k, to } of moves) {
      const turns = yTurnsBetween(k.pos, to);
      k.rot = mulMat(ROT[1][turns], k.rot);
      k.pos = to;
    }
    if (solvedUpToAuf(c)) continue;
    let found = '';
    outer: for (let a = 0; a < 4; a++) {
      for (const alg of PLL) {
        const t2 = c.clone().alg('U '.repeat(a) + alg.alg);
        if (solvedUpToAuf(t2)) {
          found = alg.id;
          break outer;
        }
      }
    }
    if (!found) fail(`PLL state not covered: corners ${cp} edges ${ep}`);
    else pllUsed.add(found);
  }
}
if (pllStates !== 288) fail(`expected 288 PLL states, got ${pllStates}`);
for (const a of PLL) if (!pllUsed.has(a.id)) fail(`PLL ${a.id} never needed (duplicate?)`);
console.log(`PLL: ${PLL.length} algs, ${pllStates} states, ${pllUsed.size} used`);

// ---- beginner algorithms keep what they should
{
  const keepsF2L = (alg: string) => f2lSolved(fromCube(base().alg(alg)));
  if (!keepsF2L(BEGINNER.yellowCross)) fail('yellow cross alg breaks F2L');
  if (!keepsF2L(BEGINNER.yellowEdges)) fail('yellow edges alg breaks F2L');
  if (!keepsF2L(BEGINNER.cornerCycle)) fail('corner cycle alg breaks F2L');
  if (!base().alg(Array(6).fill(BEGINNER.cornerTwist).join(' ')).isSolved()) fail("R' D' R D x6 != id");
}

if (bad) {
  console.log(`\n${bad} problem(s)`);
  process.exit(1);
}
console.log('\nall algorithm tables verified');
