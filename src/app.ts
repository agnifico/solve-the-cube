/**
 * Orchestration: scroll → camera poses, chapter beats, which card is active →
 * what the cube shows, plus callouts, the notation playground, tabs, shuffling
 * and the slow-motion player.
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
import { Callouts, type CalloutDef } from './ui/callouts.ts';
import { MoveHud, Player } from './ui/player.ts';
import { renderSolve } from './ui/solveView.ts';
import { pretty, pieceTitle } from './ui/format.ts';
import { SITE } from './config.ts';
import solvesData from './data/solves.json';

const POSES = {
  hero: pose(-34, 24, 0.84, 0.23, 0.02),
  anatomy: pose(-38, 24, 0.7, 0.2),
  notation: pose(-32, 20, 0.95, 0.2),
  methods: pose(-24, 16, 0.5, 0.27, -0.29),
  head: pose(-30, 22, 0.84, 0.19),
  finish: pose(-36, 28, 0.76, 0.2),
};

const CENTRES = ['U', 'D', 'F', 'B', 'L', 'R'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Section = 'hero' | 'anatomy' | 'notation' | 'methods' | 'solve';

interface Keyframe {
  y: number;
  pose: Pose;
}

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

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

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

  private pool: Entry[];
  private method: MethodId = SITE.defaultMethod;
  private entryIndex = 0;
  private tl!: Timeline;
  private cards: HTMLElement[] = [];
  private cardTops: number[] = [];
  private keyframes: Keyframe[] = [];
  private chapters = { anatomy: { top: 0, height: 1 }, notation: { top: 0, height: 1 } };

  private free: Move[] = [];
  private section: Section = 'hero';
  private activeCard = -1;
  private beat = -1;
  private calloutKey = '';
  private lastGo = { track: null as Move[] | null, target: -1, mode: '' as Mode | '' };
  private demoAt = 0;
  private demoStep = 0;
  private demoBeat = -1;
  private userPlayed = false;
  private replaying = false;
  private time = 0;
  private last = 0;
  private introStart = -1;
  private lastBusy = 0;
  /** Cards whose finished state has already had its glow pulse. */
  private flashed = new Set<number>();

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
      if (this.section === 'notation' && !this.player.isOpen && dir > 0) this.hud.show(m.token);
      this.syncChips(dir > 0 ? this.director.index : this.director.index - 1);
    });
    this.director.onIndex(() => this.syncChips());

    $('#author').textContent = SITE.author;
    this.buildTabs();
    this.buildMethodCards();
    this.updateTabs();
    this.buildMovepad();
    this.applyAccent();
    this.loadTimeline();
    this.initScroll();
    this.observeReveals();

    window.addEventListener('resize', () => {
      this.stage.resize();
      this.measure();
      this.positionPill();
    });
    new ResizeObserver(() => this.measure()).observe($('#main'));
    document.fonts?.ready.then(() => {
      this.measure();
      this.positionPill();
    });
    $('#nav-shuffle').addEventListener('click', () => this.shuffle());

    document.body.dataset.section = this.section;
    this.view.intro = reducedMotion ? 1 : 0;
    this.measure();
    this.onScroll();
    this.director.draw();
    requestAnimationFrame((t) => this.frame(t));
    void this.runLoader();
  }

  /* ------------------------------------------------------------ setup */

  private buildTabs() {
    const tabs = $('.tabs');
    for (const id of METHOD_ORDER) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.method = id;
      b.textContent = METHODS[id].name;
      b.addEventListener('click', () => this.selectMethod(id, { newScramble: true }));
      tabs.appendChild(b);
    }
    this.updateTabs();
  }

  private updateTabs() {
    document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.method === this.method)));
    document.querySelectorAll<HTMLElement>('.method-card').forEach((c) => c.classList.toggle('is-current', c.dataset.method === this.method));
    $('.tabs').classList.add('has-active');
    this.positionPill();
  }

  private positionPill() {
    const tab = document.querySelector<HTMLElement>(`.tab[data-method="${this.method}"]`);
    const pill = $('.tabs__pill');
    if (!tab) return;
    pill.style.width = `${tab.offsetWidth}px`;
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  private buildMethodCards() {
    const wrap = $('#method-cards');
    wrap.innerHTML = METHOD_ORDER.map((id, i) => {
      const m = METHODS[id];
      return `<a class="method-card reveal" href="#solve" data-method="${id}" style="--card-accent:${m.accent};--d:${i + 1}">
        <div class="method-card__top"><span class="method-card__index">0${i + 1}</span><span class="method-card__dot"></span></div>
        <h3>${m.name}</h3>
        <p class="method-card__full">${m.full}</p>
        <p>${m.tagline}</p>
        <div class="method-card__stats">${m.stats.map((s) => `<div><b>${s.value}</b><span>${s.label}</span></div>`).join('')}</div>
        <span class="method-card__go">Solve with ${m.name}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-4-4 4 4-4 4"/></svg></span>
      </a>`;
    }).join('');
    wrap.querySelectorAll<HTMLAnchorElement>('.method-card').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectMethod(a.dataset.method as MethodId, { newScramble: true });
      }),
    );
  }

  private buildMovepad() {
    const grid = $('.movepad__grid');
    const faces = ['R', 'L', 'U', 'D', 'F', 'B'];
    grid.innerHTML = [...faces, ...faces.map((f) => `${f}'`)]
      .map((t) => `<button type="button" data-move="${t}" aria-label="${t}">${pretty(t)}</button>`)
      .join('');
    grid.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move]');
      if (!b) return;
      this.playFree(b.dataset.move!);
    });
    $('#movepad-reset').addEventListener('click', () => {
      this.userPlayed = true;
      this.free.length = Math.min(this.free.length, this.director.target);
      this.go(this.free, 0, 'fast');
    });
    window.addEventListener('keydown', (e) => {
      if (this.section !== 'notation' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (!'UDLRFB'.includes(k) || k.length !== 1) return;
      const tok = e.shiftKey ? `${k}'` : k;
      this.playFree(tok);
      const btn = grid.querySelector<HTMLElement>(`[data-move="${tok}"]`);
      btn?.classList.add('is-hit');
      setTimeout(() => btn?.classList.remove('is-hit'), 160);
    });
  }

  private playFree(token: string) {
    this.userPlayed = true;
    // Truncate anything beyond where we're heading, then append.
    this.free.length = Math.min(this.free.length, this.director.track === this.free ? this.director.target : 0);
    this.free.push(parseMove(token));
    this.go(this.free, this.free.length, 'auto');
  }

  private applyAccent() {
    const hex = METHODS[this.method].accent;
    const root = document.documentElement.style;
    root.setProperty('--accent-rgb', hexToRgb(hex));
    this.stage.setAccent(hex);
  }

  private initScroll() {
    if (!reducedMotion) {
      this.lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
    }
    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
      if (a.classList.contains('method-card')) return;
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href')!;
        const el = id === '#top' ? document.body : document.querySelector(id);
        if (!el) return;
        e.preventDefault();
        this.scrollTo(id === '#top' ? 0 : (el as HTMLElement).getBoundingClientRect().top + window.scrollY);
      });
    });
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

  /* --------------------------------------------------------- solves */

  private randomEntry(): number {
    if (this.pool.length < 2) return 0;
    let i = this.entryIndex;
    while (i === this.entryIndex) i = Math.floor(Math.random() * this.pool.length);
    return i;
  }

  private loadTimeline() {
    this.tl = buildTimeline(this.method, this.pool[this.entryIndex]);
    this.cards = renderSolve(this.tl, $('#solve-head'), $('#steps'), {
      onWatch: (i) => this.watch(i),
      onShuffle: () => this.shuffle(),
      onMethod: (m) => this.selectMethod(m, { newScramble: false }),
      onReplay: () => void this.replay(),
    });
    this.activeCard = -2;
    this.calloutKey = '';
    this.flashed.clear();
    this.measure();
  }

  selectMethod(m: MethodId, opts: { newScramble: boolean }) {
    if (this.player.isOpen) this.player.close();
    this.replaying = false;
    this.method = m;
    if (opts.newScramble) this.entryIndex = this.randomEntry();
    this.applyAccent();
    this.updateTabs();
    this.loadTimeline();
    // Send the cube home first so the new scramble plays from solved.
    if (this.director.track !== this.tl.track) this.go(this.free, 0, 'fast');
    requestAnimationFrame(() => this.scrollTo(this.cardTops[0] - window.innerHeight * 0.16, 1.5));
  }

  private shuffle() {
    this.selectMethod(this.method, { newScramble: true });
  }

  private async watch(stepIdx: number) {
    const card = stepIdx + 1;
    if (this.activeCard !== card) {
      this.scrollTo(this.cardTops[card] - window.innerHeight * 0.16, 1.1);
      await new Promise((r) => setTimeout(r, 1200));
    }
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

  /** Light up the notation chip of the move being played on the active card. */
  private syncChips(now?: number) {
    if (!this.tl) return;
    const card = this.cards[this.activeCard];
    const onTrack = this.director.track === this.tl.track;
    for (const el of this.cards) {
      if (el !== card) {
        if (el.classList.contains('is-playing')) {
          el.classList.remove('is-playing');
          el.querySelectorAll('.is-now, .is-done').forEach((x) => x.classList.remove('is-now', 'is-done'));
        }
      }
    }
    if (!card || !onTrack) return;
    const start = Number(card.dataset.start);
    const end = Number(card.dataset.end);
    const cur = now ?? (this.director.frac > 0 ? this.director.index : -1);
    const playing = cur >= start && cur < end;
    card.classList.toggle('is-playing', playing);
    card.querySelectorAll<HTMLElement>('.mv[data-i]').forEach((chip) => {
      const i = Number(chip.dataset.i);
      chip.classList.toggle('is-now', playing && i === cur);
      chip.classList.toggle('is-done', playing && i < cur);
    });
    card.querySelectorAll<HTMLElement>('.part[data-start]').forEach((p) => {
      p.classList.toggle('is-now', playing && cur >= Number(p.dataset.start) && cur < Number(p.dataset.end));
    });
    if (playing) {
      const chip = card.querySelector<HTMLElement>(`.mv[data-i="${cur}"]`);
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

  /* --------------------------------------------------------- layout */

  private measure() {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const top = (el: Element) => el.getBoundingClientRect().top + y;
    const an = $('#anatomy');
    const no = $('#notation');
    this.chapters.anatomy = { top: top(an), height: an.offsetHeight };
    this.chapters.notation = { top: top(no), height: no.offsetHeight };
    this.cardTops = this.cards.map((c) => top(c));

    const kf: Keyframe[] = [];
    const hero = $('#top');
    kf.push({ y: top(hero) + vh * 0.5, pose: POSES.hero });
    for (const [el, p] of [
      [an, POSES.anatomy],
      [no, POSES.notation],
    ] as const) {
      const t = top(el);
      kf.push({ y: t + vh * 0.5, pose: p }, { y: t + el.offsetHeight - vh * 0.5, pose: p });
    }
    const me = $('#methods');
    kf.push({ y: top(me) + me.offsetHeight * 0.5, pose: POSES.methods });
    const head = $('#solve-head');
    kf.push({ y: top(head) + head.offsetHeight * 0.5, pose: POSES.head });
    this.cards.forEach((c, i) => {
      const mid = this.cardTops[i] + Math.min(c.offsetHeight, vh) * 0.5;
      const p = i === 0 ? POSES.head : i <= this.tl.steps.length ? this.tl.steps[i - 1].meta.pose : POSES.finish;
      kf.push({ y: mid, pose: p });
    });
    this.keyframes = kf.sort((a, b) => a.y - b.y);
  }

  private poseAt(c: number): Pose {
    const k = this.keyframes;
    if (!k.length) return POSES.hero;
    if (c <= k[0].y) return k[0].pose;
    for (let i = 0; i < k.length - 1; i++) {
      if (c <= k[i + 1].y) {
        const span = k[i + 1].y - k[i].y || 1;
        return lerpPose(k[i].pose, k[i + 1].pose, smooth(clamp01((c - k[i].y) / span)));
      }
    }
    return k[k.length - 1].pose;
  }

  /* ---------------------------------------------------------- scroll */

  private go(track: Move[], target: number, mode: Mode) {
    const g = this.lastGo;
    if (g.track === track && g.target === target && g.mode === mode && (this.director.track === track || this.director.morphT >= 0)) return;
    this.lastGo = { track, target, mode };
    this.director.go(track, target, mode);
  }

  private onScroll() {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const c = y + vh * 0.5;
    const nav = $('#nav');
    nav.classList.toggle('is-solid', y > 40);
    const max = document.documentElement.scrollHeight - vh;
    $('#nav-progress').style.transform = `scaleX(${max > 0 ? y / max : 0})`;

    if (!this.player.isOpen) this.rig.setPose(this.poseAt(c));

    const an = this.chapters.anatomy;
    const no = this.chapters.notation;
    let section: Section;
    if (c < an.top) section = 'hero';
    else if (c < an.top + an.height) section = 'anatomy';
    else if (c < no.top + no.height) section = 'notation';
    else if (this.cards.length && c >= this.cardTops[0] - vh * 0.3) section = 'solve';
    else section = 'methods';
    if (section !== this.section) {
      this.section = section;
      document.body.dataset.section = section;
      this.beat = -1;
      this.hud.hide();
      if (section !== 'notation') this.arrow.enabled = this.player.isOpen;
    }

    // Explode progress for the anatomy chapter.
    const ap = clamp01((y - an.top) / Math.max(1, an.height - vh));
    const e = section === 'anatomy' ? smooth(clamp01((ap - 0.015) / 0.11)) * (1 - smooth(clamp01((ap - 0.8) / 0.16))) : 0;
    this.view.explode += (e - this.view.explode) * 0.25;
    if (Math.abs(this.view.explode - e) < 0.001) this.view.explode = e;

    this.rig.idleTarget = section === 'hero' || section === 'methods' ? 1 : section === 'anatomy' || section === 'notation' ? 0.6 : 0.25;
    this.callouts.safeLeft = this.textColumnRight(section);
    if (!this.player.isOpen) this.callouts.maxItems = this.stage.width < 700 ? 2 : 6;

    if (this.replaying && (section !== 'solve' || this.cardAt(c) !== this.cards.length - 1)) {
      // Scrolled away from the finish card: hand the cube back to the scroll.
      this.replaying = false;
      this.calloutKey = '';
      this.lastGo.track = null;
    }
    if (this.player.isOpen || this.replaying) {
      // The player (or replay) owns the cube; leaving its card closes the player.
      if (this.player.isOpen && section === 'solve') {
        const card = this.cardAt(c);
        if (card !== this.player.step!.number) this.player.close();
      } else if (this.player.isOpen) this.player.close();
      return;
    }

    switch (section) {
      case 'hero':
        this.go(this.free, this.free.length, 'auto');
        this.setScene('hero', null, []);
        break;
      case 'anatomy':
        this.anatomy(ap);
        break;
      case 'notation':
        this.notation(clamp01((y - no.top) / Math.max(1, no.height - vh)));
        break;
      case 'methods':
        this.go(this.free, 0, 'fast');
        this.setScene('methods', null, []);
        break;
      case 'solve':
        this.solve(c);
        break;
    }
  }

  private textColumnRight(section: Section): number {
    if (this.stage.width < 900) return 0;
    const pick = section === 'solve' ? '.step.is-active .step__card' : section === 'hero' ? '.hero__copy' : section === 'methods' ? '.methods__head' : `#${section} .chapter__copy`;
    const el = document.querySelector(pick) ?? (section === 'solve' ? document.querySelector('.solve__head') : null);
    return el ? el.getBoundingClientRect().right + 12 : 0;
  }

  private cardAt(c: number): number {
    let best = -1;
    for (let i = 0; i < this.cards.length; i++) {
      if (this.cardTops[i] - window.innerHeight * 0.3 <= c) best = i;
    }
    return best;
  }

  /** Apply focus + callouts once per distinct scene key. */
  private setScene(key: string, focus: string[] | null, defs: CalloutDef[], level = 0.62) {
    if (key === this.calloutKey) return;
    this.calloutKey = key;
    this.view.setFocus(focus, level);
    this.callouts.set(defs);
  }

  private anatomy(p: number) {
    this.go(this.free, this.free.length, 'auto');
    const beat = Math.min(4, Math.floor(p * 5));
    this.setBeat('#anatomy', beat);
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

  private setBeat(sel: string, beat: number) {
    if (beat === this.beat) return;
    this.beat = beat;
    const root = $(sel);
    root.querySelectorAll('.beat').forEach((b) => b.classList.toggle('is-on', Number((b as HTMLElement).dataset.beat) === beat));
    root.querySelectorAll('.beat-dots i').forEach((d, i) => d.classList.toggle('is-on', i === beat));
    if (sel === '#notation') $('#movepad').classList.toggle('is-on', beat >= 3);
  }

  private notation(p: number) {
    const beat = Math.min(3, Math.floor(p * 4));
    this.setBeat('#notation', beat);
    this.arrow.enabled = true;
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

  private solve(c: number) {
    const card = this.cardAt(c);
    const tl = this.tl;
    const n = tl.steps.length;
    if (card !== this.activeCard) {
      this.activeCard = card;
      this.cards.forEach((el, i) => el.classList.toggle('is-active', i === card));
    }
    if (card < 0) {
      this.go(this.free, 0, 'fast');
      this.setScene('head', null, []);
      return;
    }
    if (card === 0) {
      this.go(tl.track, tl.inspectEnd, this.director.position < tl.scrambleLen ? 'scramble' : 'auto');
      this.setScene(this.director.idle ? 'scr-idle' : 'scr', null, []);
      return;
    }
    if (card <= n) {
      const step = tl.steps[card - 1];
      this.go(tl.track, step.end, 'auto');
      const there = this.director.idle && this.director.track === tl.track && this.director.position === step.end;
      const defs = there
        ? step.meta.callouts({ id: step.id, parts: [], case: step.case }, step.moves).map((s, i) => this.pieceCallout(`st-${card}-${i}`, s))
        : [];
      this.setScene(`card-${card}-${there ? 'idle' : 'run'}`, step.meta.focus, defs, 0.72);
      if (there && this.calloutKey.endsWith('idle') && !this.flashed.has(card)) {
        this.flashed.add(card);
        this.view.flash(step.meta.focus, 0.5);
      }
      return;
    }
    // Finish card.
    this.go(tl.track, tl.track.length, 'auto');
    const there = this.director.idle && this.director.track === tl.track && this.director.position === tl.track.length;
    this.setScene(
      `fin-${there}`,
      null,
      there ? [this.pieceCallout('fin', { piece: 'U', face: 'U', title: `Solved · ${tl.total} moves`, text: `${METHODS[tl.method].name}, verified move by move` }, false)] : [],
    );
  }

  /* ------------------------------------------------------------ loop */

  private frame(t: number) {
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.time += dt;
    this.lenis?.raf(t);
    this.onScroll();

    if (this.introStart >= 0 && this.view.intro < 1) {
      this.view.intro = Math.min(1, (this.time - this.introStart) / 3.0);
    }
    if (this.director.track === this.free && this.director.idle && this.free.length && this.director.target === 0) {
      // Rewound playground: forget it.
      this.free.length = 0;
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
    if (!this.player.isOpen && (this.section !== 'notation' || this.time - this.lastBusy > 1.6)) this.hud.hide();
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
    this.stage.warmup([this.view.core, this.arrow.group]);
    $('#loader').classList.add('is-done');
    document.documentElement.classList.add('is-ready');
    this.introStart = this.time;
    this.measure();
  }
}

