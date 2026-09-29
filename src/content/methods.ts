/**
 * Method content: copy, key algorithms, camera poses and callouts for every
 * step. Solutions themselves come from src/data/solves.json.
 */
import type { SolveStep } from '../solver/common.ts';

export type MethodId = 'beginner' | 'cfop' | 'zz';

/** Presentation pose of the cube: yaw/pitch in degrees, zoom (1 = default), screen shift. */
export interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  sx: number;
  sy: number;
}

export const pose = (yaw: number, pitch: number, zoom = 0.82, sx = 0.17, sy = 0): Pose => ({ yaw, pitch, zoom, sx, sy });

export interface CalloutSpec {
  /** Solving-frame piece name ("DF", "UFR", "U" for a centre). */
  piece: string;
  /** Preferred sticker face in the solving frame ("D", "F", ...). */
  face?: string;
  title: string;
  text?: string;
}

export interface StepMeta {
  id: string;
  title: string;
  goal: string;
  body: string[];
  algs?: { name: string; moves: string }[];
  pose: Pose;
  /** Pieces that stay lit after the step (others dim slightly while the card is active). */
  focus: string[];
  callouts: (step: SolveStep, moves: number) => CalloutSpec[];
}

export interface MethodMeta {
  id: MethodId;
  name: string;
  full: string;
  tagline: string;
  blurb: string;
  accent: string;
  stats: { value: string; label: string }[];
  steps: StepMeta[];
}

const CROSS = ['DF', 'DR', 'DB', 'DL'];
const FIRST = [...CROSS, 'DFR', 'DFL', 'DBL', 'DBR', 'D'];
const MID = ['FR', 'FL', 'BL', 'BR'];
const F2L = [...FIRST, ...MID, 'F', 'R', 'B', 'L'];
const TOP = ['U', 'UF', 'UR', 'UB', 'UL', 'UFR', 'UFL', 'UBL', 'UBR'];
const ALL = [...F2L, ...TOP];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const METHODS: Record<MethodId, MethodMeta> = {
  beginner: {
    id: 'beginner',
    name: 'Beginner',
    full: 'Layer by Layer',
    tagline: 'The classic. Seven steps, seven short algorithms, one afternoon.',
    blurb: 'Build the cube from the bottom up: a white cross, the first layer, the middle layer, then four short algorithms finish the yellow side.',
    accent: '#5BE39A',
    stats: [
      { value: '~140', label: 'moves' },
      { value: '7', label: 'steps' },
      { value: '7', label: 'algorithms' },
    ],
    steps: [
      {
        id: 'cross',
        title: 'The white cross',
        goal: 'A plus sign on the white face, each edge matching the centre beside it.',
        body: [
          'Keep white on the bottom. We’ll look from underneath, which a real cube can’t do. Find a white edge, turn it next to the centre that matches its other colour, then bring it down.',
          'Centres never move relative to each other. The green centre <em>is</em> green’s home, so match the edges to the centres, not to each other.',
        ],
        pose: pose(-30, -34),
        focus: [...CROSS, 'D', 'F', 'R', 'B', 'L'],
        callouts: (_s, n) => [
          { piece: 'D', face: 'D', title: 'White cross', text: `Four edges around the white centre · ${plural(n, 'move')}` },
          { piece: 'DF', face: 'F', title: 'Edge ↔ centre', text: 'The side colour matches its centre' },
        ],
      },
      {
        id: 'corners',
        title: 'White corners',
        goal: 'Drop the four white corners in to finish the first layer.',
        body: [
          'Turn the top until a white corner sits above its home, the slot between its three colours. Hold that slot at the front-right.',
          'Repeat <b>R U R′ U′</b> until the corner drops in with white facing down. It takes 1, 3 or 5 repetitions, and a corner that’s already home but twisted needs 2 or 4.',
        ],
        algs: [{ name: 'Corner trigger (repeat)', moves: "R U R' U'" }],
        pose: pose(-38, -20),
        focus: FIRST,
        callouts: () => [
          { piece: 'DFR', face: 'F', title: 'Corner home', text: 'White down, sides match their centres' },
          { piece: 'F', face: 'F', title: 'First layer', text: 'Bottom layer complete' },
        ],
      },
      {
        id: 'middle',
        title: 'The middle layer',
        goal: 'Insert the four middle edges to finish two layers.',
        body: [
          'Find a top edge with no yellow. Turn the top until its front colour matches the centre below it, like an upside-down T.',
          'If its top colour matches the centre on the right, insert right. If it matches the left, insert left. An edge stuck upside-down in a slot? Insert any yellow edge there to kick it out.',
        ],
        algs: [
          { name: 'Insert right', moves: "U R U' R' U' F' U F" },
          { name: 'Insert left', moves: "U' L' U L U F U' F'" },
        ],
        pose: pose(-35, 6),
        focus: F2L,
        callouts: () => [
          { piece: 'FR', face: 'F', title: 'Middle edge', text: 'Inserted from the top layer' },
          { piece: 'R', face: 'R', title: 'Two layers', text: 'Only the yellow layer is left' },
        ],
      },
      {
        id: 'yellow-cross',
        title: 'The yellow cross',
        goal: 'Make a yellow plus on top. Ignore the corners for now.',
        body: [
          'Look at the top. You’ll see a dot, an L or a line of yellow edges. One algorithm moves you forward a stage: dot → L → line → cross.',
          'Hold the L at the back-left, and hold the line horizontally, before you run it.',
        ],
        algs: [{ name: 'Yellow cross', moves: "F R U R' U' F'" }],
        pose: pose(-32, 52, 0.8),
        focus: [...F2L, 'U', 'UF', 'UR', 'UB', 'UL'],
        callouts: () => [{ piece: 'U', face: 'U', title: 'Yellow cross', text: 'Edges point up. Corners come later' }],
      },
      {
        id: 'yellow-edges',
        title: 'Yellow edges',
        goal: 'Line each yellow edge up with its side centre.',
        body: [
          'Turn the top until two edges match their centres. Hold those two at the back and right and run the algorithm.',
          'If only opposite edges match, run it once from any angle, then look again.',
        ],
        algs: [{ name: 'Swap edges', moves: "R U R' U R U2 R' U" }],
        pose: pose(-36, 32),
        focus: [...F2L, 'U', 'UF', 'UR', 'UB', 'UL'],
        callouts: () => [
          { piece: 'UF', face: 'F', title: 'Edge matched', text: 'Side colour = centre below' },
          { piece: 'UR', face: 'R', title: 'Edge matched' },
        ],
      },
      {
        id: 'position-corners',
        title: 'Position the corners',
        goal: 'Put every yellow corner in its home, even if it’s twisted.',
        body: [
          'A corner is home when it sits between its three colours, even if it’s twisted. Find one, hold it at the front-right, and cycle the other three.',
          'No corner home yet? Run the algorithm once from anywhere and one will be.',
        ],
        algs: [{ name: 'Cycle corners', moves: "U R U' L' U R' U' L" }],
        pose: pose(-40, 36),
        focus: ALL,
        callouts: () => [{ piece: 'UFR', face: 'F', title: 'Corner home', text: 'Right place, possibly twisted' }],
      },
      {
        id: 'orient-corners',
        title: 'Twist the corners',
        goal: 'Twist the last corners, and the whole cube comes together.',
        body: [
          'Yellow on top, a twisted corner at the front-right. Repeat <b>R′ D′ R D</b> until its yellow faces up (2 or 4 times).',
          'Then turn only the top layer to bring the next twisted corner to the front-right. The bottom looks wrecked halfway through. Trust it: it repairs itself.',
        ],
        algs: [{ name: 'Twist (repeat)', moves: "R' D' R D" }],
        pose: pose(-35, 28),
        focus: ALL,
        callouts: () => [{ piece: 'U', face: 'U', title: 'Solved', text: 'Every face, one colour' }],
      },
    ],
  },

  cfop: {
    id: 'cfop',
    name: 'CFOP',
    full: 'Cross · F2L · OLL · PLL',
    tagline: 'The speedcubing standard. Four steps, and most world records.',
    blurb: 'Jessica Fridrich’s method: an efficient cross, the first two layers paired and inserted together, then the last layer in two algorithms.',
    accent: '#FF8A3D',
    stats: [
      { value: '~57', label: 'moves' },
      { value: '4', label: 'steps' },
      { value: '78', label: 'algorithms' },
    ],
    steps: [
      {
        id: 'cross',
        title: 'Cross',
        goal: 'All four white edges in one go, planned during inspection.',
        body: [
          'Speedcubers plan the whole cross in the 15-second inspection and solve it on the bottom, in eight moves or fewer, so their eyes stay free for what comes next.',
          'This one is optimal: the shortest possible cross for this scramble.',
        ],
        pose: pose(-30, -36),
        focus: [...CROSS, 'D', 'F', 'R', 'B', 'L'],
        callouts: (_s, n) => [
          { piece: 'D', face: 'D', title: `Cross · ${plural(n, 'move')}`, text: 'Optimal for this scramble' },
          { piece: 'DF', face: 'F', title: 'Edge ↔ centre' },
        ],
      },
      {
        id: 'f2l',
        title: 'F2L',
        goal: 'Pair each white corner with its middle edge, and insert both at once.',
        body: [
          'Rather than corners then edges, F2L joins a corner and its edge into a pair in the top layer, then drops them into their slot together.',
          'Good solvers always pick the easiest pair next. If a piece is trapped in the wrong slot, lift it out first. The camera turns with the cube, just as your hands would.',
        ],
        pose: pose(-36, 12),
        focus: F2L,
        callouts: (_s, n) => [
          { piece: 'DFR', face: 'F', title: 'F2L pair', text: 'Corner + edge, inserted together' },
          { piece: 'R', face: 'R', title: `Two layers · ${plural(n, 'move')}` },
        ],
      },
      {
        id: 'oll',
        title: 'OLL',
        goal: 'Orient the last layer: the whole top turns yellow in one algorithm.',
        body: [
          'There are 57 OLL cases, each recognised from the pattern of yellow stickers. Learn 2-look OLL first (10 algorithms), then grow into the full set.',
        ],
        pose: pose(-30, 56, 0.8),
        focus: ALL,
        callouts: (s) => [
          { piece: 'U', face: 'U', title: s.case && s.case.id !== 'skip' ? `OLL ${s.case.id}` : 'OLL', text: s.case ? `${s.case.name} · top face oriented` : 'Top face oriented' },
        ],
      },
      {
        id: 'pll',
        title: 'PLL',
        goal: 'Permute the last layer: every piece home in one final algorithm.',
        body: [
          'There are 21 PLL cases, recognised from the side colours: “headlights”, solved bars, and so on. Then a final turn of the top, and the cube is solved.',
        ],
        pose: pose(-36, 28),
        focus: ALL,
        callouts: (s) => [{ piece: 'UFR', face: 'F', title: 'PLL · solved', text: s.case ? `${s.case.name}, then align the top` : 'Aligned and solved' }],
      },
    ],
  },

  zz: {
    id: 'zz',
    name: 'ZZ',
    full: 'Zbigniew Zborowski',
    tagline: 'Fix every edge first, then solve F2L with just R, U and L.',
    blurb: 'Orient all twelve edges and place a line during inspection. After that, nothing needs F or B, so the blockbuilding stays fast, efficient and rotation-free.',
    accent: '#6EA8FF',
    stats: [
      { value: '~54', label: 'moves' },
      { value: '5', label: 'steps' },
      { value: '28', label: 'algorithms' },
    ],
    steps: [
      {
        id: 'eoline',
        title: 'EOLine',
        goal: 'Make every edge “good”, and put white–green and white–blue on the bottom.',
        body: [
          'An edge is <em>bad</em> if it can’t reach its home without an F or B quarter turn. Each F or B quarter turn flips four edges, so you fix them in batches.',
          'Once they’re all good, place the line. From here on the solve never needs F or B again.',
        ],
        pose: pose(-24, 18),
        focus: ['DF', 'DB', 'D'],
        callouts: () => [
          { piece: 'DF', face: 'F', title: 'The line', text: 'White–green and white–blue' },
          { piece: 'UF', face: 'U', title: 'All edges good', text: 'Now R, U and L can solve F2L' },
        ],
      },
      {
        id: 'left-block',
        title: 'Left block',
        goal: 'Build a 1×2×3 block on the left using only R, U and L.',
        body: [
          'With every edge oriented, pieces can’t arrive flipped, so the blocks go together quickly.',
          'Build a 1×2×2 square first, then pair up the last corner and edge.',
        ],
        pose: pose(28, 14),
        focus: ['DF', 'DB', 'DL', 'DFL', 'DBL', 'FL', 'BL', 'D', 'L'],
        callouts: () => [{ piece: 'L', face: 'L', title: 'Left block', text: '1×2×3, built with R U L' }],
      },
      {
        id: 'right-block',
        title: 'Right block',
        goal: 'Finish F2L on the right with nothing but R and U.',
        body: [
          'Only two faces turn, so there are no regrips. This is where ZZ solvers are fastest. The same square-then-pair plan completes the first two layers.',
        ],
        pose: pose(-50, 14),
        focus: F2L,
        callouts: () => [{ piece: 'R', face: 'R', title: 'Right block', text: 'Two-gen: R and U only' }],
      },
      {
        id: 'ocll',
        title: 'OCLL',
        goal: 'Orient the corners. The yellow cross is already there.',
        body: [
          'Because EO was solved at the start, the top always shows a yellow cross. Only seven cases are left: Sune, Anti-Sune, H, Pi, Headlights, Chameleon and Bowtie.',
        ],
        pose: pose(-30, 56, 0.8),
        focus: ALL,
        callouts: (s) => [
          { piece: 'U', face: 'U', title: s.case && s.case.id !== 'skip' ? `OLL ${s.case.id}` : 'OCLL', text: s.case ? `${s.case.name} · corners oriented` : 'Corners oriented' },
        ],
      },
      {
        id: 'pll',
        title: 'PLL',
        goal: 'Same finish as CFOP: permute the last layer.',
        body: ['Recognise the case from the side colours, run the algorithm, and adjust the top. Solved.'],
        pose: pose(-36, 28),
        focus: ALL,
        callouts: (s) => [{ piece: 'UFR', face: 'F', title: 'PLL · solved', text: s.case ? `${s.case.name}, then align the top` : 'Aligned and solved' }],
      },
    ],
  },
};

export const METHOD_ORDER: MethodId[] = ['beginner', 'cfop', 'zz'];
