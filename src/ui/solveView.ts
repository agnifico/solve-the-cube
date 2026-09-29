/** Renders the solve section: scramble card, one card per step, finish card. */
import { Cube, type Color } from '../cube/cube.ts';
import { METHODS, METHOD_ORDER, type MethodId } from '../content/methods.ts';
import type { Timeline, TStep } from '../timeline.ts';
import { chipsHTML, escapeHTML, pieceSwatch, pretty } from './format.ts';

export interface SolveHandlers {
  onWatch: (step: number) => void;
  onShuffle: () => void;
  onMethod: (m: MethodId) => void;
  onReplay: () => void;
}

const ROT_TOKEN = ['', 'y', 'y2', "y'"];
const pad = (n: number) => String(n).padStart(2, '0');

/** Chips for a part list, with y-rotation chips where the view changes. */
function partChips(step: TStep, i: number): string {
  const prev = i === 0 ? 0 : step.parts[i - 1].view;
  const part = step.parts[i];
  const rot = (part.view - prev + 4) % 4;
  const rotChip = rot && part.tokens.length ? `<span class="mv mv--rot" title="Turn the whole cube">${pretty(ROT_TOKEN[rot])}</span>` : '';
  return rotChip + indexedChips(part.tokens, part.start);
}

/** Chips tagged with their track index so they can light up as the cube plays. */
function indexedChips(tokens: string[], start: number): string {
  return tokens.map((t, k) => `<span class="mv" data-i="${start + k}">${pretty(t)}</span>`).join('');
}

const FACE_START: Record<string, number> = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

/** Top-down last-layer diagram (the usual OLL / PLL picture). */
export function llDiagram(cube: Cube, mode: 'oll' | 'pll'): string {
  const f = cube.facelets();
  const col = (c: string) => (mode === 'oll' ? (c === 'Y' ? 'var(--c-Y)' : '#2b2e37') : `var(--c-${c as Color})`);
  const rects: string[] = [];
  const cell = 20;
  const o = 20;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      rects.push(`<rect x="${o + c * cell + 1}" y="${o + r * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${col(f[FACE_START.U + r * 3 + c])}"/>`);
    }
  }
  const strip = (face: string, cols: number[], place: (i: number) => [number, number, number, number]) => {
    cols.forEach((ci, i) => {
      const [x, y, w, h] = place(i);
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${col(f[FACE_START[face] + ci])}"/>`);
    });
  };
  strip('B', [2, 1, 0], (i) => [o + i * cell + 2, 9, cell - 4, 7]);
  strip('F', [0, 1, 2], (i) => [o + i * cell + 2, 84, cell - 4, 7]);
  strip('L', [0, 1, 2], (i) => [9, o + i * cell + 2, 7, cell - 4]);
  strip('R', [2, 1, 0], (i) => [84, o + i * cell + 2, 7, cell - 4]);
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${rects.join('')}</svg>`;
}

function caseBadge(tl: Timeline, step: TStep): string {
  if (!step.case || step.case.id === 'skip') return '';
  // Picture the case exactly as the algorithm starts (after any set-up turn).
  const algPart = step.parts.find((p) => p.label.startsWith('OLL') || p.label.startsWith('PLL'));
  if (!algPart) return '';
  const cube = new Cube();
  for (let i = 0; i < algPart.start; i++) cube.move(tl.track[i]);
  const mode = step.case.set === 'PLL' ? 'pll' : 'oll';
  return `<div class="case-badge">${llDiagram(cube, mode)}<span><b>${escapeHTML(algPart.label)}</b><br/><span class="step__hint">Recognise it, then run</span></span></div>`;
}

function stepCard(tl: Timeline, step: TStep, total: number): string {
  const m = step.meta;
  const method = METHODS[tl.method];
  const algs = m.algs?.length
    ? `<div class="step__algs">${m.algs
        .map((a) => `<div class="alg"><span class="alg__name">${escapeHTML(a.name)}</span><div class="moves">${chipsHTML(a.moves.split(' '))}</div></div>`)
        .join('')}</div>`
    : '';
  const parts = step.parts
    .map((p, i) => {
      const sw = p.pieces.length && p.pieces.length <= 2 ? pieceSwatch(p.pieces[0]) : '';
      const moves = p.tokens.length ? `<div class="moves">${partChips(step, i)}</div>` : `<span class="part__empty">— already done</span>`;
      return `<li class="part" data-start="${p.start}" data-end="${p.end}"><span class="part__label">${sw}${escapeHTML(p.label)}</span>${moves}</li>`;
    })
    .join('');
  return `
    <li class="step" data-card="${step.number}" id="step-${step.id}" data-start="${step.start}" data-end="${step.end}">
      <div class="step__card">
        <div class="step__meta"><span class="step__num">${pad(step.number)}</span><span>${method.name} · step ${step.number} of ${total}</span></div>
        <h3 class="step__title">${escapeHTML(m.title)}</h3>
        <p class="step__goal">${escapeHTML(m.goal)}</p>
        <div class="step__body">${m.body.map((b) => `<p>${b}</p>`).join('')}</div>
        ${algs}
        ${caseBadge(tl, step)}
        <div class="step__solution">
          <div class="step__solution-head"><span>This scramble</span><b>${step.moves} move${step.moves === 1 ? '' : 's'}</b></div>
          <ol class="parts">${parts}</ol>
        </div>
        <div class="step__actions">
          <button class="btn btn--accent btn--play" type="button" data-watch="${step.number - 1}" ${step.moves ? '' : 'disabled'}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10l8-5z"/></svg>Watch it slowly
          </button>
          <span class="step__hint">Replays this step move by move</span>
        </div>
      </div>
    </li>`;
}

export function renderSolve(tl: Timeline, head: HTMLElement, list: HTMLElement, h: SolveHandlers) {
  const method = METHODS[tl.method];
  const n = tl.steps.length;
  head.innerHTML = `
    <p class="eyebrow">Method · ${escapeHTML(method.full)}</p>
    <h2 class="headline">${escapeHTML(method.name)}<em>.</em></h2>
    <p>${escapeHTML(method.blurb)}</p>`;

  const scramble = tl.entry.scramble.split(' ');
  const scrambleCard = `
    <li class="step step--scramble" data-card="0" id="step-scramble" data-start="0" data-end="${tl.inspectEnd}">
      <div class="step__card">
        <div class="step__meta"><span class="step__num">00</span><span>Scramble</span></div>
        <h3 class="step__title">Mix it up</h3>
        <p class="step__goal">Hold the cube with white on top and green in front, then apply:</p>
        <div class="moves scramble-moves">${indexedChips(scramble, 0)}</div>
        <div class="inspection"><span class="mv mv--rot" data-i="${tl.scrambleLen}">z2</span><span>Inspection: turn the cube over so white is on the bottom. Every step below starts from here.</span></div>
        <div class="step__actions">
          <button class="btn btn--ghost btn--play" type="button" data-shuffle>
            <svg viewBox="0 0 20 20" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:1.6"><path d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5"/></svg>New scramble
          </button>
          <span class="step__hint">${scramble.length} random moves</span>
        </div>
      </div>
    </li>`;

  const max = Math.max(...tl.steps.map((s) => s.moves), 1);
  const bars = tl.steps
    .map(
      (s, i) =>
        `<div class="bar"><span class="bar__label">${escapeHTML(s.meta.title)}</span><span class="bar__track"><span class="bar__fill" style="--w:${((s.moves / max) * 100).toFixed(1)}%;--i:${i}"></span></span><span class="bar__val">${s.moves}</span></div>`,
    )
    .join('');
  const compare = METHOD_ORDER.map((id) => {
    const mm = METHODS[id];
    const count = tl.entry.methods[id].moveCount;
    const cur = id === tl.method;
    return `<button class="compare__item${cur ? ' is-current' : ''}" type="button" data-method="${id}" style="--dot:${mm.accent}" ${cur ? 'aria-current="true"' : ''}>
      <span><i></i>${mm.name}</span><b>${count}</b><span>${cur ? 'this solve' : 'moves · try it →'}</span></button>`;
  }).join('');
  const finishCard = `
    <li class="step finish" data-card="${n + 1}" id="step-finish">
      <div class="step__card">
        <div class="step__meta"><span class="step__num">✓</span><span>${method.name} · complete</span></div>
        <h3 class="finish__title">Solved<em>.</em></h3>
        <p class="step__goal">${tl.total} moves with ${escapeHTML(method.name)} on this scramble.</p>
        <div class="bars">${bars}</div>
        <div class="step__solution-head" style="margin-top:22px"><span>Same scramble, every method</span></div>
        <div class="compare">${compare}</div>
        <div class="finish__actions">
          <button class="btn btn--accent" type="button" data-shuffle>New scramble</button>
          <button class="btn btn--ghost" type="button" data-replay>Replay the whole solve</button>
        </div>
      </div>
    </li>`;

  list.innerHTML = scrambleCard + tl.steps.map((s) => stepCard(tl, s, n)).join('') + finishCard;
  list.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => h.onWatch(Number(b.dataset.watch))));
  list.querySelectorAll<HTMLButtonElement>('[data-shuffle]').forEach((b) => b.addEventListener('click', () => h.onShuffle()));
  list.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => h.onReplay()));
  list.querySelectorAll<HTMLButtonElement>('.compare__item[data-method]').forEach((b) => {
    if (b.dataset.method !== tl.method) b.addEventListener('click', () => h.onMethod(b.dataset.method as MethodId));
  });
  return [...list.querySelectorAll<HTMLElement>('.step')];
}
