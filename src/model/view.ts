// How the canvas sits on screen: zoom, pan, rotation and mirroring.
// The canvas is laid out centred in the stage at a "fit" size; the view is
// applied on top of that as a CSS transform around the canvas centre.
import type { Vec } from './geometry';

export interface View {
  /** Multiplier on the fit-to-screen size. 1 = fit. */
  zoom: number;
  /** Offset of the canvas centre from the stage centre, in screen px. */
  x: number;
  y: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Mirror left to right (only on screen; the drawing isn't changed). */
  flip: boolean;
}

export const FIT_VIEW: View = { zoom: 1, x: 0, y: 0, rotation: 0, flip: false };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const rad = (deg: number) => (deg * Math.PI) / 180;
const rotate = ([x, y]: Vec, deg: number): Vec => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
};

/** Keep rotation in (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Math.round(a * 1000) / 1000;
}

export function viewTransform(v: View): string {
  return `translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${v.flip ? -v.zoom : v.zoom}, ${v.zoom})`;
}

/** Screen offset from the stage centre → offset from the canvas centre in laid-out (fit) px. */
export function screenToLocal(v: View, s: Vec): Vec {
  const [x, y] = rotate([s[0] - v.x, s[1] - v.y], -v.rotation);
  return [(v.flip ? -x : x) / v.zoom, y / v.zoom];
}

/** Inverse of screenToLocal. */
export function localToScreen(v: View, l: Vec): Vec {
  const [x, y] = rotate([(v.flip ? -l[0] : l[0]) * v.zoom, l[1] * v.zoom], v.rotation);
  return [x + v.x, y + v.y];
}

/** Zoom by `factor`, keeping the point under screen offset `at` still. */
export function zoomAt(v: View, factor: number, at: Vec = [0, 0]): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { ...v, zoom, x: at[0] - k * (at[0] - v.x), y: at[1] - k * (at[1] - v.y) };
}

/** Rotate by `deg`, keeping the point under screen offset `at` still. */
export function rotateAt(v: View, deg: number, at: Vec = [0, 0]): View {
  const [x, y] = rotate([v.x - at[0], v.y - at[1]], deg);
  return { ...v, rotation: normalizeAngle(v.rotation + deg), x: at[0] + x, y: at[1] + y };
}

/** Mirror the view around screen offset `at` (default: the stage centre). */
export function flipAt(v: View, at: Vec = [0, 0]): View {
  // Mirroring flips the sense of rotation too, so the canvas stays where it is on screen.
  return { ...v, flip: !v.flip, rotation: normalizeAngle(-v.rotation), x: 2 * at[0] - v.x };
}

/**
 * Two-finger pinch: the two starting points `a0, b0` move to `a1, b1`.
 * Returns the view that keeps the canvas under both fingers.
 */
export function pinch(v: View, a0: Vec, b0: Vec, a1: Vec, b1: Vec): View {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) || 1;
  const zoom = clampZoom(v.zoom * (d1 / d0));
  const k = zoom / v.zoom;
  const turn = ((Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0])) * 180) / Math.PI;
  const m0: Vec = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const m1: Vec = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
  const [x, y] = rotate([(v.x - m0[0]) * k, (v.y - m0[1]) * k], turn);
  return { ...v, zoom, rotation: normalizeAngle(v.rotation + turn), x: m1[0] + x, y: m1[1] + y };
}

/** Snap nearly-straight rotations back to straight (after a pinch). */
export function snapRotation(v: View, within = 5): View {
  const nearest = Math.round(v.rotation / 90) * 90;
  return Math.abs(v.rotation - nearest) <= within ? { ...v, rotation: normalizeAngle(nearest) } : v;
}
