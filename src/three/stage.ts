/**
 * Renderer, studio lighting, environment, background and post-processing.
 * The camera never moves: the cube is presented by rotating its group (see
 * Rig), so the lights behave like a photo studio around a turntable.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const BASE_DISTANCE = 14.2;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 dir = vUv - 0.5;
      float ca = 0.0016 * dot(dir, dir) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ca).b;
      float v = smoothstep(1.05, 0.25, length(dir * vec2(1.0, 1.2)));
      col *= mix(1.0 - uVignette, 1.0, v);
      float g = hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly rim: THREE.DirectionalLight;
  readonly key: THREE.DirectionalLight;
  width = 1;
  height = 1;
  dpr = 1;
  /** Upper bound for the pixel ratio; lowered by the adaptive quality governor. */
  maxDpr = 1.5;
  /** Screen shift of the cube as a fraction of the viewport (applied through a lens shift). */
  shift = new THREE.Vector2(0, 0);
  private accent = new THREE.Color('#f3f2ed');
  private accentTarget = new THREE.Color('#f3f2ed');

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.setClearColor(0x07080b, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0, BASE_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    // Image-based lighting: a neutral studio room for crisp reflections on the tiles.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.scene.environmentRotation.set(0.35, -0.6, 0);
    pmrem.dispose();

    // Key light with soft PCF shadows so the grooves and turning layers shade each other.
    const key = new THREE.DirectionalLight(0xfff6ec, 2.0);
    key.position.set(4.5, 7.5, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 1;
    sc.far = 24;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 4;
    this.key = key;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc9d8ff, 0.55);
    fill.position.set(-8, 1.5, 4);
    this.scene.add(fill);

    // Coloured rim from behind: carries the method accent onto the silhouette.
    this.rim = new THREE.DirectionalLight(0xffffff, 2.2);
    this.rim.position.set(-3.5, 4.5, -8);
    this.scene.add(this.rim);

    const under = new THREE.DirectionalLight(0x9fb4ff, 0.35);
    under.position.set(2, -7, 3);
    this.scene.add(under);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1d26, 0.18));

    // Full-screen background: deep graphite with a soft accent glow behind the cube.
    this.bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uCenter: { value: new THREE.Vector2(0.5, 0.5) },
          uAspect: { value: 1 },
          uAccent: { value: this.accent },
          uGlow: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec2 uCenter;
          uniform float uAspect;
          uniform vec3 uAccent;
          uniform float uGlow;
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - uCenter;
            p.x *= uAspect;
            float d = length(p);
            vec3 col = vec3(0.0021, 0.0024, 0.0034);
            col += uAccent * uGlow * 0.028 * exp(-d * d * 5.5);
            col += vec3(0.008, 0.009, 0.012) * exp(-d * d * 1.4);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1000;
    this.scene.add(this.bg);

    this.dust = this.makeDust();
    this.scene.add(this.dust);

    // Post: MSAA render → bloom → tone map / sRGB → grade (vignette, grain, lens CA).
    const hiDpi = (window.devicePixelRatio || 1) >= 1.5;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: hiDpi ? 2 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.45, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.resize();
  }

  private makeDust() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = -10 + Math.random() * 14;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAccent: { value: this.accent }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform float uPx;
        varying float vA;
        varying float vS;
        void main() {
          vec3 p = position;
          // Drift upwards and wrap, fading out near the wrap edges.
          p.y = mod(position.y + 7.0 + uTime * (0.05 + seed * 0.08), 14.0) - 7.0;
          p.x += sin(uTime * 0.2 + seed * 40.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = -mv.z;
          gl_PointSize = uPx * (1.0 + seed * 2.2) * (14.0 / depth);
          float edge = smoothstep(-7.0, -5.0, p.y) * smoothstep(7.0, 5.0, p.y);
          vA = smoothstep(26.0, 9.0, depth) * (0.25 + 0.75 * seed) * edge;
          vS = seed;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uAccent;
        varying float vA;
        varying float vS;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * 0.22;
          vec3 c = mix(vec3(1.0), uAccent, step(0.62, vS));
          gl_FragColor = vec4(c * a, a);
        }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /** Compile every shader up front so nothing stalls the first time it appears. */
  warmup(show: THREE.Object3D[]) {
    const was = show.map((o) => o.visible);
    show.forEach((o) => (o.visible = true));
    this.renderer.compile(this.scene, this.camera);
    this.composer.render(0.016);
    show.forEach((o, i) => (o.visible = was[i]));
  }

  /** Drop resolution one notch (returns false when already at the floor). */
  degrade(): boolean {
    if (this.maxDpr <= 1) return false;
    this.maxDpr = Math.max(1, this.maxDpr - 0.25);
    this.resize();
    return true;
  }

  setAccent(hex: string) {
    this.accentTarget.set(hex);
  }

  /** Camera distance multiplier: zoom 1 = default framing. */
  setZoom(zoom: number) {
    this.camera.position.z = BASE_DISTANCE / zoom;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, w < 800 ? Math.min(2, this.maxDpr + 0.5) : this.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Narrow screens need a wider lens to keep the cube in frame.
    this.camera.fov = w / h < 0.8 ? 38 : 30;
    this.applyShift();
    this.bg.material.uniforms.uAspect.value = w / h;
    this.grade.uniforms.uRes.value.set(w * this.dpr, h * this.dpr);
    this.dust.material.uniforms.uPx.value = this.dpr;
  }

  applyShift() {
    const { width: w, height: h } = this;
    this.camera.setViewOffset(w, h, -this.shift.x * w, -this.shift.y * h, w, h);
    this.camera.updateProjectionMatrix();
    this.bg.material.uniforms.uCenter.value.set(0.5 + this.shift.x, 0.5 - this.shift.y);
  }

  /** Project a world point to CSS pixels. */
  toScreen(v: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const p = v.clone().project(this.camera);
    return out.set((p.x * 0.5 + 0.5) * this.width, (-p.y * 0.5 + 0.5) * this.height);
  }

  /** Approximate on-screen radius (px) of a sphere of radius r at the origin. */
  screenRadius(r: number): number {
    const d = this.camera.position.z;
    const f = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    return (r / d) * f;
  }

  render(dt: number, time: number) {
    this.accent.lerp(this.accentTarget, 1 - Math.exp(-dt * 3));
    this.rim.color.copy(this.accent).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.dust.material.uniforms.uTime.value = time;
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
