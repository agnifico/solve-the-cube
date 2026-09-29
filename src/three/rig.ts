/**
 * Turntable presentation: blends scroll-driven poses, the slow-motion "view"
 * (a y-rotation, as a person would turn the cube), drag-to-spin with inertia,
 * idle drift and the morph spin. Lights stay fixed, like a studio.
 */
import * as THREE from 'three';
import type { Pose } from '../content/methods.ts';
import type { Stage } from './stage.ts';
import type { CubeView } from './cubeView.ts';
import { easeInOut } from './director.ts';

const D2R = Math.PI / 180;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Rig {
  private stage: Stage;
  private view: CubeView;
  private cur: Pose = { yaw: -32, pitch: 22, zoom: 0.9, sx: 0.2, sy: 0 };
  private tgt: Pose = { ...this.cur };
  private turn = 0;
  private turnTarget = 0;
  private dragYaw = 0;
  private dragPitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private dragging = false;
  private idle = 1;
  idleTarget = 1;
  /** Extra zoom for effects (1 = none). */
  punch = 1;
  private euler = new THREE.Euler(0, 0, 0, 'XYZ');

  constructor(stage: Stage, view: CubeView, canvas: HTMLCanvasElement) {
    this.stage = stage;
    this.view = view;
    this.bindDrag(canvas);
  }

  get narrow() {
    return this.stage.width < 900;
  }

  /** Adapt a desktop pose to the current viewport. */
  adapt(p: Pose): Pose {
    if (!this.narrow) return p;
    const portrait = this.stage.height > this.stage.width;
    return { ...p, sx: 0, sy: portrait ? -0.2 : -0.08, zoom: p.zoom * (portrait ? 0.8 : 0.72) };
  }

  setPose(p: Pose, immediate = false) {
    this.tgt = this.adapt(p);
    if (immediate) this.cur = { ...this.tgt };
  }

  /** y-rotation count (0..3) of the slow-motion view. */
  setView(k: number) {
    // Take the shortest way round from wherever we are.
    const want = -k * (Math.PI / 2);
    let d = want - this.turnTarget;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.turnTarget += d;
  }

  resetView() {
    this.setView(0);
  }

  /** Current screen-space centre and radius of the cube, in CSS pixels. */
  screen() {
    const c = this.stage.toScreen(new THREE.Vector3(0, 0, 0));
    return { x: c.x, y: c.y, r: this.stage.screenRadius(2.35 * this.view.root.scale.x) };
  }

  private bindDrag(canvas: HTMLCanvasElement) {
    let lx = 0;
    let ly = 0;
    let lt = 0;
    let touch = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      touch = e.pointerType === 'touch';
      this.dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      lt = performance.now();
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dt = Math.max(1, now - lt) / 1000;
      const dx = e.clientX - lx;
      const dy = touch ? 0 : e.clientY - ly;
      this.dragYaw += dx * 0.0085;
      this.dragPitch = THREE.MathUtils.clamp(this.dragPitch + dy * 0.006, -1.1, 1.1);
      this.vYaw = (dx * 0.0085) / dt;
      this.vPitch = (dy * 0.006) / dt;
      lx = e.clientX;
      ly = e.clientY;
      lt = now;
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.classList.remove('is-dragging');
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  update(dt: number, time: number, morphT: number) {
    const k = 1 - Math.exp(-dt * 3.6);
    const c = this.cur;
    const t = this.tgt;
    c.yaw += (t.yaw - c.yaw) * k;
    c.pitch += (t.pitch - c.pitch) * k;
    c.zoom += (t.zoom - c.zoom) * k;
    c.sx += (t.sx - c.sx) * k;
    c.sy += (t.sy - c.sy) * k;
    this.turn += (this.turnTarget - this.turn) * (1 - Math.exp(-dt * 4.2));

    if (!this.dragging) {
      this.dragYaw += this.vYaw * dt;
      this.dragPitch += this.vPitch * dt;
      this.vYaw *= Math.exp(-dt * 3.2);
      this.vPitch *= Math.exp(-dt * 5);
      // Spring back to the choreographed pose, keeping any full turns the user spun.
      const rest = Math.round(this.dragYaw / (Math.PI * 2)) * Math.PI * 2;
      this.dragYaw += (rest - this.dragYaw) * (1 - Math.exp(-dt * 1.4));
      this.dragPitch *= Math.exp(-dt * 2.2);
    }

    this.idle += (this.idleTarget * (reducedMotion ? 0 : 1) - this.idle) * (1 - Math.exp(-dt * 1.5));
    const idleYaw = Math.sin(time * 0.21) * 7 * D2R * this.idle;
    const idlePitch = Math.sin(time * 0.29 + 1.3) * 3 * D2R * this.idle;

    let spin = 0;
    let scale = 1;
    if (morphT >= 0) {
      spin = easeInOut(morphT) * Math.PI * 2;
      scale = 1 - 0.2 * Math.sin(Math.PI * morphT);
    }

    this.euler.set(c.pitch * D2R + this.dragPitch + idlePitch, c.yaw * D2R + this.turn + this.dragYaw + idleYaw + spin, 0);
    this.view.root.quaternion.setFromEuler(this.euler);
    this.view.root.scale.setScalar(scale);
    this.stage.setZoom(c.zoom * this.punch);
    this.stage.shift.set(c.sx, c.sy);
    this.stage.applyShift();
  }
}
