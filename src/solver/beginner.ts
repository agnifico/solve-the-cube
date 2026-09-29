/**
 * Beginner layer-by-layer method, solved the way a person following a
 * beginner guide would: cross edges one by one, corners with repeated
 * R U R' U', middle edges with the left/right insert algorithms, then the
 * four last-layer algorithms.
 */
import { Cube } from '../cube/cube.ts';
import { fromCube, C, E, ALL_MOVES, CORNER_NAMES, EDGE_NAMES, edgeSolved, cornerSolved, type Pieces } from './coords.ts';
import { PDB, eRef, stateOf, descend, pickBest, humanCost } from './search.ts';
import { BEGINNER } from './algs.ts';
import {
  CROSS_EDGES,
  D_CORNERS,
  MID_EDGES,
  firstLayerSolved,
  f2lSolved,
  AUF,
  totalMoves,
  type SolveStep,
  type MethodSolve,
} from './common.ts';
import { StepBuilder, pieceLabel, yConj, cleanAlg } from './util.ts';

/* ------------------------------------------------------------ cross */

const crossPdbs = new Map<string, PDB>();
function crossPdb(ids: number[]): PDB {
  const key = ids.slice().sort().join(',');
  let p = crossPdbs.get(key);
  if (!p) {
    p = new PDB(ids.map(eRef), ALL_MOVES);
    crossPdbs.set(key, p);
  }
  return p;
}

const crossCost = humanCost({ D: 0.5, B: 1.4, F: 0.4, L: 0.3 });

function cross(b: StepBuilder) {
  const placed: number[] = [];
  while (placed.length < 4) {
    const p = fromCube(b.cube);
    let best: { id: number; seq: number[] } | null = null;
    for (const id of CROSS_EDGES) {
      if (placed.includes(id)) continue;
      const ids = [...placed, id];
      const pdb = crossPdb(ids);
      const refs = pdb.refs;
      const sols = descend(pdb, stateOf(p, refs), ALL_MOVES, 600);
      const seq = pickBest(sols, crossCost);
      if (!best || seq.length < best.seq.length) best = { id, seq };
    }
    const name = EDGE_NAMES[best!.id];
    b.addMoves(best!.seq, pieceLabel(name), [name], best!.seq.length === 0 ? 'Already in place.' : undefined);
    placed.push(best!.id);
  }
}

/* ---------------------------------------------------------- corners */

// k → (slot corner, U-layer position above it)
const CORNER_SLOTS = [
  { corner: C.DFR, above: C.UFR },
  { corner: C.DBR, above: C.UBR },
  { corner: C.DBL, above: C.UBL },
  { corner: C.DFL, above: C.UFL },
];

const cornerPos = (p: Pieces, id: number) => (p.c[id] / 3) | 0;

function whiteCorners(b: StepBuilder) {
  for (let guard = 0; guard < 12; guard++) {
    const p = fromCube(b.cube);
    const todo = D_CORNERS.filter((id) => !cornerSolved(p, id));
    if (!todo.length) return;
    let best: { moves: string; id: number; reps: number; k: number; inPlace: boolean } | null = null;
    for (const id of todo) {
      const k = CORNER_SLOTS.findIndex((s) => s.corner === id);
      const inPlace = cornerPos(p, id) === id; // in its own slot, just twisted
      if (cornerPos(p, id) > 3 && !inPlace) continue; // stuck in another slot
      for (let a = 0; a < (inPlace ? 1 : 4); a++) {
        const trial = b.cube.clone().alg(AUF[a]);
        if (!inPlace && cornerPos(fromCube(trial), id) !== CORNER_SLOTS[k].above) continue;
        const trigger = yConj(BEGINNER.cornerInsert, k);
        let reps = 0;
        while (reps < 6 && !cornerSolved(fromCube(trial), id)) {
          trial.alg(trigger);
          reps++;
        }
        if (!cornerSolved(fromCube(trial), id)) throw new Error('corner insert failed');
        const moves = cleanAlg(`${AUF[a]} ${Array(reps).fill(trigger).join(' ')}`);
        if (!best || moves.split(' ').length < best.moves.split(' ').length) best = { moves, id, reps, k, inPlace };
      }
    }
    if (best) {
      const name = CORNER_NAMES[best.id];
      b.add(
        best.moves,
        pieceLabel(name),
        [name],
        best.inPlace
          ? `It is home but twisted: repeat R U R' U' ×${best.reps} right where it is.`
          : `Turn the top until it sits above its slot, then repeat R U R' U' ×${best.reps}.`,
        best.k,
      );
      continue;
    }
    // Every unsolved corner is stuck in another bottom slot: pop one out.
    // (Piece ids equal home-position indices, so the slot is the position it sits in.)
    const id = todo[0];
    const k = CORNER_SLOTS.findIndex((s) => s.corner === cornerPos(p, id));
    const name = CORNER_NAMES[id];
    b.add(
      yConj(BEGINNER.cornerInsert, k),
      `Free the ${pieceLabel(name).toLowerCase()}`,
      [name],
      'It is stuck in the wrong slot: one R U R\' U\' lifts it into the top layer.',
      k,
    );
  }
  throw new Error('white corners did not converge');
}

/* ------------------------------------------------------ middle edges */

const MID_SLOTS = [E.FR, E.BR, E.BL, E.FL];

function middleLayer(b: StepBuilder) {
  for (let guard = 0; guard < 12; guard++) {
    const p = fromCube(b.cube);
    const todo = MID_EDGES.filter((id) => !edgeSolved(p, id));
    if (!todo.length) return;
    const solvedBefore = MID_EDGES.filter((id) => edgeSolved(p, id));
    let best: { moves: string; id: number; side: string; k: number } | null = null;
    for (const id of todo) {
      if (((p.e[id] / 2) | 0) > 3) continue;
      for (let k = 0; k < 4; k++) {
        for (let a = 0; a < 4; a++) {
          for (const [side, alg] of [
            ['right', BEGINNER.edgeRight],
            ['left', BEGINNER.edgeLeft],
          ] as const) {
            const moves = cleanAlg(`${AUF[a]} ${yConj(alg, k)}`);
            const t = fromCube(b.cube.clone().alg(moves));
            if (!edgeSolved(t, id) || !firstLayerSolved(t)) continue;
            if (!solvedBefore.every((s) => edgeSolved(t, s))) continue;
            if (!best || moves.split(' ').length < best.moves.split(' ').length) best = { moves, id, side, k };
          }
        }
      }
    }
    if (best) {
      const name = EDGE_NAMES[best.id];
      b.add(
        best.moves,
        pieceLabel(name),
        [name],
        `Turn the top until its front colour matches a centre, then insert it to the ${best.side}.`,
        best.k,
      );
      continue;
    }
    // No insertable edge on top: kick a wrong edge out of its slot.
    const id = todo[0];
    const slotPos = (p.e[id] / 2) | 0;
    const k = Math.max(0, MID_SLOTS.indexOf(slotPos));
    const name = EDGE_NAMES[id];
    b.add(
      yConj(BEGINNER.edgeRight, k),
      `Free the ${pieceLabel(name).toLowerCase()}`,
      [name],
      'It is stuck in the wrong slot (or flipped): insert any yellow edge there to kick it out.',
      k,
    );
  }
  throw new Error('middle layer did not converge');
}

/* --------------------------------------------------- last layer steps */

type Goal = (c: Cube) => boolean;

/** Breadth-first over "AUF + macro" chunks; returns the shortest chunk list reaching the goal. */
function macroSearch(cube: Cube, macros: string[], goal: Goal, maxDepth: number, withAuf = true): string[] | null {
  const aufs = withAuf ? AUF : [''];
  let frontier: { cube: Cube; chunks: string[] }[] = [{ cube, chunks: [] }];
  let best: string[] | null = null;
  let bestLen = Infinity;
  for (let d = 0; d <= maxDepth; d++) {
    for (const node of frontier) {
      if (goal(node.cube)) {
        const len = node.chunks.join(' ').split(' ').filter(Boolean).length;
        if (len < bestLen) {
          best = node.chunks;
          bestLen = len;
        }
      }
    }
    if (best) return best;
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const auf of aufs) {
        for (const m of macros) {
          const chunk = cleanAlg(`${auf} ${m}`);
          next.push({ cube: node.cube.clone().alg(chunk), chunks: [...node.chunks, chunk] });
        }
      }
    }
    frontier = next;
  }
  return null;
}

const topEdgesOriented = (c: Cube) => {
  const p = fromCube(c);
  return [0, 1, 2, 3].every((pos) => {
    const id = p.e.findIndex((s) => ((s / 2) | 0) === pos);
    return p.e[id] % 2 === 0;
  });
};

function crossShape(c: Cube): string {
  const p = fromCube(c);
  const up = [0, 1, 2, 3].map((pos) => p.e[p.e.findIndex((s) => ((s / 2) | 0) === pos)] % 2 === 0);
  const n = up.filter(Boolean).length;
  if (n === 4) return 'cross';
  if (n === 0) return 'dot';
  // positions UR(0) UF(1) UL(2) UB(3): opposite pairs are (0,2) and (1,3)
  if ((up[0] && up[2]) || (up[1] && up[3])) return 'line';
  return 'L-shape';
}

function yellowCross(b: StepBuilder) {
  const chunks = macroSearch(b.cube, [BEGINNER.yellowCross], topEdgesOriented, 3);
  if (!chunks) throw new Error('yellow cross failed');
  for (const ch of chunks) {
    const before = crossShape(b.cube);
    const after = crossShape(b.cube.clone().alg(ch));
    b.add(ch, `${cap(before)} → ${after}`, ['UF', 'UR', 'UB', 'UL'], shapeTip(before));
  }
}

function shapeTip(shape: string): string {
  if (shape === 'dot') return 'No yellow edges up: run the algorithm from any angle.';
  if (shape === 'L-shape') return 'Hold the L at the back-left, then run the algorithm.';
  return 'Hold the line horizontally, then run the algorithm.';
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const topEdgesPlaced = (c: Cube) => {
  const p = fromCube(c);
  return [0, 1, 2, 3].every((id) => p.e[id] === id * 2);
};

function yellowEdges(b: StepBuilder) {
  // Goal: edges match the centres after some AUF; the AUF is part of the answer.
  const goal = (c: Cube) => topEdgesPlaced(c);
  const chunks = macroSearch(b.cube, [BEGINNER.yellowEdges, ''], goal, 3);
  if (!chunks) throw new Error('yellow edges failed');
  for (const ch of chunks) {
    if (!ch.trim()) continue;
    const isAlg = ch.includes('R');
    b.add(
      ch,
      isAlg ? 'Swap edges' : 'Align the top',
      ['UF', 'UR', 'UB', 'UL'],
      isAlg ? 'Two matching edges at the back and right, then run the algorithm.' : 'Turn the top until the edges match their centres.',
    );
  }
}

const cornerPlaced = (p: Pieces, id: number) => ((p.c[id] / 3) | 0) === id;

function positionCorners(b: StepBuilder) {
  const goal = (c: Cube) => {
    const p = fromCube(c);
    return f2lSolved(p) && topEdgesPlaced(c) && [0, 1, 2, 3].every((id) => cornerPlaced(p, id));
  };
  const macros = [0, 1, 2, 3].map((k) => yConj(BEGINNER.cornerCycle, k));
  const chunks = macroSearch(b.cube, macros, goal, 3, false);
  if (!chunks) throw new Error('corner positioning failed');
  for (const ch of chunks) {
    const k = macros.indexOf(ch);
    b.add(
      ch,
      'Cycle three corners',
      ['UFR', 'UFL', 'UBL', 'UBR'],
      'Hold a correctly placed corner at the front-right; the other three rotate around it.',
      k,
    );
  }
}

function orientCorners(b: StepBuilder) {
  const cornerAt = (p: Pieces, pos: number) => p.c.findIndex((s) => ((s / 3) | 0) === pos);
  let n = 0;
  for (let guard = 0; guard < 8; guard++) {
    const p = fromCube(b.cube);
    const unoriented = [0, 1, 2, 3].filter((pos) => p.c[cornerAt(p, pos)] % 3 !== 0);
    if (!unoriented.length) break;
    // Bring the nearest twisted corner to UFR by turning only the top layer.
    let best: { a: number } | null = null;
    for (let a = 0; a < 4; a++) {
      const t = fromCube(b.cube.clone().alg(AUF[a]));
      if (t.c[cornerAt(t, 0)] % 3 !== 0) {
        best = { a };
        break;
      }
    }
    const trial = b.cube.clone().alg(AUF[best!.a]);
    // Track the corner itself: each R' D' R D swaps it with the bottom corner,
    // so it is only back at UFR (state 0 = UFR, twist 0) after an even count.
    const id = cornerAt(fromCube(trial), 0);
    let reps = 0;
    while (reps < 6 && fromCube(trial).c[id] !== 0) {
      trial.alg(BEGINNER.cornerTwist);
      reps++;
    }
    if (fromCube(trial).c[id] !== 0) throw new Error('corner twist failed');
    n++;
    const moves = cleanAlg(`${AUF[best!.a]} ${Array(reps).fill(BEGINNER.cornerTwist).join(' ')}`);
    b.add(
      moves,
      `Twist corner ${n}`,
      ['UFR'],
      `Repeat R' D' R D ×${reps} until yellow faces up. The bottom scrambles for now — it fixes itself.`,
    );
  }
  for (const auf of AUF) {
    if (b.cube.clone().alg(auf).isSolved()) {
      if (auf) b.add(auf, 'Final turn', [], 'Turn the top layer to finish.');
      return;
    }
  }
  throw new Error('orient corners did not finish the cube');
}

/* ------------------------------------------------------------ public */

export function solveBeginner(start: Cube): MethodSolve {
  const cube = start.clone();
  const steps: SolveStep[] = [];
  const run = (id: string, fn: (b: StepBuilder) => void) => {
    const b = new StepBuilder(cube);
    fn(b);
    steps.push({ id, parts: b.parts });
  };
  run('cross', cross);
  run('corners', whiteCorners);
  run('middle', middleLayer);
  run('yellow-cross', yellowCross);
  run('yellow-edges', yellowEdges);
  run('position-corners', positionCorners);
  run('orient-corners', orientCorners);
  if (!cube.isSolved()) throw new Error('beginner solve failed');
  return { steps, moveCount: totalMoves(steps) };
}
