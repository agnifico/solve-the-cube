/* Sanity tests for the logical cube model. Run: npm test */
import { Cube, parseAlg, invertAlg } from '../src/cube/cube.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    failures++;
    console.log(`✗ ${name} ${extra}`);
  } else console.log(`✓ ${name}`);
}

const SOLVED = 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB';
const solved = () => new Cube();
const rep = (s: string, n: number) => Array(n).fill(s).join(' ');

check('solved facelets', solved().facelets() === SOLVED, solved().facelets());
check('R4 = id', solved().alg('R R R R').isSolved());
check('sexy x6 = id', solved().alg(rep("R U R' U'", 6)).isSolved());
check('(R U)x105 = id', solved().alg(rep('R U', 105)).isSolved());
check('(R U)x35 != id', !solved().alg(rep('R U', 35)).isSolved());
check('T-perm x2 = id', solved().alg(rep("R U R' U' R' F R2 U' R' U' R U R' F'", 2)).isSolved());

// Face turn directions.
check('R brings F to U', solved().alg('R').facelets().slice(0, 9) === 'WWGWWGWWG', solved().alg('R').facelets().slice(0, 9));
check('U brings R to F', solved().alg('U').facelets().slice(18, 27) === 'RRRGGGGGG', solved().alg('U').facelets().slice(18, 27));
check('F brings U to R', solved().alg('F').facelets().slice(9, 18) === 'WRRWRRWRR', solved().alg('F').facelets().slice(9, 18));
check('L brings U to F', solved().alg('L').facelets().slice(18, 27) === 'WGGWGGWGG', solved().alg('L').facelets().slice(18, 27));
check('D brings F to R', solved().alg('D').facelets().slice(9, 18) === 'RRRRRRGGG', solved().alg('D').facelets().slice(9, 18));
check('B brings R to U', solved().alg('B').facelets().slice(0, 9) === 'RRRWWWWWW', solved().alg('B').facelets().slice(0, 9));

// Slices, wide turns and rotations.
const eq = (a: string, b: string) => solved().alg(a).facelets() === solved().alg(b).facelets();
check('r = L x', eq('r', 'L x'));
check("M = R L' x'", eq('M', "R L' x'"));
check("E = U D' y'", eq('E', "U D' y'"));
check("S = F' B z", eq('S', "F' B z"));
check("u = D y", eq('u', 'D y'));
check("f = B z", eq('f', 'B z'));
check('Rw = r', eq('Rw2', 'r2'));
check('y R y\' = B', eq("y R y'", 'B'));
check("x2 keeps it solved-looking", solved().alg('x2').isSolved());

// Inverse.
const scr = "R U2 F' L D B2 R' U F2 D' L2 B U' R2 F";
check('alg + inverse = id', solved().alg(scr).alg(invertAlg(parseAlg(scr))).isSolved());

// Superflip: every edge flipped in place.
const sf = solved().alg("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2").facelets();
let sfOk = true;
for (let f = 0; f < 6; f++) {
  const c = sf[f * 9 + 4];
  for (const i of [0, 2, 6, 8]) if (sf[f * 9 + i] !== c) sfOk = false;
  for (const i of [1, 3, 5, 7]) if (sf[f * 9 + i] === c) sfOk = false;
}
check('superflip', sfOk, sf);

// Piece naming in the solving orientation (after z2 white is on D).
const c = solved();
check('white-green edge is DF', c.piece('DF').home.join() === '0,1,1');
check('white-green-orange corner is DFR', c.piece('DFR').home.join() === '-1,1,1');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
