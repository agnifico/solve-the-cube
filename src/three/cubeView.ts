/**
 * The 3D cube: 26 rounded, stickerless cubies, moulded in colour (per-face
 * vertex colours on each body, dark plastic where no colour shows). Renders
 * the logical model with an optional partially-completed layer turn, plus the
 * exploded "anatomy" view, focus dimming and an assembly intro.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Cube, cubieStickers, pieceName, mulVec, type Color, type Move, type Vec3 } from '../cube/cube.ts';
import { DEFAULT_SKIN, SKINS, type Skin, type SkinId } from './skins.ts';

export const PITCH = 1.0;
const BODY = 0.97;

const FACE_VEC: Record<string, Vec3> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

type Kind = 'corner' | 'edge' | 'center';

/** A coloured face of a piece: an invisible anchor at its centre, for callouts. */
interface Face {
  anchor: THREE.Object3D;
  color: Color;
  homeNormal: Vec3;
}

export interface PieceView {
  id: number;
  name: string;
  kind: Kind;
  group: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  faces: Face[];
  dim: number;
  dimTarget: number;
  glow: number;
  scatter: THREE.Vector3;
  scatterQ: THREE.Quaternion;
  delay: number;
}

const WHITE = new THREE.Color(1, 1, 1);
/** Multiplier applied to the vertex colours when a piece is dimmed. */
const DIM_MUL = new THREE.Color('#2a2b31');
const AXIS_KEY = ['x', 'y', 'z'];
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class CubeView {
  /** Presentation transform (turntable), driven by the Rig. */
  readonly root = new THREE.Group();
  /** Logical frame: +x = R, +y = U, +z = F. */
  readonly frame = new THREE.Group();
  readonly pieces: PieceView[] = [];
  readonly byName = new Map<string, PieceView>();
  readonly core: THREE.Group;
  explode = 0;
  /** 0 → scattered, 1 → assembled. */
  intro = 1;
  skin: Skin = SKINS[DEFAULT_SKIN];
  private coreMat: THREE.MeshPhysicalMaterial;
  /** Re-apply dimming to every piece on the next update (after a re-skin). */
  private repaint = false;

  constructor() {
    this.root.add(this.frame);
    const bodyGeo = new RoundedBoxGeometry(BODY, BODY, BODY, 6, 0.12);

    const model = new Cube();
    for (const c of model.cubies) {
      const nz = c.home.filter((v) => v !== 0).length;
      const kind: Kind = nz === 3 ? 'corner' : nz === 2 ? 'edge' : 'center';
      const group = new THREE.Group();
      // Each piece gets its own body geometry so its faces can be coloured.
      const geo = bodyGeo.clone();
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0 });
      // Tint emission (the focus pulse) by the vertex colour, so pieces glow in their own colours.
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif',
        );
      };
      const body = new THREE.Mesh(geo, mat);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      const faces: Face[] = [];
      for (const s of cubieStickers(c)) {
        const anchor = new THREE.Object3D();
        anchor.position.set(...s.homeNormal).multiplyScalar(BODY / 2);
        group.add(anchor);
        faces.push({ anchor, color: s.color, homeNormal: s.homeNormal });
      }
      this.frame.add(group);
      const dir = new THREE.Vector3(...c.home).normalize();
      const piece: PieceView = {
        id: c.id,
        name: pieceName(c),
        kind,
        group,
        body,
        mat,
        faces,
        dim: 0,
        dimTarget: 0,
        glow: 0,
        scatter: dir
          .clone()
          .multiplyScalar(5 + Math.random() * 4)
          .add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)),
        scatterQ: new THREE.Quaternion().setFromEuler(
          new THREE.Euler((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5),
        ),
        delay: (3 - nz) * 0.08 + Math.random() * 0.22,
      };
      this.pieces.push(piece);
      this.byName.set(piece.name, piece);
    }

    // The mechanism core, only visible when exploded.
    this.core = new THREE.Group();
    const coreMat = new THREE.MeshPhysicalMaterial({ color: '#1b1d22', roughness: 0.3, metalness: 0.6, clearcoat: 0.4 });
    this.coreMat = coreMat;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.46, 48, 32), coreMat);
    this.core.add(sphere);
    for (let a = 0; a < 3; a++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.05, 24), coreMat);
      if (a === 0) arm.rotation.z = Math.PI / 2;
      if (a === 2) arm.rotation.x = Math.PI / 2;
      this.core.add(arm);
      for (const sgn of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 32), coreMat);
        const v = new THREE.Vector3();
        v.setComponent(a, sgn * 1.02);
        cap.position.copy(v);
        if (a === 0) cap.rotation.z = Math.PI / 2;
        if (a === 2) cap.rotation.x = Math.PI / 2;
        this.core.add(cap);
      }
    }
    this.core.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.core.visible = false;
    this.frame.add(this.core);
    this.setSkin(this.skin.id);
  }

  /** Re-skin every piece: palette, plastic and core. */
  setSkin(id: SkinId) {
    const skin = SKINS[id];
    this.skin = skin;
    const pl = skin.plastic;
    const inner = new THREE.Color(skin.inner);
    const palette = Object.fromEntries(Object.entries(skin.palette).map(([k, v]) => [k, new THREE.Color(v)])) as Record<Color, THREE.Color>;
    for (const p of this.pieces) {
      const byFace = new Map(
        p.faces.map((f) => {
          const a = f.homeNormal.findIndex((v) => v !== 0);
          return [AXIS_KEY[a] + (f.homeNormal[a] > 0 ? '+' : '-'), f.color] as const;
        }),
      );
      // Colour each body vertex by the face its normal points at most.
      const geo = p.body.geometry;
      const nrm = geo.attributes.normal;
      const out = geo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < nrm.count; i++) {
        const v = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
        const a = [0, 1, 2].reduce((m, k) => (Math.abs(v[k]) > Math.abs(v[m]) ? k : m), 0);
        const c = byFace.get(AXIS_KEY[a] + (v[a] > 0 ? '+' : '-'));
        const col = c ? palette[c] : inner;
        out.setXYZ(i, col.r, col.g, col.b);
      }
      out.needsUpdate = true;
      p.mat.roughness = pl.roughness;
      p.mat.clearcoat = pl.clearcoat;
      p.mat.clearcoatRoughness = pl.clearcoatRoughness;
      p.mat.sheen = pl.sheen;
      p.mat.sheenColor.set('#ffffff');
      p.mat.sheenRoughness = 0.6;
    }
    this.repaint = true;
    this.coreMat.color.set(skin.core);
  }

  /**
   * Place every cubie from the logical model; `move` (if any) is drawn
   * `amount` (0..1) of the way through its turn.
   */
  pose(model: Cube, move: Move | null, amount: number) {
    const angle = move ? amount * move.q * (Math.PI / 2) : 0;
    const turnQ = move ? tmpQ.setFromAxisAngle(AXES[move.axis], angle) : null;
    const e = this.explode;
    for (const p of this.pieces) {
      const c = model.cubies[p.id];
      const g = p.group;
      g.position.set(c.pos[0] * PITCH, c.pos[1] * PITCH, c.pos[2] * PITCH);
      const r = c.rot;
      tmpM.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      g.quaternion.setFromRotationMatrix(tmpM);
      if (turnQ && move!.layers.includes(c.pos[move!.axis])) {
        g.position.applyQuaternion(turnQ);
        g.quaternion.premultiply(turnQ);
      }
      if (e > 0) {
        const k = p.kind === 'corner' ? 1.0 : p.kind === 'edge' ? 0.78 : 0.62;
        g.position.multiplyScalar(1 + e * k);
      }
      if (this.intro < 1) {
        const t = easeOut(THREE.MathUtils.clamp((this.intro - p.delay) / (1 - 0.38), 0, 1));
        tmpV.copy(p.scatter).lerp(g.position, t);
        g.position.copy(tmpV);
        g.quaternion.slerpQuaternions(p.scatterQ, g.quaternion.clone(), t);
        g.visible = this.intro > p.delay * 0.6;
      } else {
        g.visible = true;
      }
    }
    this.core.visible = e > 0.02;
    if (this.core.visible) this.core.scale.setScalar(0.6 + 0.4 * Math.min(1, e * 1.4));
  }

  /** Dim every piece that is not in `names`. level 0 = no dimming. */
  setFocus(names: Iterable<string> | null, level = 0.6) {
    const set = names ? new Set(names) : null;
    for (const p of this.pieces) p.dimTarget = set && !set.has(p.name) ? level : 0;
  }

  /** Brief emissive pulse on a set of pieces. */
  flash(names: Iterable<string>, amount = 1) {
    const set = new Set(names);
    for (const p of this.pieces) if (set.has(p.name)) p.glow = Math.max(p.glow, amount);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 7);
    for (const p of this.pieces) {
      const prevDim = p.dim;
      const prevGlow = p.glow;
      p.dim += (p.dimTarget - p.dim) * k;
      if (Math.abs(p.dim - p.dimTarget) < 0.002) p.dim = p.dimTarget;
      p.glow = p.glow > 0.004 ? p.glow * Math.exp(-dt * 2.6) : 0;
      if (!this.repaint && p.dim === prevDim && p.glow === prevGlow) continue;
      // Dimmed pieces darken and lose most of their gloss so the lit ones pop.
      const m = p.mat;
      m.color.copy(WHITE).lerp(DIM_MUL, p.dim * 0.86);
      m.clearcoat = this.skin.plastic.clearcoat * (1 - p.dim * 0.7);
      m.envMapIntensity = 1 - p.dim * 0.7;
      m.emissiveIntensity = p.glow * 0.3;
    }
    this.repaint = false;
  }

  /**
   * World-space anchor on a piece: its face pointing at `face` if that face is
   * visible, otherwise the face that best faces the camera.
   */
  anchor(name: string, face: string | undefined, model: Cube, camera: THREE.Camera, out: THREE.Vector3): number | null {
    const p = this.byName.get(name);
    if (!p) return null;
    const c = model.cubies[p.id];
    const want = face ? FACE_VEC[face] : null;
    p.group.getWorldQuaternion(tmpQ);
    let bestScore = -Infinity;
    let facingBest = -1;
    for (const f of p.faces) {
      tmpN.set(...f.homeNormal).applyQuaternion(tmpQ);
      f.anchor.getWorldPosition(tmpV);
      const facing = tmpN.dot(tmpC.copy(camera.position).sub(tmpV).normalize());
      const logical = mulVec(c.rot, f.homeNormal);
      const match = want && logical[0] === want[0] && logical[1] === want[1] && logical[2] === want[2];
      const score = facing + (match && facing > 0.12 ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        facingBest = facing;
        out.copy(tmpV).addScaledVector(tmpN, 0.035);
      }
    }
    return facingBest;
  }
}
