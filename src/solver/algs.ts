/**
 * Last-layer algorithm tables. Numbering, grouping and algorithm choice follow
 * the CubeSkills OLL/PLL sheets (Feliks Zemdegs & Andy Klise). Leading y
 * rotations were dropped (the recogniser tries every AUF, which is equivalent)
 * and mid-algorithm rotations were rewritten, so every algorithm leaves the
 * cube in its original orientation. scripts/verify-algs.ts proves the tables
 * cover all 57 OLL and 21 PLL cases.
 */

export interface LLAlg {
  set: 'OLL' | 'PLL';
  /** Case id: OLL number as a string, or PLL name. */
  id: string;
  /** Display name, e.g. "Sune" or "T-perm". */
  name: string;
  group: string;
  alg: string;
}

const oll = (n: number, group: string, alg: string, name?: string): LLAlg => ({
  set: 'OLL',
  id: String(n),
  name: name ?? group,
  group,
  alg,
});

export const OLL: LLAlg[] = [
  // All edges oriented (OCLL)
  oll(21, 'Cross', "R U2 R' U' R U R' U' R U' R'", 'H'),
  oll(22, 'Cross', "R U2 R2 U' R2 U' R2 U2 R", 'Pi'),
  oll(23, 'Cross', "R2 D R' U2 R D' R' U2 R'", 'Headlights'),
  oll(24, 'Cross', "r U R' U' r' F R F'", 'Chameleon'),
  oll(25, 'Cross', "F' r U R' U' r' F R", 'Bowtie'),
  oll(26, 'Cross', "R U2 R' U' R U' R'", 'Anti-Sune'),
  oll(27, 'Cross', "R U R' U R U2 R'", 'Sune'),
  // T
  oll(33, 'T-shape', "R U R' U' R' F R F'"),
  oll(45, 'T-shape', "F R U R' U' F'"),
  // Squares
  oll(5, 'Square', "r' U2 R U R' U r"),
  oll(6, 'Square', "r U2 R' U' R U' r'"),
  // C
  oll(34, 'C-shape', "R U R2 U' R' F R U R U' F'"),
  oll(46, 'C-shape', "R' U' R' F R F' U R"),
  // W
  oll(36, 'W-shape', "R' U' R U' R' U R U l U' R' U x"),
  oll(38, 'W-shape', "R U R' U R U' R' U' R' F R F'"),
  // Corners oriented, edges flipped
  oll(28, 'Corners oriented', "r U R' U' M U R U' R'", 'Arrow'),
  oll(57, 'Corners oriented', "R U R' U' M' U R U' r'", 'H-edges'),
  // P
  oll(31, 'P-shape', "R' U' F U R U' R' F' R"),
  oll(32, 'P-shape', "R U B' U' R' U R B R'"),
  oll(43, 'P-shape', "R' U' F' U F R"),
  oll(44, 'P-shape', "f R U R' U' f'"),
  // I (line)
  oll(51, 'Line', "f R U R' U' R U R' U' f'"),
  oll(52, 'Line', "R' U' R U' R' U F' U F R"),
  oll(55, 'Line', "R' F R U R U' R2 F' R2 U' R' U R U R'"),
  oll(56, 'Line', "r' U' r U' R' U R U' R' U R r' U r"),
  // Fish
  oll(9, 'Fish', "R U R' U' R' F R2 U R' U' F'"),
  oll(10, 'Fish', "R U R' U R' F R F' R U2 R'"),
  oll(35, 'Fish', "R U2 R2 F R F' R U2 R'"),
  oll(37, 'Fish', "F R U' R' U' R U R' F'"),
  // Knight move
  oll(13, 'Knight', "F U R U' R2 F' R U R U' R'"),
  oll(14, 'Knight', "R' F R U R' F' R F U' F'"),
  oll(15, 'Knight', "r' U' r R' U' R U r' U r"),
  oll(16, 'Knight', "r U r' R U R' U' r U' r'"),
  // Awkward
  oll(29, 'Awkward', "R U R' U' R U' R' F' U' F R U R'"),
  oll(30, 'Awkward', "F U R U2 R' U' R U2 R' U' F'"),
  oll(41, 'Awkward', "R U R' U R U2 R' F R U R' U' F'"),
  oll(42, 'Awkward', "R' U' R U' R' U2 R F R U R' U' F'"),
  // L
  oll(47, 'L-shape', "F' L' U' L U L' U' L U F"),
  oll(48, 'L-shape', "F R U R' U' R U R' U' F'"),
  oll(49, 'L-shape', "r U' r2 U r2 U r2 U' r"),
  oll(50, 'L-shape', "r' U r2 U' r2 U' r2 U r'"),
  oll(53, 'L-shape', "r' U' R U' R' U R U' R' U2 r"),
  oll(54, 'L-shape', "r U R' U R U' R' U R U2 r'"),
  // Lightning bolts
  oll(7, 'Lightning', "r U R' U R U2 r'"),
  oll(8, 'Lightning', "r' U' R U' R' U2 r"),
  oll(11, 'Lightning', "r' R2 U R' U R U2 R' U M'"),
  oll(12, 'Lightning', "M' R' U' R U' R' U2 R U' M"),
  oll(39, 'Lightning', "L F' L' U' L U F U' L'"),
  oll(40, 'Lightning', "R' F R U R' U' F' U R"),
  // No edges oriented (dot)
  oll(1, 'Dot', "R U2 R2 F R F' U2 R' F R F'"),
  oll(2, 'Dot', "F R U R' U' F' f R U R' U' f'"),
  oll(3, 'Dot', "f R U R' U' f' U' F R U R' U' F'"),
  oll(4, 'Dot', "f R U R' U' f' U F R U R' U' F'"),
  oll(17, 'Dot', "R U R' U R' F R F' U2 R' F R F'"),
  oll(18, 'Dot', "R U2 R2 F R F' U2 M' U R U' r'"),
  oll(19, 'Dot', "M U R U R' U' M' R' F R F'"),
  oll(20, 'Dot', "M U R U R' U' M2 U R U' r'"),
];

/** The seven OLLs where all edges are already oriented, as used by ZZ. */
export const OCLL = OLL.filter((a) => Number(a.id) >= 21 && Number(a.id) <= 27);

const pll = (id: string, group: string, alg: string): LLAlg => ({ set: 'PLL', id, name: `${id}-perm`, group, alg });

export const PLL: LLAlg[] = [
  pll('Ua', 'Edges only', "R U' R U R U R U' R' U' R2"),
  pll('Ub', 'Edges only', "R2 U R U R' U' R' U' R' U R'"),
  pll('H', 'Edges only', 'M2 U M2 U2 M2 U M2'),
  pll('Z', 'Edges only', "M2 U M2 U M' U2 M2 U2 M'"),
  pll('Aa', 'Corners only', "x R' U R' D2 R U' R' D2 R2 x'"),
  pll('Ab', 'Corners only', "x R2 D2 R U R' D2 R U' R x'"),
  pll('E', 'Corners only', "x' R U' R' D R U R' D' R U R' D R U' R' D' x"),
  pll('T', 'Adjacent swap', "R U R' U' R' F R2 U' R' U' R U R' F'"),
  pll('F', 'Adjacent swap', "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"),
  pll('Ja', 'Adjacent swap', "R' U L' U2 R U' R' U2 R L"),
  pll('Jb', 'Adjacent swap', "R U R' F' R U R' U' R' F R2 U' R'"),
  pll('Ra', 'Adjacent swap', "R U' R' U' R U R D R' U' R D' R' U2 R'"),
  pll('Rb', 'Adjacent swap', "R' U2 R U2 R' F R U R' U' R' F' R2"),
  pll('Ga', 'G-perm', "R2 U R' U R' U' R U' R2 D U' R' U R D'"),
  pll('Gb', 'G-perm', "F' U' F R2 u R' U R U' R u' R2"),
  pll('Gc', 'G-perm', "R2 U' R U' R U R' U R2 D' U R U' R' D"),
  pll('Gd', 'G-perm', "D' R U R' U' D R2 U' R U' R' U R' U R2"),
  pll('V', 'Diagonal swap', "R U' R U R' D R D' R U' D R2 U R2 D' R2"),
  pll('Y', 'Diagonal swap', "F R U' R' U' R U R' F' R U R' U' R' F R F'"),
  pll('Na', 'Diagonal swap', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"),
  pll('Nb', 'Diagonal swap', "R' U R U' R' F' U' F R U R' F R' F' R U' R"),
];

/** Beginner-method algorithms (fixed-frame versions for the front-right slot). */
export const BEGINNER = {
  cornerInsert: "R U R' U'",
  edgeRight: "U R U' R' U' F' U F",
  edgeLeft: "U' L' U L U F U' F'",
  yellowCross: "F R U R' U' F'",
  yellowEdges: "R U R' U R U2 R' U",
  cornerCycle: "U R U' L' U R' U' L",
  cornerTwist: "R' D' R D",
};
