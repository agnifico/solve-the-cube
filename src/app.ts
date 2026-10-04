/**
 * Orchestration. Four pages share one live cube: Home, 01 Anatomy and
 * 02 Notation (scroll stories), and 03 Solve, a sandbox with a slide-by-slide
 * guided solve ("learn") and a free notation playground ("play"). The router
 * swaps pages; the cube flies between their compositions.
 */
import Lenis from 'lenis';
import { parseMove, pieceColors, pieceName, vecEq, type Move, type Vec3 } from './cube/cube.ts';
import { METHODS, METHOD_ORDER, pose, type CalloutSpec, type MethodId, type Pose } from './content/methods.ts';
import { buildTimeline, type Entry, type Timeline, type TPart, type TStep } from './timeline.ts';
import { Stage } from './three/stage.ts';
import { CubeView } from './three/cubeView.ts';
import { Director, type Mode } from './three/director.ts';
import { Rig } from './three/rig.ts';
import { TurnArrow } from './three/turnArrow.ts';
import { DEFAULT_SKIN, SKINS, SKIN_ORDER, type SkinId } from './three/skins.ts';
import { Callouts, type CalloutDef } from './ui/callouts.ts';
import { MoveHud, Player } from './ui/player.ts';
import { renderMethodMenu, renderRail, renderSlide, slideCount, slideLabel, updateRail } from './ui/guideView.ts';
import { describe, escapeHTML, pretty, pieceTitle } from './ui/format.ts';
import { SITE } from './config.ts';
import solvesData from './data/solves.json';

const POSES = {
  hero: pose(-34, 24, 0.8, 0, 0.01),
  path: pose(-14, 38, 0.46, 0, -0.04),
  anatomy: pose(-38, 24, 0.62, 0, -0.08),
  notation: pose(-32, 20, 0.8, 0, -0.1),
  play: pose(-34, 24, 0.72, 0, -0.03),
  head: pose(-30, 22, 0.84, 0.19),
  finish: pose(-36, 28, 0.76, 0.2),
};

const CENTRES = ['U', 'D', 'F', 'B', 'L', 'R'];
const FACES = ['R', 'L', 'U', 'D', 'F', 'B'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Page = 'home' | 'anatomy' | 'notation' | 'solve';
type SolveMode = 'learn' | 'play';

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  yaw: a.yaw + (b.yaw - a.yaw) * t,
  pitch: a.pitch + (b.pitch - a.pitch) * t,
  zoom: a.zoom + (b.zoom - a.zoom) * t,
  sx: a.sx + (b.sx - a.sx) * t,
  sy: a.sy + (b.sy - a.sy) * t,
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** A random-move scramble with no two consecutive turns on the same axis. */
function randomScramble(len = 20): Move[] {
  const axis: Record<string, number> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
  const out: Move[] = [];
  let last = -1;
  while (out.length < len) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (axis[f] === last) continue;
    last = axis[f];
    out.push(parseMove(f + ['', "'", '2'][Math.floor(Math.random() * 3)]));
  }
  return out;
}

/** "RUR′U′" or "R U R' U'" → moves. Throws on anything it can't read. */
function readAlg(text: string): Move[] {
  const clean = text.replace(/[′’‘`´]/g, "'").replace(/[()[\],]/g, ' ');
  const re = /([URFDLBurfdlbMESxyz])(w?)(\d?)('?)|(\S)/g;
  const out: Move[] = [];
  for (const m of clean.matchAll(re)) {
    if (m[5]) throw new Error(`Unknown move near “${m[5]}”`);
    out.push(parseMove(m[0]));
  }
  return out;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const SKIN_KEY = 'solve-the-cube:skin';
function savedSkin(): SkinId {
  try {
    const v = localStorage.getItem(SKIN_KEY) as SkinId | null;
    return v && v in SKINS ? v : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

export class App {
  private stage: Stage;
  private view = new CubeView();
  private director: Director;
  private rig: Rig;
  private arrow: TurnArrow;
  private callouts: Callouts;
  private hud = new MoveHud();
  private player: Player;
  private lenis: Lenis | null = null;

  private page: Page = 'home';
  private mode: SolveMode = 'learn';

  // Guided solve.
  private pool: Entry[];
  private method: MethodId = SITE.defaultMethod;
  private entryIndex = 0;
  private tl!: Timeline;
  private slide = 0;
  private slideEl: HTMLElement | null = null;
  private replaying = false;
  /** Slides whose finished state has already had its glow pulse. */
  private flashed = new Set<number>();

  // Notation demo track and the sandbox's free-play track.
  private free: Move[] = [];
  private play: Move[] = [];
  private playHead = 0;
  private playScrambled = 0;
  private wasSolved = true;

  // Story pages.
  private story = { top: 0, height: 1, beats: 1, nextTop: Infinity };
  private beat = -1;
  private demoAt = 0;
  private demoStep = 0;
  private demoBeat = -1;
  private userPlayed = false;

  private calloutKey = '';
  private lastGo = { track: null as Move[] | null, target: -1, mode: '' as Mode | '' };
  private time = 0;
  private last = 0;
  private introStart = -1;
  private lastBusy = 0;

  constructor() {
    const canvas = $<HTMLCanvasElement>('#gl');
    this.stage = new Stage(canvas);
    this.stage.scene.add(this.view.root);
    this.director = new Director(this.view);
    this.rig = new Rig(this.stage, this.view, canvas);
    this.arrow = new TurnArrow(this.view);
    this.callouts = new Callouts(document.getElementById('callout-lines') as unknown as SVGSVGElement, $('#callout-labels'), this.stage);
    this.player = new Player({
      director: this.director,
      rig: this.rig,
      arrow: this.arrow,
      hud: this.hud,
      onPart: (s, p) => this.onPlayerPart(s, p),
      onClose: () => {
        this.calloutKey = '';
        this.lastGo.track = null;
        document.body.classList.remove('player-open');
      },
    });
    this.pool = (solvesData as unknown as { scrambles: Entry[] }).scrambles;
    this.entryIndex = Math.floor(Math.random() * this.pool.length);

    this.director.onMoveStart((m, dir) => {
      this.arrow.show(m, dir, this.stage.camera, this.time);
      if (this.hudContext() && !this.player.isOpen && dir > 0) this.hud.show(m.token);
      this.syncChips(dir > 0 ? this.director.index : this.director.index - 1);
    });
    this.director.onIndex(() => {
      this.syncChips();
      if (this.director.track === this.play) this.renderHistory();
    });

    document.querySelectorAll('[data-author]').forEach((el) => (el.textContent = SITE.author));
    this.buildSkinPicker();
    this.buildMovepads();
    this.buildStoryIndex();
    this.buildGuide();
    this.buildDock();
    this.initScroll();
    this.observeReveals();
    this.loadTimeline();

    window.addEventListener('resize', () => {
      this.stage.resize();
      this.measure();
      this.positionPills();
    });
    new ResizeObserver(() => this.measure()).observe($('#main'));
    document.fonts?.ready.then(() => {
      this.measure();
      this.positionPills();
    });
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('keydown', (e) => this.onKey(e));

    this.view.intro = reducedMotion ? 1 : 0;
    this.route(true);
    this.director.draw();
    requestAnimationFrame((t) => this.frame(t));
    void this.runLoader();
  }

  /* ------------------------------------------------------------ routing */

  private route(first = false) {
    // In-page anchors (like #path) aren't routes.
    const isRoute = !location.hash || location.hash.startsWith('#/');
    if (!isRoute && !first) return;
    const parts = isRoute ? location.hash.replace(/^#\/?/, '').split('/').filter(Boolean) : [];
    const page = (['anatomy', 'notation', 'solve'].includes(parts[0]) ? parts[0] : 'home') as Page;
    if (page === 'solve') {
      const sub = parts[1];
      if (sub && (METHOD_ORDER as string[]).includes(sub) && sub !== this.method) this.selectMethod(sub as MethodId, { newScramble: true });
      this.showPage(page, first);
      this.setMode(sub === 'play' ? 'play' : 'learn');
    } else this.showPage(page, first);
  }

  private showPage(page: Page, first = false) {
    if (page === this.page && !first) return;
    if (this.player.isOpen) this.player.close();
    this.replaying = false;
    this.page = page;
    document.body.dataset.page = page;
    document.querySelectorAll<HTMLElement>('.page').forEach((el) => {
      const on = el.dataset.page === page;
      el.classList.toggle('is-current', on);
      el.hidden = !on;
      // Let reveals replay next time this page is shown.
      if (!on) el.querySelectorAll('.reveal.is-in').forEach((r) => r.classList.remove('is-in'));
    });
    document.querySelectorAll<HTMLElement>('.chapters__link').forEach((a) => {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    this.beat = -1;
    this.demoBeat = -1;
    this.calloutKey = '';
    this.callouts.clear();
    this.view.setFocus(null);
    this.hud.hide();
    if (this.lenis) this.lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
    this.measure();
    this.positionPills();
    const title = { home: 'Solve the Cube — an interactive 3D guide', anatomy: '01 Anatomy · Solve the Cube', notation: '02 Notation · Solve the Cube', solve: '03 Solve · Solve the Cube' };
    document.title = title[page];
  }

  private setMode(mode: SolveMode) {
    if (this.player.isOpen) this.player.close();
    this.replaying = false;
    this.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll<HTMLElement>('.modes__btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    this.calloutKey = '';
    this.callouts.clear();
    this.view.setFocus(null);
    this.positionPills();
    if (mode === 'play') this.renderHistory();
  }

  private hudContext() {
    return this.page === 'notation' || (this.page === 'solve' && this.mode === 'play');
  }

  /* ------------------------------------------------------------ setup */

  private positionPills() {
    const place = (pill: HTMLElement | null, target: HTMLElement | null) => {
      if (!pill) return;
      pill.classList.toggle('is-on', !!target);
      if (!target) return;
      pill.style.width = `${target.offsetWidth}px`;
      pill.style.transform = `translateX(${target.offsetLeft}px)`;
    };
    place(document.querySelector('.chapters__pill'), document.querySelector<HTMLElement>(`.chapters__link[data-page="${this.page}"]`));
    place(document.querySelector('.modes__pill'), document.querySelector<HTMLElement>(`.modes__btn[data-mode="${this.mode}"]`));
  }

  private buildSkinPicker() {
    const pick = $('#skin-pick');
    const btn = pick.querySelector<HTMLButtonElement>('.skin-pick__btn')!;
    const menu = pick.querySelector<HTMLElement>('.skin-pick__menu')!;
    const swatch = () => '<span class="swatch4" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
    menu.innerHTML = SKIN_ORDER.map((id) => {
      const k = SKINS[id];
      return `<button type="button" role="menuitemradio" class="skin-pick__item" data-skin="${id}">${swatch().replace('class="swatch4"', `class="swatch4" data-skin="${id}"`)}<span><b>${k.name}</b><small>${k.note}</small></span></button>`;
    }).join('');
    const setOpen = (open: boolean) => {
      pick.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!pick.classList.contains('is-open'));
    });
    menu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-skin]');
      if (!item) return;
      this.applySkin(item.dataset.skin as SkinId);
      setOpen(false);
    });
    document.addEventListener('click', (e) => {
      if (!pick.contains(e.target as Node)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
    this.applySkin(savedSkin(), true);
  }

  private applySkin(id: SkinId, immediate = false) {
    const skin = SKINS[id];
    this.view.setSkin(id);
    this.stage.setLook(skin.look, immediate);
    document.body.dataset.skin = id;
    $('.skin-pick__name').textContent = skin.name;
    $('.skin-pick__btn .swatch4').dataset.skin = id;
    document.querySelectorAll<HTMLElement>('.skin-pick__item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.skin === id)));
    if (!immediate) {
      // A little celebratory pulse so the change registers.
      this.view.flash(this.view.pieces.map((p) => p.name), 0.6);
      try {
        localStorage.setItem(SKIN_KEY, id);
      } catch {
        /* private mode: the choice just won't stick */
      }
    }
  }

  private buildMovepads() {
    document.querySelectorAll<HTMLElement>('[data-movepad]').forEach((pad) => {
      pad.innerHTML = [...FACES, ...FACES.map((f) => `${f}'`)]
        .map((t) => `<button type="button" data-move="${t}" aria-label="${t} — ${describe(t)}">${pretty(t)}</button>`)
        .join('');
      pad.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move]');
        if (b) this.padMove(b.dataset.move!);
      });
      pad.addEventListener('pointerover', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move]');
        if (b && pad.classList.contains('movepad--dock')) this.setPadHint(`<b>${pretty(b.dataset.move!)}</b> · ${describe(b.dataset.move!)}`);
      });
    });
  }

  private padMove(tok: string) {
    if (this.page === 'notation') this.playFree(tok);
    else if (this.page === 'solve' && this.mode === 'play') this.playMoves([parseMove(tok)], 'auto');
    document.querySelectorAll<HTMLElement>(`[data-move="${tok}"]`).forEach((btn) => {
      btn.classList.add('is-hit');
      setTimeout(() => btn.classList.remove('is-hit'), 160);
    });
  }

  private onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = (e.target as HTMLElement).closest?.('input, textarea');
    if (typing) return;
    if (this.page === 'solve' && this.mode === 'learn' && !this.player.isOpen) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.goSlide(this.slide + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goSlide(this.slide - 1);
      }
      return;
    }
    if (!this.hudContext()) return;
    const k = e.key.toUpperCase();
    if (k.length !== 1 || !'UDLRFB'.includes(k)) return;
    this.padMove(e.shiftKey ? `${k}'` : k);
  }

  private buildStoryIndex() {
    document.querySelectorAll<HTMLButtonElement>('.story__index [data-beat]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = this.story;
        const beat = Number(b.dataset.beat);
        this.scrollTo(s.top + ((beat + 0.5) / s.beats) * (s.height - window.innerHeight), 1.2);
      }),
    );
  }

  private buildGuide() {
    $('#guide-prev').addEventListener('click', () => this.goSlide(this.slide - 1));
    $('#guide-next').addEventListener('click', () => {
      if (this.slide >= slideCount(this.tl) - 1) this.shuffle();
      else this.goSlide(this.slide + 1);
    });
    const pick = $('#method-pick');
    const btn = pick.querySelector<HTMLButtonElement>('.method-pick__btn')!;
    const setOpen = (open: boolean) => {
      pick.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!pick.classList.contains('is-open'));
    });
    document.addEventListener('click', (e) => {
      if (!pick.contains(e.target as Node)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  }

  private buildDock() {
    $('#play-scramble').addEventListener('click', () => {
      this.play = randomScramble();
      this.playHead = this.play.length;
      this.playScrambled = this.play.length;
      this.wasSolved = false;
      this.go(this.play, this.playHead, 'scramble');
      this.setPadHint('Scrambled. Now try to undo the damage, or just explore.');
      this.renderHistory();
    });
    $('#play-undo').addEventListener('click', () => {
      if (this.playHead <= 0) return;
      this.playHead--;
      this.playScrambled = Math.min(this.playScrambled, this.playHead);
      this.go(this.play, this.playHead, 'auto');
      this.renderHistory();
    });
    $('#play-reset').addEventListener('click', () => {
      this.playHead = 0;
      this.playScrambled = 0;
      this.wasSolved = true;
      this.go(this.play, 0, 'fast');
      this.renderHistory();
    });
    const form = $<HTMLFormElement>('#alg-form');
    const input = $<HTMLInputElement>('#alg-input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const moves = readAlg(input.value);
        if (!moves.length) return;
        this.playMoves(moves, 'demo');
        input.blur();
      } catch (err) {
        form.classList.remove('is-bad');
        void form.offsetWidth;
        form.classList.add('is-bad');
        this.setPadHint(escapeHTML((err as Error).message));
      }
    });
  }

  private setPadHint(html: string) {
    $('#pad-hint').innerHTML = html;
  }

  private playFree(token: string) {
    this.userPlayed = true;
    // Truncate anything beyond where we're heading, then append.
    this.free.length = Math.min(this.free.length, this.director.track === this.free ? this.director.target : 0);
    this.free.push(parseMove(token));
    this.go(this.free, this.free.length, 'auto');
  }

  private playMoves(moves: Move[], mode: Mode) {
    this.play.length = this.playHead;
    this.play.push(...moves);
    this.playHead = this.play.length;
    this.go(this.play, this.playHead, mode);
    this.renderHistory();
  }

  /** The sandbox's running notation: the scramble, then your own moves. */
  private renderHistory() {
    const el = $('#history');
    const onTrack = this.director.track === this.play;
    const at = onTrack ? this.director.index : 0;
    const chip = (m: Move, i: number) => `<span class="mv${i < at ? '' : ' is-ahead'}" data-i="${i}">${pretty(m.token)}</span>`;
    const scr = this.play.slice(0, Math.min(this.playScrambled, this.playHead));
    const mine = this.play.slice(scr.length, this.playHead);
    let html = '';
    if (scr.length) html += `<span class="history__label mono">Scramble</span><span class="history__group history__group--dim">${scr.map(chip).join('')}</span>`;
    if (mine.length) html += `<span class="history__label mono">You</span><span class="history__group">${mine.map((m, i) => chip(m, i + scr.length)).join('')}</span>`;
    if (!html) html = `<span class="history__empty">Your moves will appear here, written in notation.</span>`;
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      el.scrollLeft = el.scrollWidth;
    }
  }

  private applyAccent() {
    const hex = METHODS[this.method].accent;
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(hex));
    this.stage.setAccent(hex);
  }

  private initScroll() {
    if (!reducedMotion) this.lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
    document.querySelectorAll<HTMLAnchorElement>('a[data-scroll]').forEach((a) =>
      a.addEventListener('click', (e) => {
        const el = document.querySelector(a.getAttribute('href')!);
        if (!el) return;
        e.preventDefault();
        this.scrollTo(el.getBoundingClientRect().top + window.scrollY);
      }),
    );
  }

  private scrollTo(y: number, duration = 1.6) {
    if (this.lenis) this.lenis.scrollTo(y, { duration, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else window.scrollTo({ top: y, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  private observeReveals() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) e.target.classList.add('is-in');
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------- guided solve */

  private randomEntry(): number {
    if (this.pool.length < 2) return 0;
    let i = this.entryIndex;
    while (i === this.entryIndex) i = Math.floor(Math.random() * this.pool.length);
    return i;
  }

  private loadTimeline() {
    this.tl = buildTimeline(this.method, this.pool[this.entryIndex]);
    this.applyAccent();
    renderRail(this.tl, $('#rail'), (k) => this.goSlide(k));
    renderMethodMenu($('.method-pick__menu'), this.method, (m) => {
      $('#method-pick').classList.remove('is-open');
      if (m !== this.method) this.selectMethod(m, { newScramble: false });
    });
    const m = METHODS[this.method];
    $('.method-pick__name').textContent = `${m.name} method`;
    $('#method-pick').style.setProperty('--dot', m.accent);
    this.flashed.clear();
    this.goSlide(0, true);
  }

  private goSlide(k: number, force = false) {
    const total = slideCount(this.tl);
    k = Math.max(0, Math.min(total - 1, k));
    if (k === this.slide && !force) return;
    if (this.player.isOpen) this.player.close();
    this.replaying = false;
    this.slide = k;
    this.calloutKey = '';
    this.slideEl = renderSlide(this.tl, k, $('#guide-body'), {
      onWatch: (i) => this.watch(i),
      onShuffle: () => this.shuffle(),
      onMethod: (m) => this.selectMethod(m, { newScramble: false }),
      onReplay: () => void this.replay(),
    });
    if (k === 0) Object.assign(this.slideEl.dataset, { start: '0', end: String(this.tl.inspectEnd) });
    updateRail($('#rail'), k);
    const n = this.tl.steps.length;
    $('#guide-count').textContent = k === 0 ? 'Before you start' : k > n ? 'Finished' : `Step ${k} of ${n}`;
    $<HTMLButtonElement>('#guide-prev').disabled = k === 0;
    $('#guide-next-label').textContent = k === total - 1 ? 'New scramble' : k === 0 ? 'Start solving' : `Next: ${slideLabel(this.tl, k + 1)}`;
    this.syncChips();
  }

  selectMethod(m: MethodId, opts: { newScramble: boolean }) {
    if (this.player.isOpen) this.player.close();
    this.method = m;
    if (opts.newScramble) this.entryIndex = this.randomEntry();
    this.loadTimeline();
    const want = m === 'beginner' ? '#/solve' : `#/solve/${m}`;
    if (this.page === 'solve' && location.hash !== want) history.replaceState(null, '', want);
  }

  private shuffle() {
    this.selectMethod(this.method, { newScramble: true });
  }

  private watch(stepIdx: number) {
    this.calloutKey = 'player';
    this.callouts.clear();
    document.body.classList.add('player-open');
    void this.player.open(this.tl, stepIdx);
  }

  private async replay() {
    if (this.player.isOpen) this.player.close();
    this.replaying = true;
    this.callouts.clear();
    this.calloutKey = 'replay';
    this.view.setFocus(null);
    this.director.go(this.tl.track, this.tl.inspectEnd, 'fast');
    await this.director.settle();
    if (!this.replaying) return;
    await new Promise((r) => setTimeout(r, 400));
    if (!this.replaying) return;
    this.director.go(this.tl.track, this.tl.track.length, 'auto');
    await this.director.settle();
    this.replaying = false;
    this.calloutKey = '';
    this.lastGo.track = null;
  }

  private onPlayerPart(step: TStep, part: TPart | null) {
    if (!part) {
      this.calloutKey = '';
      return;
    }
    const pieces = part.pieces;
    const eo = step.id === 'eoline' && part.label.startsWith('Orient');
    const ll = pieces.length > 4 && !eo;
    this.view.setFocus(ll ? [...pieces, 'U', ...CENTRES] : [...pieces, ...CENTRES], 0.66);
    const defs: CalloutDef[] = [];
    if (eo) {
      // Tag every bad edge; the tags ride along as F/B turns flip them good.
      this.callouts.maxItems = 12;
      pieces.forEach((p) => defs.push({ ...this.pieceCallout(`eo-${p}`, { piece: p, title: 'Bad edge' }, false), tag: true }));
    } else if (ll) defs.push(this.pieceCallout('pp-u', { piece: 'U', face: 'U', title: part.label }));
    else
      pieces.slice(0, 2).forEach((p, i) =>
        defs.push(this.pieceCallout(`pp-${p}`, { piece: p, title: i === 0 ? part.label : pieceTitle(p) }, i === 0)),
      );
    this.callouts.set(defs);
  }

  /** Light up the notation chip of the move being played on the current slide. */
  private syncChips(now?: number) {
    const slide = this.slideEl;
    if (!slide || !this.tl) return;
    const onTrack = this.director.track === this.tl.track;
    const start = Number(slide.dataset.start ?? -1);
    const end = Number(slide.dataset.end ?? -1);
    const cur = now ?? (this.director.frac > 0 ? this.director.index : -1);
    const playing = onTrack && cur >= start && cur < end;
    slide.classList.toggle('is-playing', playing);
    slide.querySelectorAll<HTMLElement>('.mv[data-i]').forEach((chip) => {
      const i = Number(chip.dataset.i);
      chip.classList.toggle('is-now', playing && i === cur);
      chip.classList.toggle('is-done', playing && i < cur);
    });
    slide.querySelectorAll<HTMLElement>('.part[data-start]').forEach((p) => {
      p.classList.toggle('is-now', playing && cur >= Number(p.dataset.start) && cur < Number(p.dataset.end));
    });
    if (playing) {
      const chip = slide.querySelector<HTMLElement>(`.mv[data-i="${cur}"]`);
      const list = chip?.closest<HTMLElement>('.parts');
      if (chip && list) list.scrollTop = Math.max(0, chip.offsetTop - list.offsetTop - list.clientHeight / 2);
    }
  }

  /* ------------------------------------------------------- callouts */

  private pieceCallout(id: string, spec: CalloutSpec, swatch = true): CalloutDef {
    return {
      id,
      title: spec.title,
      text: spec.text,
      swatch: swatch ? pieceColors(spec.piece) : undefined,
      anchor: (out) => this.view.anchor(spec.piece, spec.face, this.director.model, this.stage.camera, out),
    };
  }

  private positionCallout(id: string, pos: Vec3, face: string, title: string, text?: string): CalloutDef {
    return {
      id,
      title,
      text,
      tag: true,
      anchor: (out) => {
        const c = this.director.model.cubies.find((k) => vecEq(k.pos, pos));
        return c ? this.view.anchor(pieceName(c), face, this.director.model, this.stage.camera, out) : null;
      },
    };
  }

  /** Apply focus + callouts once per distinct scene key. */
  private setScene(key: string, focus: string[] | null, defs: CalloutDef[], level = 0.62) {
    if (key === this.calloutKey) return;
    this.calloutKey = key;
    this.view.setFocus(focus, level);
    this.callouts.set(defs);
  }

  /* --------------------------------------------------------- layout */

  private measure() {
    const page = document.querySelector<HTMLElement>(`.page[data-page="${this.page}"]`);
    const story = page?.querySelector<HTMLElement>('.story');
    const next = page?.querySelector<HTMLElement>('.next');
    const y = window.scrollY;
    if (story) {
      this.story = {
        top: story.getBoundingClientRect().top + y,
        height: story.offsetHeight,
        beats: Number(getComputedStyle(story).getPropertyValue('--beats')) || 1,
        nextTop: next ? next.getBoundingClientRect().top + y : Infinity,
      };
    }
  }

  /** Keep callout labels clear of the page's own UI. */
  private safeArea() {
    const narrow = this.stage.width < 900;
    let left = 0;
    let bottom = 60;
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    if (this.page === 'anatomy' || this.page === 'notation') {
      const idx = rect(`.page[data-page="${this.page}"] .story__index`);
      const cap = rect(`.page[data-page="${this.page}"] .story__captions`);
      if (idx && !narrow) left = idx.right + 16;
      if (cap) bottom = this.stage.height - cap.top + 12;
    } else if (this.page === 'solve') {
      if (this.mode === 'learn') {
        const g = rect('#guide');
        if (g && !narrow) left = g.right + 12;
        const r = rect(this.player.isOpen ? '#player' : '#rail');
        if (r) bottom = this.stage.height - r.top + 12;
      } else {
        const d = rect('#dock');
        if (d) bottom = this.stage.height - d.top + 12;
      }
    }
    this.callouts.safeLeft = left;
    this.callouts.safeBottom = Math.max(60, bottom);
  }

  /* ---------------------------------------------------------- per frame */

  private go(track: Move[], target: number, mode: Mode) {
    const g = this.lastGo;
    if (g.track === track && g.target === target && g.mode === mode && (this.director.track === track || this.director.morphT >= 0)) return;
    this.lastGo = { track, target, mode };
    this.director.go(track, target, mode);
  }

  private tick() {
    const y = window.scrollY;
    const vh = window.innerHeight;
    $('#nav').classList.toggle('is-solid', y > 40 || this.page !== 'home');
    const max = document.documentElement.scrollHeight - vh;
    $('#nav-progress').style.transform = `scaleX(${max > 0 ? y / max : this.page === 'solve' && this.mode === 'learn' ? this.slide / (slideCount(this.tl) - 1) : 0})`;

    const s = this.story;
    const p = clamp01((y - s.top) / Math.max(1, s.height - vh));
    const story = this.page === 'anatomy' || this.page === 'notation';

    if (!this.player.isOpen) this.rig.setPose(this.poseFor(y, vh, p));

    // Explode for the anatomy chapter.
    const e = this.page === 'anatomy' ? smooth(clamp01((p - 0.015) / 0.11)) * (1 - smooth(clamp01((p - 0.8) / 0.16))) : 0;
    this.view.explode += (e - this.view.explode) * 0.25;
    if (Math.abs(this.view.explode - e) < 0.001) this.view.explode = e;

    this.rig.idleTarget = this.page === 'home' ? 1 : story ? 0.6 : this.mode === 'play' ? 0.4 : 0.25;
    this.arrow.enabled = this.page === 'notation' || (this.page === 'solve' && this.mode === 'play') || this.player.isOpen;
    this.safeArea();
    if (!this.player.isOpen) this.callouts.maxItems = this.stage.width < 700 ? 2 : 6;
    if (story) $(`.page[data-page="${this.page}"] .story__scrub i`).style.transform = `scaleY(${p})`;

    if (this.player.isOpen || this.replaying) {
      // The player (or replay) owns the cube.
      if (this.page !== 'solve' || this.mode !== 'learn') {
        if (this.player.isOpen) this.player.close();
        this.replaying = false;
      }
      return;
    }

    switch (this.page) {
      case 'home':
        this.go(this.free, 0, 'fast');
        this.setScene('home', null, []);
        break;
      case 'anatomy':
        this.anatomy(p);
        break;
      case 'notation':
        this.notation(p);
        break;
      case 'solve':
        if (this.mode === 'learn') this.learn();
        else this.sandbox();
        break;
    }
  }

  private poseFor(y: number, vh: number, p: number): Pose {
    switch (this.page) {
      case 'home': {
        // Shrink in place, then ride up just above the course heading.
        const head = document.querySelector('.path__head')?.getBoundingClientRect();
        const t = smooth(clamp01(y / (vh * 0.7)));
        const p = lerpPose(POSES.hero, POSES.path, t);
        if (head) p.sy = Math.min(p.sy, (head.top - vh * 0.21) / vh - 0.5);
        return p;
      }
      case 'anatomy':
      case 'notation': {
        const base = this.page === 'anatomy' ? { ...POSES.anatomy, yaw: -52 + 34 * p } : POSES.notation;
        // As the next-chapter panel scrolls in, the cube lifts out of the way.
        const q = smooth(clamp01((y + vh - this.story.nextTop) / (vh * 0.8)));
        return lerpPose(base, { ...base, yaw: base.yaw + 40, pitch: 34, zoom: base.zoom * 0.62, sy: -0.3 }, q);
      }
      case 'solve': {
        if (this.mode === 'play') return POSES.play;
        const n = this.tl.steps.length;
        return this.slide === 0 ? POSES.head : this.slide > n ? POSES.finish : this.tl.steps[this.slide - 1].meta.pose;
      }
    }
  }

  private setBeat(beat: number) {
    if (beat === this.beat) return;
    this.beat = beat;
    const root = $(`.page[data-page="${this.page}"]`);
    root.querySelectorAll<HTMLElement>('.caption').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.beat) === beat));
    root.querySelectorAll<HTMLElement>('.story__index [data-beat]').forEach((b) => {
      const i = Number(b.dataset.beat);
      b.classList.toggle('is-on', i === beat);
      b.classList.toggle('is-done', i < beat);
    });
  }

  private anatomy(p: number) {
    this.go(this.free, 0, 'fast');
    const beat = Math.min(4, Math.floor(p * 5));
    this.setBeat(beat);
    const byKind = (kind: string) => this.view.pieces.filter((x) => x.kind === kind).map((x) => x.name);
    switch (beat) {
      case 0:
        this.setScene('an-0', null, [
          {
            id: 'core',
            title: 'Core',
            text: 'Six axles hold the centres on springs',
            anchor: (out) => {
              out.set(0, 1.05, 0).applyMatrix4(this.view.frame.matrixWorld);
              return this.view.explode > 0.4 ? 1 : null;
            },
          },
        ]);
        break;
      case 1:
        this.setScene('an-1', byKind('center'), [this.pieceCallout('an-c', { piece: 'F', face: 'F', title: 'Centre × 6', text: 'Fixed to the core, so it defines the face' })], 0.78);
        break;
      case 2:
        this.setScene('an-2', byKind('edge'), [this.pieceCallout('an-e', { piece: 'DF', face: 'F', title: 'Edge × 12', text: 'Two stickers, two orientations' })], 0.78);
        break;
      case 3:
        this.setScene('an-3', byKind('corner'), [this.pieceCallout('an-k', { piece: 'DFL', face: 'F', title: 'Corner × 8', text: 'Three stickers, three twists' })], 0.78);
        break;
      default:
        this.setScene('an-4', null, []);
    }
  }

  private notation(p: number) {
    const beat = Math.min(3, Math.floor(p * 4));
    this.setBeat(beat);
    if (beat === 0) {
      const faces: [string, Vec3, string][] = [
        ['U', [0, 1, 0], 'Up'],
        ['F', [0, 0, 1], 'Front'],
        ['R', [1, 0, 0], 'Right'],
        ['L', [-1, 0, 0], 'Left'],
        ['B', [0, 0, -1], 'Back'],
        ['D', [0, -1, 0], 'Down'],
      ];
      this.setScene(
        'no-0',
        null,
        faces.map(([f, pos, word]) => ({ ...this.positionCallout(`face-${f}`, pos, f, `${f} · ${word}`), side: f === 'L' || f === 'B' ? 'left' : 'auto' })),
      );
    } else if (beat <= 2) {
      this.setScene(`no-${beat}`, null, [this.positionCallout('face-R', [1, 0, 0], 'R', 'R · Right face')]);
    } else {
      this.setScene('no-3', null, []);
    }

    // Auto demo until the visitor starts turning the cube themselves.
    if (!this.userPlayed && beat >= 1 && beat <= 2) {
      const seq = beat === 1 ? ['R', "R'"] : ["R'", 'R', 'R2', 'R2'];
      if (this.demoBeat !== beat) {
        // New sequence: wind back to solved before starting it.
        this.demoBeat = beat;
        this.demoStep = 0;
        this.demoAt = this.time + 0.6;
        this.free.length = Math.min(this.free.length, this.director.track === this.free ? this.director.target : 0);
      }
      if (this.demoStep === 0 && this.free.length) {
        this.go(this.free, 0, 'fast');
        return;
      }
      if (this.director.idle && this.director.track === this.free) {
        const solved = this.director.model.isSolved();
        if (this.free.length && solved && this.demoStep % seq.length === 0) {
          this.free.length = 0;
          this.director.jump(this.free, 0);
        }
        if (this.time >= this.demoAt) {
          this.free.push(parseMove(seq[this.demoStep % seq.length]));
          this.demoStep++;
          this.demoAt = this.time + 1.25;
        }
      }
      this.go(this.free, this.free.length, 'demo');
    } else {
      // Outside the demo beats, leftover demo turns unwind; the visitor's own turns stay.
      this.demoBeat = -1;
      this.go(this.free, this.userPlayed ? this.free.length : 0, this.userPlayed ? 'auto' : 'fast');
    }
  }

  private learn() {
    const tl = this.tl;
    const n = tl.steps.length;
    const k = this.slide;
    if (k === 0) {
      this.go(tl.track, tl.inspectEnd, this.director.track !== tl.track || this.director.position < tl.scrambleLen ? 'scramble' : 'auto');
      this.setScene(this.director.idle ? 'scr-idle' : 'scr', null, []);
      return;
    }
    if (k <= n) {
      const step = tl.steps[k - 1];
      this.go(tl.track, step.end, 'auto');
      const there = this.director.idle && this.director.track === tl.track && this.director.position === step.end;
      const defs = there
        ? step.meta.callouts({ id: step.id, parts: [], case: step.case }, step.moves).map((s, i) => this.pieceCallout(`st-${k}-${i}`, s))
        : [];
      this.setScene(`card-${k}-${there ? 'idle' : 'run'}`, step.meta.focus, defs, 0.72);
      if (there && !this.flashed.has(k)) {
        this.flashed.add(k);
        this.view.flash(step.meta.focus, 0.5);
      }
      return;
    }
    this.go(tl.track, tl.track.length, 'auto');
    const there = this.director.idle && this.director.track === tl.track && this.director.position === tl.track.length;
    this.setScene(
      `fin-${there}`,
      null,
      there ? [this.pieceCallout('fin', { piece: 'U', face: 'U', title: `Solved · ${tl.total} moves`, text: `${METHODS[tl.method].name}, verified move by move` }, false)] : [],
    );
  }

  private sandbox() {
    this.go(this.play, this.playHead, this.director.track === this.play ? this.director.mode : 'fast');
    this.setScene('play', null, []);
    // A scrambled cube that comes back to solved deserves a moment.
    if (this.director.track === this.play && this.director.idle) {
      const solved = this.director.model.isSolved();
      if (solved && !this.wasSolved && this.playHead > 0) {
        this.view.flash(this.view.pieces.map((x) => x.name), 0.8);
        this.setPadHint('<b>Solved.</b> Every face, one colour.');
      }
      this.wasSolved = solved;
    }
  }

  /* ------------------------------------------------------------ loop */

  private frame(t: number) {
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.time += dt;
    this.lenis?.raf(t);
    this.tick();

    if (this.introStart >= 0 && this.view.intro < 1) {
      this.view.intro = Math.min(1, (this.time - this.introStart) / 3.0);
    }
    if (this.director.track === this.free && this.director.idle && this.free.length && this.director.target === 0) {
      // Rewound playground: forget it.
      this.free.length = 0;
    }
    if (this.director.track === this.play && this.director.idle && this.play.length && this.playHead === 0 && this.director.target === 0) {
      this.play.length = 0;
    }

    this.director.update(dt);
    this.rig.update(dt, this.time, this.director.morphT);
    this.view.update(dt);
    this.arrow.update(dt, this.time, this.director.current !== null);
    this.stage.scene.updateMatrixWorld();
    const cube = this.rig.screen();
    this.callouts.update(dt, cube);
    this.hud.place(cube.x, cube.y - cube.r * 0.98);
    if (!this.director.idle) this.lastBusy = this.time;
    // Outside the player the move readout is transient: gone once the cube rests.
    if (!this.player.isOpen && (!this.hudContext() || this.time - this.lastBusy > 1.6)) this.hud.hide();
    this.stage.render(dt, this.time);
    this.govern(dt);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private frameAvg = 1 / 60;
  private frameClock = 0;

  /** If a device can't hold ~50fps for a few seconds, render at a lower resolution. */
  private govern(dt: number) {
    if (document.hidden || dt <= 0) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    this.frameClock += dt;
    if (this.frameClock < 3) return;
    this.frameClock = 0;
    if (this.frameAvg > 1 / 48) this.stage.degrade();
  }

  private async runLoader() {
    const pct = $('#loader-pct');
    const start = performance.now();
    let ready = false;
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => (ready = true));
    setTimeout(() => (ready = true), 2500);
    let shown = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const el = (performance.now() - start) / 1000;
        const cap = ready ? 100 : Math.min(92, el * 110);
        shown = Math.min(cap, shown + Math.max(0.6, (cap - shown) * 0.09));
        pct.textContent = String(Math.floor(shown));
        if (shown >= 100) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    // Compile every skin's shaders now, so switching later never stalls.
    const skin = this.view.skin.id;
    for (const id of SKIN_ORDER) {
      this.view.setSkin(id);
      this.stage.warmup([this.view.core, this.arrow.group]);
    }
    this.view.setSkin(skin);
    $('#loader').classList.add('is-done');
    document.documentElement.classList.add('is-ready');
    this.introStart = this.time;
    this.measure();
  }
}
