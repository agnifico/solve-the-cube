import { pieceColors, COLOR_NAMES, type Color } from '../cube/cube.ts';

/** R' → R′ (typographic prime). */
export const pretty = (token: string) => token.replace(/'/g, '′');

const FACE_WORD: Record<string, string> = {
  R: 'Right face',
  L: 'Left face',
  U: 'Top face',
  D: 'Bottom face',
  F: 'Front face',
  B: 'Back face',
  M: 'Middle slice',
  E: 'Equator slice',
  S: 'Standing slice',
  r: 'Right two layers',
  l: 'Left two layers',
  u: 'Top two layers',
  d: 'Bottom two layers',
  f: 'Front two layers',
  b: 'Back two layers',
  x: 'Whole cube, like R',
  y: 'Whole cube, like U',
  z: 'Whole cube, like F',
};

export function describe(token: string): string {
  const base = token[0];
  const word = FACE_WORD[base] ?? base;
  const dir = token.includes('2') ? 'half turn' : token.includes("'") ? 'counter-clockwise' : 'clockwise';
  return `${word} · ${dir}`;
}

export function swatchHTML(colors: Color[]): string {
  return `<span class="swatch" aria-hidden="true">${colors.map((c) => `<i style="background:var(--c-${c})"></i>`).join('')}</span>`;
}

export const pieceSwatch = (name: string) => swatchHTML(pieceColors(name));

export function chipsHTML(tokens: string[], extraClass = ''): string {
  return tokens.map((t) => `<span class="mv ${extraClass}">${pretty(t)}</span>`).join('');
}

export const escapeHTML = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "DF" → "White–Green edge" (solving-frame piece names). */
export function pieceTitle(name: string): string {
  const cols = pieceColors(name).map((c) => COLOR_NAMES[c]);
  return `${cols.join('–')} ${name.length === 3 ? 'corner' : name.length === 2 ? 'edge' : 'centre'}`;
}
