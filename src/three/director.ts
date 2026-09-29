/**
 * The playhead. A track is a list of moves starting from the solved cube; the
 * director moves a continuous position toward a target (forwards or
 * backwards, reversing smoothly mid-turn) and draws the cube at that point.
 * Every track starts solved, so switching tracks rewinds through the solved
 * state, or "morphs" (a masked instant reset) when the rewind would be long.
 */
import { Cube, invertMove, type Move } from '../cube/cube.ts';
import type { CubeView } from './cubeView.ts';

export type Mode = 'auto' | 'slow' | 'scramble' | 'fast' | 'demo';

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const MORPH_TIME = 0.95;

export class Director {
  readonly model = new Cube();
  track: Move[] = [];
  index = 0;
  frac = 0;
  target = 0;
  mode: Mode = 'auto';
  /** Slow-motion speed multiplier. */
  rate = 1;
  paused = false;
  /** 0..1 while a morph is running, else -1. */
  morphT = -1;
  private view: CubeView;
  private pending: { track: Move[]; target: number; mode: Mode } | null = null;
  private lastV = 0;
  private listeners: ((index: number) => void)[] = [];
  private startListeners: ((move: Move, dir: 1 | -1) => void)[] = [];

  constructor(view: CubeView) {
    this.view = view;
  }

  get position() {
    return this.index + this.frac;
  }

  get idle() {
    return this.morphT < 0 && !this.pending && this.position === this.target;
  }

  /** Called whenever a move is committed or undone. */
  onIndex(fn: (index: number) => void) {
    this.listeners.push(fn);
  }

  /** Called when a turn begins (dir -1 when played backwards). */
  onMoveStart(fn: (move: Move, dir: 1 | -1) => void) {
    this.startListeners.push(fn);
  }

  /** Show `track` at `target`, getting there from wherever the cube currently is. */
  go(track: Move[], target: number, mode: Mode = 'auto') {
    target = clamp(Math.round(target), 0, track.length);
    if (track === this.track && !this.pending) {
      this.target = target;
      this.mode = mode;
      return;
    }
    this.pending = { track, target, mode };
    if (this.morphT >= 0) return;
    if (this.position === 0) this.swap();
    else if (this.position > 30) this.morphT = 0;
    else {
      this.target = 0;
      this.mode = 'fast';
    }
  }

  /** Resolve when the playhead reaches its target (or is redirected). */
  settle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => (this.idle ? resolve() : requestAnimationFrame(check));
      check();
    });
  }

  private swap() {
    const p = this.pending!;
    this.pending = null;
    this.track = p.track;
    this.index = 0;
    this.frac = 0;
    this.target = p.target;
    this.mode = p.mode;
  }

  private resetModel() {
    this.model.cubies = new Cube().cubies;
    this.index = 0;
    this.frac = 0;
  }

  private velocity(dist: number): number {
    switch (this.mode) {
      case 'slow':
        return 0.95 * this.rate;
      case 'scramble':
        return 10.5;
      case 'demo':
        return 1.7;
      case 'fast':
        return Math.max(15, dist * 2.4);
      default:
        return Math.min(32, 3.4 + dist * 0.6);
    }
  }

  private ease(f: number): number {
    if (this.mode === 'slow' || this.mode === 'demo') return easeInOut(clamp(f / 0.72, 0, 1));
    const w = clamp((this.lastV - 7) / 14, 0, 1);
    return easeInOut(f) * (1 - w) + f * w;
  }

  update(dt: number) {
    if (this.morphT >= 0) {
      const before = this.morphT;
      this.morphT = Math.min(1, this.morphT + dt / MORPH_TIME);
      if (before < 0.5 && this.morphT >= 0.5) {
        this.resetModel();
        this.track = this.pending ? this.pending.track : this.track;
        this.target = 0;
        this.listeners.forEach((f) => f(0));
      }
      if (this.morphT >= 1) {
        this.morphT = -1;
        if (this.pending) this.swap();
      }
      this.draw();
      return;
    }
    if (this.pending && this.position === 0) this.swap();

    const pos = this.position;
    const dist = this.target - pos;
    if (dist === 0 || this.paused) {
      this.draw();
      return;
    }
    const v = this.velocity(Math.abs(dist));
    this.lastV = v;
    const stepLen = v * dt;
    const np = Math.abs(dist) <= stepLen ? this.target : pos + Math.sign(dist) * stepLen;

    if (this.frac === 0) {
      if (np > pos && this.index < this.track.length) this.startListeners.forEach((f) => f(this.track[this.index], 1));
      if (np < pos && this.index > 0) this.startListeners.forEach((f) => f(this.track[this.index - 1], -1));
    }
    while (np >= this.index + 1) {
      this.model.move(this.track[this.index]);
      this.index++;
      this.listeners.forEach((f) => f(this.index));
      if (np > this.index && this.index < this.track.length) this.startListeners.forEach((f) => f(this.track[this.index], 1));
    }
    while (np < this.index) {
      this.index--;
      this.model.move(invertMove(this.track[this.index]));
      this.listeners.forEach((f) => f(this.index));
      if (np < this.index && this.index > 0) this.startListeners.forEach((f) => f(this.track[this.index - 1], -1));
    }
    this.frac = np - this.index;
    if (this.frac < 1e-9) this.frac = 0;
    this.draw();
  }

  /** The move currently in flight (if any). */
  get current(): Move | null {
    return this.frac > 0 ? this.track[this.index] : null;
  }

  draw() {
    const m = this.current;
    this.view.pose(this.model, m, m ? this.ease(this.frac) : 0);
  }

  /** Instantly show a track position (no animation). */
  jump(track: Move[], index: number) {
    this.pending = null;
    this.morphT = -1;
    this.track = track;
    this.model.cubies = new Cube().cubies;
    for (let i = 0; i < index; i++) this.model.move(track[i]);
    this.index = index;
    this.frac = 0;
    this.target = index;
    this.listeners.forEach((f) => f(index));
    this.draw();
  }
}
