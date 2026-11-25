// Brush presets and the stabilizer that steadies the pointer while drawing.
import type { GrainKind, Point } from './project';

export interface BrushPreset {
  id: string;
  name: string;
  help: string;
  size: number;
  /** 0–1. Lower values let earlier lines show through. */
  opacity: number;
  /** perfect-freehand smoothing of the line's outline. */
  smoothing: number;
  /** 0–1. How far the line trails behind the pointer to steady a shaky hand. */
  stabilizer: number;
  /** How much pressure changes the width: 0 is an even line. */
  thinning: number;
  /** 0–1. Blurs the edge of the line. */
  softness: number;
  /** Paper texture that shows through the line, and how strongly (0–1). */
  grain?: GrainKind | 'none';
  grainAmount?: number;
  /** A brush the user saved, not one of the built-in presets. */
  custom?: boolean;
}

export const GRAINS: { id: GrainKind | 'none'; name: string }[] = [
  { id: 'none', name: 'None' }, { id: 'pencil', name: 'Pencil' }, { id: 'chalk', name: 'Chalk' }, { id: 'canvas', name: 'Canvas' },
];

export const PRESETS: BrushPreset[] = [
  { id: 'pencil', name: 'Pencil', help: 'thin, slightly see-through and pressure-sensitive, for sketching', size: 3, opacity: 0.8, smoothing: 0.3, stabilizer: 0, thinning: 0.75, softness: 0.15 },
  { id: 'ink', name: 'Ink', help: 'crisp, solid lines that taper with pressure, for clean line art', size: 5, opacity: 1, smoothing: 0.6, stabilizer: 0.35, thinning: 0.6, softness: 0 },
  { id: 'marker', name: 'Marker', help: 'wide, even and see-through; overlapping strokes build up colour', size: 16, opacity: 0.5, smoothing: 0.5, stabilizer: 0.15, thinning: 0, softness: 0 },
  { id: 'soft', name: 'Soft', help: 'big, faint and blurry, for shading and glows', size: 32, opacity: 0.3, smoothing: 0.6, stabilizer: 0.1, thinning: 0.3, softness: 0.6 },
  { id: 'graphite', name: 'Graphite', help: 'a pencil with paper grain showing through, for sketchy, textured lines', size: 6, opacity: 0.85, smoothing: 0.3, stabilizer: 0, thinning: 0.7, softness: 0, grain: 'pencil', grainAmount: 0.55 },
  { id: 'chalk', name: 'Chalk', help: 'wide and rough, with gaps where the grain catches, for texture and dry shading', size: 20, opacity: 0.9, smoothing: 0.4, stabilizer: 0.1, thinning: 0.2, softness: 0, grain: 'chalk', grainAmount: 0.7 },
];

type PresetFields = Pick<BrushPreset, 'size' | 'opacity' | 'smoothing' | 'stabilizer' | 'thinning' | 'softness' | 'grain' | 'grainAmount'>;

/** True when two brushes have the same settings. */
export function sameBrush(p: PresetFields, b: PresetFields): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  const grain = (x: PresetFields) => (x.grain && x.grain !== 'none' && (x.grainAmount ?? 0) > 0 ? `${x.grain}:${x.grainAmount}` : 'none');
  return p.size === b.size && near(p.opacity, b.opacity) && near(p.smoothing, b.smoothing)
    && near(p.stabilizer, b.stabilizer) && near(p.thinning, b.thinning) && near(p.softness, b.softness) && grain(p) === grain(b);
}

/** The preset (or saved brush) these settings match, if any. */
export function matchingPreset(b: PresetFields, saved: BrushPreset[] = []): BrushPreset | undefined {
  return [...PRESETS, ...saved].find((p) => sameBrush(p, b));
}

/** A saved brush from storage, or null if it isn't one. */
export function validBrush(v: unknown): BrushPreset | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const nums = ['size', 'opacity', 'smoothing', 'stabilizer', 'thinning', 'softness'];
  if (typeof b.id !== 'string' || typeof b.name !== 'string' || !nums.every((k) => typeof b[k] === 'number')) return null;
  const grain = GRAINS.some((g) => g.id === b.grain) ? (b.grain as BrushPreset['grain']) : 'none';
  return { ...(b as unknown as BrushPreset), help: typeof b.help === 'string' ? b.help : 'your brush', grain, grainAmount: typeof b.grainAmount === 'number' ? b.grainAmount : 0, custom: true };
}

/**
 * Stabilizer: move the pen tip only part of the way toward the pointer, so
 * small wobbles average out. `amount` 0 follows the pointer exactly.
 */
export function stabilize(tip: Point, pointer: Point, amount: number): Point {
  const k = 1 - Math.min(0.92, Math.max(0, amount) * 0.92);
  return [tip[0] + (pointer[0] - tip[0]) * k, tip[1] + (pointer[1] - tip[1]) * k, pointer[2]];
}

/** At the end of a stroke, bring the trailing tip to where the pointer stopped. */
export function catchUp(tip: Point, pointer: Point, step = 3): Point[] {
  const d = Math.hypot(pointer[0] - tip[0], pointer[1] - tip[1]);
  const n = Math.ceil(d / step);
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push([tip[0] + (pointer[0] - tip[0]) * t, tip[1] + (pointer[1] - tip[1]) * t, tip[2] + (pointer[2] - tip[2]) * t]);
  }
  return out;
}
