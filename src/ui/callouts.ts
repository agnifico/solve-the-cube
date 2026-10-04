/**
 * Technical-drawing callouts: a dot on a 3D anchor, a thin white leader line
 * with an elbow, and a label stacked in a column beside the cube. Labels avoid
 * each other and the text column; hidden anchors fade back.
 */
import * as THREE from 'three';
import type { Stage } from '../three/stage.ts';
import type { Color } from '../cube/cube.ts';
import { swatchHTML } from './format.ts';

export interface CalloutDef {
  id: string;
  title: string;
  text?: string;
  swatch?: Color[];
  /** Compact tag style (small bordered label). */
  tag?: boolean;
  /** Writes the world anchor into `out`; returns how much it faces the camera (or null if gone). */
  anchor: (out: THREE.Vector3) => number | null;
  side?: 'auto' | 'left' | 'right';
}

interface Item {
  def: CalloutDef;
  el: HTMLDivElement;
  g: SVGGElement;
  halo: SVGPathElement;
  path: SVGPathElement;
  ring: SVGCircleElement;
  dot: SVGCircleElement;
  x: number;
  y: number;
  ax: number;
  ay: number;
  facing: number;
  side: 'left' | 'right' | null;
  placed: boolean;
  dying: boolean;
  w: number;
  h: number;
}

const NS = 'http://www.w3.org/2000/svg';
const tmp = new THREE.Vector3();

export class Callouts {
  private items = new Map<string, Item>();
  private svg: SVGSVGElement;
  private layer: HTMLElement;
  private stage: Stage;
  /** Screen x (px) left of which labels must not go (the text column). */
  safeLeft = 0;
  /** Distance (px) from the bottom of the viewport that labels must stay above. */
  safeBottom = 60;
  maxItems = 6;

  constructor(svg: SVGSVGElement, layer: HTMLElement, stage: Stage) {
    this.svg = svg;
    this.layer = layer;
    this.stage = stage;
  }

  set(defs: CalloutDef[]) {
    defs = defs.slice(0, this.maxItems);
    const keep = new Set(defs.map((d) => d.id));
    for (const [id, it] of this.items) if (!keep.has(id)) this.kill(id, it);
    for (const d of defs) {
      const it = this.items.get(d.id);
      if (it && !it.dying) {
        it.def = d;
        this.fill(it);
        continue;
      }
      if (it) this.remove(d.id);
      this.create(d);
    }
  }

  clear() {
    this.set([]);
  }

  private fill(it: Item) {
    const d = it.def;
    const title = it.el.querySelector('.callout__title')!;
    const html = `${d.swatch ? swatchHTML(d.swatch) : ''}<span>${d.title}</span>`;
    if (title.innerHTML !== html) title.innerHTML = html;
    const text = it.el.querySelector('.callout__text') as HTMLElement;
    text.textContent = d.text ?? '';
    text.style.display = d.text ? '' : 'none';
    it.el.classList.toggle('callout--tag', !!d.tag);
    it.w = it.el.offsetWidth;
    it.h = it.el.offsetHeight;
  }

  private create(def: CalloutDef) {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = '<div class="callout__inner"><span class="callout__title"></span><span class="callout__text"></span></div>';
    this.layer.appendChild(el);
    const g = document.createElementNS(NS, 'g');
    const halo = document.createElementNS(NS, 'path');
    halo.setAttribute('class', 'halo');
    const path = document.createElementNS(NS, 'path');
    for (const p of [halo, path]) {
      p.setAttribute('pathLength', '1');
      p.style.strokeDasharray = '1';
      p.style.strokeDashoffset = '1';
    }
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('r', '6');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('r', '3.2');
    dot.style.setProperty('r', '0px');
    g.append(halo, path, ring, dot);
    this.svg.appendChild(g);
    const it: Item = { def, el, g, halo, path, ring, dot, x: 0, y: 0, ax: 0, ay: 0, facing: 1, side: null, placed: false, dying: false, w: 0, h: 0 };
    this.items.set(def.id, it);
    this.fill(it);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (it.dying) return;
        for (const p of [halo, path]) {
          p.style.transition = 'stroke-dashoffset 0.7s cubic-bezier(.16,1,.3,1)';
          p.style.strokeDashoffset = '0';
        }
        dot.style.transition = 'r 0.4s cubic-bezier(.16,1,.3,1)';
        dot.style.setProperty('r', '3.2px');
        setTimeout(() => !it.dying && el.classList.add('is-in'), 260);
      }),
    );
  }

  private kill(id: string, it: Item) {
    if (it.dying) return;
    it.dying = true;
    it.el.classList.remove('is-in');
    for (const p of [it.halo, it.path]) {
      p.style.transition = 'stroke-dashoffset 0.35s ease-in';
      p.style.strokeDashoffset = '1';
    }
    it.dot.style.setProperty('r', '0px');
    setTimeout(() => {
      if (this.items.get(id) === it) this.remove(id);
    }, 420);
  }

  private remove(id: string) {
    const it = this.items.get(id);
    if (!it) return;
    it.el.remove();
    it.g.remove();
    this.items.delete(id);
  }

  update(dt: number, cube: { x: number; y: number; r: number }) {
    const W = this.stage.width;
    const H = this.stage.height;
    const gap = Math.max(26, cube.r * 0.16);
    const rightX = cube.x + cube.r + gap;
    const leftX = cube.x - cube.r - gap;
    const alive: Item[] = [];
    for (const it of this.items.values()) {
      const f = it.def.anchor(tmp);
      if (f === null) continue;
      const s = this.stage.toScreen(tmp);
      it.ax = s.x;
      it.ay = s.y;
      it.facing = f;
      alive.push(it);
    }
    // Choose sides once, then keep them (no flip-flopping while the cube turns).
    for (const it of alive) {
      if (it.side) continue;
      const want = it.def.side ?? 'auto';
      const leftFits = leftX - it.w > this.safeLeft + 12;
      if (want === 'left' && leftFits) it.side = 'left';
      else if (want === 'right') it.side = 'right';
      else it.side = it.ax < cube.x - cube.r * 0.15 && leftFits ? 'left' : 'right';
    }
    for (const side of ['left', 'right'] as const) {
      const col = alive.filter((i) => i.side === side).sort((a, b) => a.ay - b.ay);
      const ys = col.map((i) => i.ay);
      const top = 90;
      const bottom = H - this.safeBottom;
      for (let i = 0; i < col.length; i++) {
        const min = i === 0 ? top + col[i].h / 2 : ys[i - 1] + (col[i - 1].h + col[i].h) / 2 + 12;
        ys[i] = Math.max(ys[i], min);
      }
      for (let i = col.length - 1; i >= 0; i--) {
        const max = i === col.length - 1 ? bottom - col[i].h / 2 : ys[i + 1] - (col[i + 1].h + col[i].h) / 2 - 12;
        ys[i] = Math.min(ys[i], max);
      }
      col.forEach((it, i) => {
        let tx = side === 'right' ? Math.max(rightX, it.ax + 36) : Math.min(leftX, it.ax - 36);
        if (side === 'right') tx = Math.min(tx, W - 16 - it.w);
        else tx = Math.max(tx, this.safeLeft + it.w + 12);
        const ty = ys[i];
        if (!it.placed) {
          it.x = tx;
          it.y = ty;
          it.placed = true;
        } else {
          const k = 1 - Math.exp(-dt * 9);
          it.x += (tx - it.x) * k;
          it.y += (ty - it.y) * k;
        }
      });
    }
    for (const it of alive) {
      const right = it.side === 'right';
      const lx = right ? it.x - 6 : it.x + 6;
      const ex = right ? lx - Math.min(34, Math.max(10, (lx - it.ax) * 0.4)) : lx + Math.min(34, Math.max(10, (it.ax - lx) * 0.4));
      const d = `M${it.ax.toFixed(1)} ${it.ay.toFixed(1)}L${ex.toFixed(1)} ${it.y.toFixed(1)}L${lx.toFixed(1)} ${it.y.toFixed(1)}`;
      it.path.setAttribute('d', d);
      it.halo.setAttribute('d', d);
      it.dot.setAttribute('cx', it.ax.toFixed(1));
      it.dot.setAttribute('cy', it.ay.toFixed(1));
      it.ring.setAttribute('cx', it.ax.toFixed(1));
      it.ring.setAttribute('cy', it.ay.toFixed(1));
      const hidden = it.facing < 0.08;
      it.g.style.opacity = hidden ? '0.28' : '1';
      it.el.classList.toggle('is-hidden-side', hidden);
      it.el.classList.toggle('callout--left', !right);
      const x = right ? it.x : it.x - it.w;
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${(it.y - it.h / 2).toFixed(1)}px, 0)`;
    }
  }
}
