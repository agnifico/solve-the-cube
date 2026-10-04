/**
 * Cube skins: stickerless pieces moulded in colour. Each skin sets the palette,
 * the plastic, the mechanism's colour and the studio look that suits it.
 */
import type { Color } from '../cube/cube.ts';

export type SkinId = 'speed' | 'macaron';

export interface Look {
  exposure: number;
  /** Image-based lighting strength (reflections). */
  env: number;
  bloom: number;
  bloomThreshold: number;
  /** Strength of the accent glow behind the cube. */
  glow: number;
  /** Background lift towards a soft tint (0 = graphite). */
  haze: number;
}

export interface Skin {
  id: SkinId;
  name: string;
  note: string;
  palette: Record<Color, string>;
  /** Plastic on faces that never show a colour (what you see in the seams). */
  inner: string;
  plastic: {
    roughness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    /** Soft velvety rim on matte plastics. */
    sheen: number;
  };
  core: string;
  look: Look;
}

export const SKINS: Record<SkinId, Skin> = {
  speed: {
    id: 'speed',
    name: 'Speed',
    note: 'Stickerless, bright and glossy',
    palette: { W: '#ecece6', Y: '#ffd400', G: '#00b85a', B: '#1460ff', R: '#ef1f2d', O: '#ff7a00' },
    inner: '#17181c',
    plastic: { roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.28, sheen: 0 },
    core: '#1b1d22',
    look: { exposure: 1.02, env: 0.5, bloom: 0.16, bloomThreshold: 1.6, glow: 1, haze: 0 },
  },
  macaron: {
    id: 'macaron',
    name: 'Macaron',
    note: 'Soft-touch matte pastels',
    palette: { W: '#efe6d8', Y: '#ffd157', G: '#5ccb94', B: '#6799ea', R: '#ec6a86', O: '#ff9655' },
    inner: '#a69d95',
    plastic: { roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.6, sheen: 0.35 },
    core: '#d8d0c8',
    look: { exposure: 0.98, env: 0.55, bloom: 0.1, bloomThreshold: 2, glow: 0.9, haze: 0.35 },
  },
};

export const SKIN_ORDER: SkinId[] = ['speed', 'macaron'];
export const DEFAULT_SKIN: SkinId = 'speed';
