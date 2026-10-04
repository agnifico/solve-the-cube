/**
 * The guided solve, one slide at a time: slide 0 is the scramble, then one
 * slide per step, then the finish. Also renders the step rail and the method
 * picker (Beginner first; the faster methods are tucked behind it).
 */
import { Cube, type Color } from '../cube/cube.ts';
import { METHODS, METHOD_ORDER, type MethodId } from '../content/methods.ts';
import type { Timeline, TStep } from '../timeline.ts';
import { chipsHTML, escapeHTML, pieceSwatch, pretty } from './format.ts';

export interface GuideHandlers {
  onWatch: (step: number) => void;
  onShuffle: () => void;
  onMethod: (m: MethodId) => void;
  onReplay: () => void;
}

const ROT_TOKEN = ['', 'y', 'y2', "y'"];
const pad = (n: number) => String(n).padStart(2, '0');

/** Where each method sits in the learning path. */
const LEVEL: Record<MethodId, string> = {
  beginner: 'Start here',
  cfop: 'Speedcubing standard',
  zz: 'Advanced',
};

export const slideCount = (tl: Timeline) => tl.steps.length + 2;

/** Short rail label for a slide. */
export function slideLabel(tl: Timeline, k: number): string {
  if (k === 0) return 'Scramble';
  if (k > tl.steps.length) return 'Solved';
  const t = tl.steps[k - 1].meta.title.replace(/^The /, '');
  return t[0].toUpperCase() + t.slice(1);
}

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
  return `<div class="case-badge">${llDiagram(cube, mode)}<span><b>${escapeHTML(algPart.label)}</b><br/><span class="hint">Recognise it, then run</span></span></div>`;
}

function scrambleSlide(tl: Timeline): string {
  const method = METHODS[tl.method];
  const scramble = tl.entry.scramble.split(' ');
  return `
    <p class="slide__eyebrow mono">${escapeHTML(method.full)}</p>
    <h3 class="slide__title">Mix it up</h3>
    <p class="slide__goal">${escapeHTML(method.blurb)}</p>
    <div class="slide__block">
      <div class="slide__label"><span>Hold white on top, green in front, then</span></div>
      <div class="moves">${indexedChips(scramble, 0)}</div>
    </div>
    <div class="inspection"><span class="mv mv--rot" data-i="${tl.scrambleLen}">z2</span><span>Now flip it over so white is on the bottom. Every step starts from here.</span></div>
    <div class="slide__actions">
      <button class="btn btn--ghost btn--sm" type="button" data-shuffle>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5"/></svg>Different scramble
      </button>
    </div>`;
}

function stepSlide(tl: Timeline, step: TStep): string {
  const m = step.meta;
  const algs = m.algs?.length
    ? `<div class="slide__algs">${m.algs
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
    <h3 class="slide__title">${escapeHTML(m.title)}</h3>
    <p class="slide__goal">${escapeHTML(m.goal)}</p>
    <div class="slide__body">${m.body.map((b) => `<p>${b}</p>`).join('')}</div>
    ${algs}
    ${caseBadge(tl, step)}
    <div class="slide__block">
      <div class="slide__label"><span>On this cube</span><b>${step.moves} move${step.moves === 1 ? '' : 's'}</b></div>
      <ol class="parts">${parts}</ol>
    </div>
    <div class="slide__actions">
      <button class="btn btn--ghost btn--sm btn--play" type="button" data-watch="${step.number - 1}" ${step.moves ? '' : 'disabled'}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10l8-5z"/></svg>Watch it slowly
      </button>
      <span class="hint">Move by move, with pauses</span>
    </div>`;
}

function finishSlide(tl: Timeline): string {
  const method = METHODS[tl.method];
  const max = Math.max(...tl.steps.map((s) => s.moves), 1);
  const bars = tl.steps
    .map(
      (s, i) =>
        `<div class="bar"><span class="bar__label">${escapeHTML(s.meta.title)}</span><span class="bar__track"><span class="bar__fill" style="--w:${((s.moves / max) * 100).toFixed(1)}%;--i:${i}"></span></span><span class="bar__val">${s.moves}</span></div>`,
    )
    .join('');
  const others = METHOD_ORDER.filter((id) => id !== tl.method);
  const compare = METHOD_ORDER.map((id) => {
    const mm = METHODS[id];
    const count = tl.entry.methods[id].moveCount;
    const cur = id === tl.method;
    return `<button class="compare__item${cur ? ' is-current' : ''}" type="button" data-method="${id}" style="--dot:${mm.accent}" ${cur ? 'aria-current="true"' : ''}>
      <span class="compare__name"><i></i>${mm.name}</span><b>${count}</b><span>${cur ? 'this solve' : `${LEVEL[id].toLowerCase()} →`}</span></button>`;
  }).join('');
  const nudge =
    tl.method === 'beginner'
      ? `<p class="slide__goal">That’s the whole method: ${tl.total} moves. Once it feels easy, the same scramble goes a lot faster with ${others.map((id) => METHODS[id].name).join(' or ')}.</p>`
      : `<p class="slide__goal">${tl.total} moves with ${escapeHTML(method.name)} on this scramble. Here’s how the three methods compare on it.</p>`;
  return `
    <h3 class="slide__title slide__title--big">Solved.</h3>
    ${nudge}
    <div class="bars">${bars}</div>
    <div class="slide__label" style="margin-top:22px"><span>Same scramble, every method</span></div>
    <div class="compare">${compare}</div>
    <div class="slide__actions">
      <button class="btn btn--accent btn--sm" type="button" data-shuffle>New scramble</button>
      <button class="btn btn--ghost btn--sm" type="button" data-replay>Replay the whole solve</button>
    </div>`;
}

/** Render slide `k` into `body` and wire its buttons. */
export function renderSlide(tl: Timeline, k: number, body: HTMLElement, h: GuideHandlers) {
  const n = tl.steps.length;
  const step = k >= 1 && k <= n ? tl.steps[k - 1] : null;
  const html = k === 0 ? scrambleSlide(tl) : step ? stepSlide(tl, step) : finishSlide(tl);
  body.innerHTML = `<div class="slide${k > n ? ' slide--finish' : ''}" data-slide="${k}"${step ? ` data-start="${step.start}" data-end="${step.end}"` : ''}>${html}</div>`;
  body.scrollTop = 0;
  body.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => h.onWatch(Number(b.dataset.watch))));
  body.querySelectorAll<HTMLButtonElement>('[data-shuffle]').forEach((b) => b.addEventListener('click', () => h.onShuffle()));
  body.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => h.onReplay()));
  body.querySelectorAll<HTMLButtonElement>('.compare__item[data-method]').forEach((b) => {
    if (b.dataset.method !== tl.method) b.addEventListener('click', () => h.onMethod(b.dataset.method as MethodId));
  });
  return body.querySelector<HTMLElement>('.slide')!;
}

/** The step rail along the bottom: one stop per slide. */
export function renderRail(tl: Timeline, rail: HTMLElement, onPick: (k: number) => void) {
  const total = slideCount(tl);
  rail.innerHTML = Array.from({ length: total }, (_, k) => {
    const num = k === 0 ? '00' : k > tl.steps.length ? '✓' : pad(k);
    return `<li><button type="button" class="rail__stop" data-k="${k}"><span class="rail__num mono">${num}</span><span class="rail__label">${escapeHTML(slideLabel(tl, k))}</span></button></li>`;
  }).join('');
  rail.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => onPick(Number(b.dataset.k))));
}

export function updateRail(rail: HTMLElement, k: number) {
  rail.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
    const i = Number(b.dataset.k);
    b.classList.toggle('is-current', i === k);
    b.classList.toggle('is-done', i < k);
    if (i === k) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
}

/** The method picker: Beginner first, the faster methods under it. */
export function renderMethodMenu(menu: HTMLElement, current: MethodId, onPick: (m: MethodId) => void) {
  const item = (id: MethodId) => {
    const m = METHODS[id];
    const steps = m.stats.find((s) => s.label === 'steps')?.value ?? '';
    return `<button type="button" role="menuitemradio" class="method-pick__item" data-method="${id}" aria-checked="${id === current}" style="--dot:${m.accent}">
      <i></i><span><b>${m.name}</b><small>${LEVEL[id]} · ${steps} steps · ${m.stats[0].value} moves</small></span></button>`;
  };
  menu.innerHTML = `${item('beginner')}<p class="method-pick__group mono">Once you can solve it</p>${item('cfop')}${item('zz')}`;
  menu.querySelectorAll<HTMLButtonElement>('[data-method]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.method as MethodId)));
}
