/**
 * A curved arrow that wraps the turning layer on the side facing the camera,
 * showing which way a move goes.
 */
import * as THREE from 'three';
import type { Move } from '../cube/cube.ts';
import type { CubeView } from './cubeView.ts';

const R = 2.2;

function arcGeometry(span: number) {
  const pts: THREE.Vector3[] = [];
  const n = 48;
  const end = span / 2 - 0.2;
  for (let i = 0; i <= n; i++) {
    const a = -span / 2 + ((end + span / 2) * i) / n;
    pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.042, 12, false);
  const head = new THREE.ConeGeometry(0.13, 0.34, 24);
  // Cone points +y; place it at the arc end, pointing along the tangent.
  const a = span / 2 - 0.2;
  const tip = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
  const tangent = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
  head.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent));
  head.translate(tip.x + tangent.x * 0.1, tip.y + tangent.y * 0.1, 0);
  return { tube, head };
}

// Plane basis per axis (u, v, axis) — right-handed, so +angle turns u toward v.
const BASIS: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
];

export class TurnArrow {
  readonly group = new THREE.Group();
  readonly mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.9, 1.9), transparent: true, opacity: 0, depthWrite: false });
  private quarter: THREE.Group;
  private half: THREE.Group;
  private opacity = 0;
  private target = 0;
  private holdUntil = 0;
  private view: CubeView;
  enabled = false;

  constructor(view: CubeView) {
    this.view = view;
    const make = (span: number) => {
      const g = new THREE.Group();
      const { tube, head } = arcGeometry(span);
      g.add(new THREE.Mesh(tube, this.mat), new THREE.Mesh(head, this.mat));
      return g;
    };
    this.quarter = make(THREE.MathUtils.degToRad(105));
    this.half = make(THREE.MathUtils.degToRad(165));
    this.group.add(this.quarter, this.half);
    this.group.renderOrder = 10;
    view.frame.add(this.group);
  }

  show(move: Move, dir: 1 | -1, camera: THREE.Camera, now: number) {
    if (!this.enabled) return;
    const [u, v, axis] = BASIS[move.axis];
    // Camera direction in the cube's logical frame.
    const inv = this.view.frame.getWorldQuaternion(new THREE.Quaternion()).invert();
    const d = camera.position.clone().normalize().applyQuaternion(inv);
    let phi = Math.atan2(d.dot(v), d.dot(u));
    if (!Number.isFinite(phi)) phi = 0;
    const isHalf = Math.abs(move.q) === 2;
    this.quarter.visible = !isHalf;
    this.half.visible = isHalf;
    const layer = move.layers.length === 3 ? 0 : move.layers.reduce((a, b) => a + b, 0) / move.layers.length;
    const sign = Math.sign(move.q) * dir;

    const basis = new THREE.Matrix4().makeBasis(u, v, axis);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi));
    if (sign < 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    this.group.quaternion.copy(q);
    this.group.position.copy(axis).multiplyScalar(layer);
    const s = move.layers.length === 3 ? 1.12 : 1;
    this.group.scale.setScalar(s);
    this.target = 1;
    this.holdUntil = now + 0.1;
  }

  hide() {
    this.target = 0;
  }

  update(dt: number, now: number, turning: boolean) {
    if (!turning && now > this.holdUntil) this.target = 0;
    if (!this.enabled) this.target = 0;
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt * (this.target ? 14 : 6)));
    this.mat.opacity = this.opacity * 0.92;
    this.group.visible = this.opacity > 0.01;
  }
}
