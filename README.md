# Solve the Cube

An immersive 3D guide to solving the Rubik's Cube, built around a single real-time WebGL cube: learn the pieces, learn the notation, then solve it step by step in a sandbox. Callouts with white leader lines point at the pieces that matter, and any step can be replayed in slow motion with the notation lighting up move by move.

**Three methods, 24 real scrambles, every move verified by simulation.**

| Method | Steps | Typical moves |
| --- | --- | --- |
| Beginner (layer by layer) | White cross → white corners → middle layer → yellow cross → yellow edges → position corners → twist corners | ~145 |
| CFOP (Fridrich) | Cross → F2L (4 pairs) → OLL (all 57) → PLL (all 21) | ~57 |
| ZZ | EOLine → left block (R U L) → right block (R U) → OCLL → PLL | ~54 |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 (Vite picks the next free port if it's taken)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

`dist/` is plain static files with relative paths. Deploy it anywhere: Vercel, Netlify, GitHub Pages, S3.

## What's on the page

Four pages share one live cube, which flies between their compositions (hash routes, no reloads):

1. **Home** (`#/`): a poster with the cube between the headline's two lines. Scroll down to "the course": three chapters with time estimates. Methods aren't named here; the visitor just starts.
2. **01 Anatomy** (`#/anatomy`): a scroll story. The cube explodes around its core; centres, edges and corners light up in turn, with callouts and subtitle-style captions. A chapter index on the left jumps between beats.
3. **02 Notation** (`#/notation`): face letters on the cube, an auto demo of `R`, `R′` and `R2` with a curved 3D turn arrow, then a move pad (or type `U D L R F B`, Shift for prime).
4. **03 Solve** (`#/solve`): the sandbox, with two modes.
   - **Learn to solve**: one slide per step, with Back / Next, arrow keys, and a step rail along the bottom. Each slide plays its step on the cube, shows the algorithms and this scramble's moves, and offers *Watch it slowly* (move-by-move player: `Space`, `←` `→`, `Esc`, 0.5×–2×). Beginner is the default; CFOP and ZZ sit in the method menu under "Once you can solve it", and the finish slide compares all three on the same scramble. Deep links: `#/solve/cfop`, `#/solve/zz`.
   - **Free play** (`#/solve/play`): move pad, keyboard, or type a whole algorithm (`RUR'U'` works too). Scramble, undo and reset; your moves are written out in notation as you go.

## How the solutions are made

Nothing is hand-scripted. `scripts/generate-solves.ts` runs method-specific solvers offline and writes `src/data/solves.json`:

- **Beginner:** a cross edge at a time (optimal per edge), then the corner trigger `R U R′ U′` and the middle-layer inserts exactly as a beginner guide teaches them, then the four last-layer algorithms.
- **CFOP:** an optimal cross from an exact distance table. F2L picks the easiest pair each time, lifts a piece out of a wrong slot if needed, and inserts using only `U` plus the slot's own two faces, which is how people actually do F2L. OLL and PLL are recognised by brute force against the full 57 + 21 tables.
- **ZZ:** optimal edge orientation, then the line using only moves that keep edges oriented. Blocks are built with `R U L`, then `R U` alone. Then OCLL and PLL.

The OLL and PLL tables follow the CubeSkills sheets by Feliks Zemdegs and Andy Klise, with their numbering and case names. `npm test` proves they're complete: it builds all 216 last-layer orientation states and all 288 permutation states and checks every one is solved by some table entry plus a U turn. Every generated step is then re-verified by replaying it on an independent cube model.

```bash
npm test          # cube model + algorithm table proofs
npm run solves    # regenerate the scramble pool (about 15 s)
```

## Project layout

```
src/
  cube/cube.ts          Logical cube: cubie model; face, slice, wide and rotation moves
  solver/               Offline solvers (not in the browser bundle)
    coords.ts           Fast piece coordinates, move tables derived from geometry
    search.ts           Pattern databases + IDA* collecting every optimal solution
    algs.ts             OLL / PLL / beginner algorithm tables
    beginner.ts cfop.ts zz.ts
  data/solves.json      Generated scramble pool (24 scrambles × 3 methods)
  content/methods.ts    Step copy, key algorithms, camera poses, callouts
  three/
    stage.ts            Renderer, lighting, environment, bloom, film grade
    cubeView.ts         The cube mesh: tiles, turning layers, explode, focus dimming
    director.ts         Playhead over a move track (reversible, speed-adaptive)
    rig.ts              Turntable: scroll poses, slow-mo views, drag-to-spin
    turnArrow.ts        3D arrow showing which way a layer turns
  ui/                   Callouts, guided-solve slides (guideView), slow-motion player, formatting
  app.ts                Routing, scroll choreography, sandbox state
scripts/                Solver pipeline and verification
```

## Customising

- **Your name:** `src/config.ts`.
- **Copy, colours, camera angles:** `src/content/methods.ts`. Each method has an accent colour that tints the UI, the rim light and the background glow.
- **Cube skins:** `src/three/skins.ts`. Both are stickerless, coloured per face on the piece itself: *Speed* (default) is bright and glossy; *Macaron* is soft-touch matte pastel. Each skin carries its palette, plastic and a studio look (exposure, reflections, bloom, background haze), and the UI colour chips follow the palette. Visitors pick one from the header; the choice is remembered.
- **Lighting and post-processing:** `src/three/stage.ts`.

## Notes

- Smooth scrolling uses [Lenis](https://github.com/darkroomengineering/lenis). It and the idle motion are switched off under `prefers-reduced-motion`.
- The renderer holds 60 fps on a laptop GPU. An adaptive governor lowers the resolution if a device can't keep up, and shaders are pre-compiled behind the loader so nothing stutters on first use.
- Drag the cube to spin it. It springs back to the choreographed pose.

Rubik's Cube® is a trademark of Spin Master Ltd. This is an independent, non-commercial project.
