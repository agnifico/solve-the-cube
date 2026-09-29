/**
 * Slow-motion player: replays one step move by move with the notation
 * highlighted, turning the camera where a person would rotate the cube.
 */
import type { Director } from '../three/director.ts';
import type { Rig } from '../three/rig.ts';
import type { TurnArrow } from '../three/turnArrow.ts';
import type { Timeline, TPart, TStep } from '../timeline.ts';
import { describe, escapeHTML, pretty } from './format.ts';

const ROT_TOKEN = ['', 'y', 'y2', "y'"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MoveHud {
  private el = document.getElementById('move-hud')!;
  private token = document.getElementById('move-hud-token')!;
  private desc = document.getElementById('move-hud-desc')!;
  private current = '';

  show(tok: string) {
    if (tok !== this.current) {
      this.current = tok;
      this.token.textContent = pretty(tok);
      this.desc.textContent = tok.startsWith('y') && tok.length <= 2 ? 'Turn the whole cube' : describe(tok);
      this.token.classList.remove('is-pop');
      void this.token.offsetWidth;
      this.token.classList.add('is-pop');
    }
    this.el.classList.add('is-on');
  }

  hide() {
    this.el.classList.remove('is-on');
    this.current = '';
  }

  place(x: number, y: number) {
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}

export interface PlayerDeps {
  director: Director;
  rig: Rig;
  arrow: TurnArrow;
  hud: MoveHud;
  /** A new part started (or null when the player closes). */
  onPart: (step: TStep, part: TPart | null) => void;
  onClose: (step: TStep) => void;
}

export class Player {
  private el = document.getElementById('player')!;
  private chips = document.getElementById('player-chips')!;
  private stepEl = document.getElementById('player-step')!;
  private partEl = document.getElementById('player-part')!;
  private noteEl = document.getElementById('player-note')!;
  private bar = document.getElementById('player-bar')!;
  private count = document.getElementById('player-count')!;
  private d: PlayerDeps;
  private tl: Timeline | null = null;
  step: TStep | null = null;
  private playing = false;
  private runId = 0;
  private view = 0;
  private partIndex = -1;
  private chipEls = new Map<number, HTMLElement>();
  private rotEls = new Map<number, HTMLElement>();

  constructor(deps: PlayerDeps) {
    this.d = deps;
    document.getElementById('player-close')!.addEventListener('click', () => this.close());
    document.getElementById('player-toggle')!.addEventListener('click', () => this.toggle());
    document.getElementById('player-next')!.addEventListener('click', () => this.stepBy(1));
    document.getElementById('player-prev')!.addEventListener('click', () => this.stepBy(-1));
    this.el.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        this.d.director.rate = Number(b.dataset.speed);
        this.el.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('is-on', x === b));
      }),
    );
    this.chips.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) this.seek(Number(t.dataset.i));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.stepBy(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.stepBy(-1);
      } else if (e.key === 'Escape') this.close();
    });
    this.d.director.onIndex(() => this.render());
    this.d.director.onMoveStart((move, dir) => {
      if (!this.isOpen || !this.tl) return;
      const i = dir > 0 ? this.d.director.index : this.d.director.index - 1;
      const tok = this.tokenAt(i) ?? move.token;
      // Stepping backwards performs the inverse turn, so name that one.
      const shown = dir > 0 ? tok : tok.endsWith("'") ? tok.slice(0, -1) : tok.endsWith('2') ? tok : `${tok}'`;
      this.d.hud.show(shown);
      this.render(i);
    });
  }

  get isOpen() {
    return !!this.step;
  }

  private tokenAt(i: number): string | null {
    if (!this.step) return null;
    for (const p of this.step.parts) if (i >= p.start && i < p.end) return p.tokens[i - p.start] ?? null;
    return null;
  }

  private partAt(i: number): number {
    if (!this.step) return -1;
    return this.step.parts.findIndex((p) => i >= p.start && i < p.end);
  }

  async open(tl: Timeline, stepIdx: number) {
    const step = tl.steps[stepIdx];
    this.tl = tl;
    this.step = step;
    this.view = 0;
    this.partIndex = -1;
    this.d.arrow.enabled = true;
    this.buildChips();
    this.stepEl.textContent = `Step ${step.number} · ${step.meta.title}`;
    this.el.hidden = false;
    this.d.rig.setView(0);
    const id = ++this.runId;
    this.playing = true;
    this.el.classList.add('is-playing');
    this.render();
    // Rewind to the start of the step (quickly), then play it slowly.
    const dir = this.d.director;
    dir.paused = false;
    dir.go(tl.track, step.start, 'fast');
    await dir.settle();
    if (id !== this.runId) return;
    await sleep(350);
    if (id !== this.runId) return;
    this.run(id);
  }

  private buildChips() {
    const step = this.step!;
    this.chipEls.clear();
    this.rotEls.clear();
    let html = '';
    let prevView = 0;
    step.parts.forEach((p, pi) => {
      if (!p.tokens.length) return;
      if (html) html += '<span class="sep"></span>';
      const rot = (p.view - prevView + 4) % 4;
      if (rot) html += `<span class="mv mv--rot" data-rot="${pi}" title="Turn the whole cube">${pretty(ROT_TOKEN[rot])}</span>`;
      prevView = p.view;
      p.tokens.forEach((t, k) => {
        html += `<span class="mv" data-i="${p.start + k}">${pretty(t)}</span>`;
      });
    });
    this.chips.innerHTML = html;
    this.chips.querySelectorAll<HTMLElement>('[data-i]').forEach((c) => this.chipEls.set(Number(c.dataset.i), c));
    this.chips.querySelectorAll<HTMLElement>('[data-rot]').forEach((c) => this.rotEls.set(Number(c.dataset.rot), c));
  }

  private setPart(pi: number) {
    if (pi === this.partIndex || !this.step) return;
    this.partIndex = pi;
    const part = pi >= 0 ? this.step.parts[pi] : null;
    this.partEl.innerHTML = part ? escapeHTML(part.label) : '';
    this.noteEl.textContent = part?.note ?? '';
    this.d.onPart(this.step, part);
  }

  /** Turn the camera to the part's view if needed (the "y" chip). */
  private async faceView(pi: number, id: number) {
    const part = this.step!.parts[pi];
    if (part.view === this.view) return;
    const rotEl = this.rotEls.get(pi);
    rotEl?.classList.add('is-now');
    this.d.hud.show(ROT_TOKEN[(part.view - this.view + 4) % 4]);
    this.view = part.view;
    this.d.rig.setView(part.view);
    await sleep(820);
    rotEl?.classList.remove('is-now');
    rotEl?.classList.add('is-done');
    if (id !== this.runId) return;
  }

  private async run(id: number) {
    const dir = this.d.director;
    const tl = this.tl!;
    const step = this.step!;
    while (this.playing && id === this.runId) {
      const i = Math.round(dir.position);
      if (i >= step.end) {
        this.playing = false;
        this.el.classList.remove('is-playing');
        this.render();
        break;
      }
      const pi = this.partAt(i);
      if (pi < 0) break;
      this.setPart(pi);
      await this.faceView(pi, id);
      if (!this.playing || id !== this.runId) break;
      dir.go(tl.track, i + 1, 'slow');
      await dir.settle();
    }
  }

  toggle() {
    if (!this.step) return;
    if (this.playing) {
      this.playing = false;
      this.d.director.paused = true;
      this.el.classList.remove('is-playing');
    } else {
      if (Math.round(this.d.director.position) >= this.step.end && this.d.director.frac === 0) {
        void this.open(this.tl!, this.step.number - 1);
        return;
      }
      this.playing = true;
      this.d.director.paused = false;
      this.el.classList.add('is-playing');
      this.run(++this.runId);
    }
  }

  private async stepBy(delta: 1 | -1) {
    if (!this.step || !this.tl) return;
    const dir = this.d.director;
    this.playing = false;
    this.el.classList.remove('is-playing');
    const id = ++this.runId;
    dir.paused = false;
    if (dir.frac > 0) {
      // Finish (or undo) the turn in flight first.
      dir.go(this.tl.track, delta > 0 ? dir.index + 1 : dir.index, 'slow');
      return;
    }
    const i = Math.round(dir.position);
    const to = Math.min(this.step.end, Math.max(this.step.start, i + delta));
    if (to === i) return;
    const pi = this.partAt(delta > 0 ? i : to);
    if (pi >= 0) {
      this.setPart(pi);
      await this.faceView(pi, id);
    }
    if (id !== this.runId) return;
    dir.rate = Math.max(dir.rate, 1);
    dir.go(this.tl.track, to, 'slow');
  }

  private async seek(i: number) {
    if (!this.step || !this.tl) return;
    this.playing = false;
    this.el.classList.remove('is-playing');
    const id = ++this.runId;
    const dir = this.d.director;
    dir.paused = false;
    const pi = this.partAt(i);
    if (pi >= 0) {
      this.setPart(pi);
      this.view = this.step.parts[pi].view;
      this.d.rig.setView(this.view);
    }
    dir.go(this.tl.track, i + 1, 'fast');
    await dir.settle();
    if (id !== this.runId) return;
    this.render();
  }

  close() {
    const step = this.step;
    if (!step || !this.tl) return;
    this.runId++;
    this.playing = false;
    this.el.classList.remove('is-playing');
    this.el.hidden = true;
    this.d.director.paused = false;
    this.d.director.rate = 1;
    this.el.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('is-on', (x as HTMLElement).dataset.speed === '1'));
    this.d.arrow.enabled = false;
    this.d.hud.hide();
    this.d.rig.setView(0);
    this.step = null;
    this.partIndex = -1;
    this.d.onPart(step, null);
    this.d.onClose(step);
  }

  /** Highlight chips and progress. `now` = move in flight (defaults from the director). */
  render(now?: number) {
    const step = this.step;
    if (!step) return;
    const dir = this.d.director;
    const pos = dir.position;
    const cur = now ?? (dir.frac > 0 ? dir.index : dir.index - 1);
    for (const [i, el] of this.chipEls) {
      el.classList.toggle('is-now', i === cur);
      el.classList.toggle('is-done', i < cur);
    }
    const nowEl = this.chipEls.get(cur);
    if (nowEl) {
      const box = this.chips;
      const left = nowEl.offsetLeft - box.clientWidth / 2 + nowEl.offsetWidth / 2;
      box.scrollTo({ left, behavior: 'smooth' });
    }
    const total = step.end - step.start;
    const done = Math.min(total, Math.max(0, pos - step.start));
    this.bar.style.transform = `scaleX(${total ? done / total : 1})`;
    this.count.textContent = `${Math.round(done)} / ${total}`;
  }
}
