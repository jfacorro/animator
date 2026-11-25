// Quick multi-finger taps on the canvas: two fingers undo, three redo.
import type { Vec } from './geometry';

/** Fingers may move this far (screen px) and still tap. */
const SLOP = 12;
/** The whole tap, first finger down to last finger up, within this many ms. */
const MAX_MS = 350;

export interface Taps {
  t0: number;
  /** Most fingers down at once. */
  max: number;
  starts: Map<number, Vec>;
  /** Too much movement, too long, or interrupted: not a tap. */
  spoiled: boolean;
}

/** A finger went down. Pass `active`, the fingers already down before it. */
export function tapDown(t: Taps | null, active: number, id: number, at: Vec, now: number): Taps {
  const taps = t && active > 0 ? t : { t0: now, max: 0, starts: new Map<number, Vec>(), spoiled: false };
  taps.starts.set(id, at);
  taps.max = Math.max(taps.max, active + 1);
  return taps;
}

export function tapMove(t: Taps | null, id: number, at: Vec) {
  const s = t?.starts.get(id);
  if (t && s && Math.hypot(at[0] - s[0], at[1] - s[1]) > SLOP) t.spoiled = true;
}

/** A finger lifted, leaving `left` down. When the last one lifts, returns how many fingers tapped (0 if it wasn't a tap). */
export function tapUp(t: Taps | null, left: number, now: number): number {
  if (!t || left > 0) return 0;
  return !t.spoiled && now - t.t0 <= MAX_MS ? t.max : 0;
}
