# Solve the Cube

An immersive, scroll-driven 3D guide to solving the Rubik's Cube, built around a single real-time WebGL cube. Pick a method and the cube scrambles itself. As you scroll, it solves one step at a time. Callouts with white leader lines point at the pieces that matter, and any step can be replayed in slow motion with the notation lighting up move by move.

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

1. **Hero:** the cube assembles itself from 26 flying pieces, then idles under studio lighting.
2. **Anatomy:** scroll to explode the cube around its core. Centres, edges and corners light up in turn, each with a callout.
3. **Notation:** face letters are labelled on the cube. A live demo shows `R`, `R′` and `R2` with a curved 3D turn arrow. Then it's your turn: a move pad, or type `U D L R F B` (Shift for prime).
4. **Methods:** three cards. Picking one (or a tab in the header) scrambles the cube.
5. **The solve:** one card per step. When a card reaches the middle of the screen, the cube performs that step. The camera moves to the best angle (underneath for the white cross, top-down for OLL), the pieces that matter stay lit while the rest dim, the notation chips light up as each move plays, and callouts appear once the step lands.
6. **Slow motion:** *Watch it slowly* replays a step one move at a time: the move name and a plain-English description, a turn arrow on the moving layer, pause, step back and forth, 0.5×–2× speed, and click-to-seek on any chip. Keyboard: `Space`, `←` `→`, `Esc`. When a person would rotate the cube (for example `y2` to reach a back slot), the camera turns instead, so the notation reads the way cubers write it.
7. **Finish:** move count per step, plus how all three methods did on the *same* scramble, one click away.

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
  ui/                   Callouts, solve cards, slow-motion player, formatting
  app.ts                Scroll choreography and state
scripts/                Solver pipeline and verification
```

## Customising

- **Your name:** `src/config.ts`.
- **Copy, colours, camera angles:** `src/content/methods.ts`. Each method has an accent colour that tints the UI, the rim light and the background glow.
- **Cube look:** `STICKER_HEX` and the materials in `src/three/cubeView.ts`. Lighting and post-processing live in `src/three/stage.ts`.

## Notes

- Smooth scrolling uses [Lenis](https://github.com/darkroomengineering/lenis). It and the idle motion are switched off under `prefers-reduced-motion`.
- The renderer holds 60 fps on a laptop GPU. An adaptive governor lowers the resolution if a device can't keep up, and shaders are pre-compiled behind the loader so nothing stutters on first use.
- Drag the cube to spin it. It springs back to the choreographed pose.

Rubik's Cube® is a trademark of Spin Master Ltd. This is an independent, non-commercial project.
