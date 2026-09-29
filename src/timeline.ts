/**
 * Flattens a pre-computed solve into one move track (scramble, the z2
 * inspection flip, then every step's parts) with index ranges for the UI.
 */
import { parseAlg, parseMove, type Move } from './cube/cube.ts';
import type { MethodSolve, SolveStep } from './solver/common.ts';
import { METHODS, type MethodId, type StepMeta } from './content/methods.ts';

export interface Entry {
  scramble: string;
  methods: Record<MethodId, MethodSolve>;
}

export interface TPart {
  label: string;
  note?: string;
  pieces: string[];
  /** y-rotation a human would hold the cube in (0..3). */
  view: number;
  start: number;
  end: number;
  /** Tokens as read from that view. */
  tokens: string[];
}

export interface TStep {
  id: string;
  meta: StepMeta;
  number: number;
  start: number;
  end: number;
  parts: TPart[];
  moves: number;
  case?: SolveStep['case'];
}

export interface Timeline {
  method: MethodId;
  entry: Entry;
  track: Move[];
  scrambleLen: number;
  /** Index after the scramble and the z2 flip: where solving starts. */
  inspectEnd: number;
  steps: TStep[];
  total: number;
}

export const countTurns = (moves: Move[]) => moves.filter((m) => !'xyz'.includes(m.base)).length;

export function buildTimeline(method: MethodId, entry: Entry): Timeline {
  const track: Move[] = parseAlg(entry.scramble);
  const scrambleLen = track.length;
  track.push(parseMove('z2'));
  const inspectEnd = track.length;
  const meta = METHODS[method];
  const steps: TStep[] = entry.methods[method].steps.map((s, i) => {
    const start = track.length;
    const parts: TPart[] = s.parts.map((p) => {
      const moves = p.moves ? parseAlg(p.moves) : [];
      const ps = track.length;
      track.push(...moves);
      return {
        label: p.label,
        note: p.note,
        pieces: p.pieces ?? [],
        view: p.view ?? 0,
        start: ps,
        end: track.length,
        tokens: (p.display || p.moves || '').split(' ').filter(Boolean),
      };
    });
    const stepMeta = meta.steps.find((m) => m.id === s.id);
    if (!stepMeta) throw new Error(`no copy for step ${s.id}`);
    return {
      id: s.id,
      meta: stepMeta,
      number: i + 1,
      start,
      end: track.length,
      parts,
      moves: countTurns(track.slice(start)),
      case: s.case,
    };
  });
  return { method, entry, track, scrambleLen, inspectEnd, steps, total: countTurns(track.slice(inspectEnd)) };
}

/** Which step/part contains a track index (the move about to be played at `index`). */
export function locate(tl: Timeline, index: number): { step: TStep; part: TPart; partIndex: number } | null {
  for (const step of tl.steps) {
    if (index < step.start || index >= step.end) continue;
    const partIndex = step.parts.findIndex((p) => index >= p.start && index < p.end);
    if (partIndex >= 0) return { step, part: step.parts[partIndex], partIndex };
  }
  return null;
}
