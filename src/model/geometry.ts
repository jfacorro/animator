// 2D affine transforms and hit-testing for strokes.
import type { Stroke } from './project';

/** Canvas-style affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];
export type Vec = [number, number];
export interface Box { x0: number; y0: number; x1: number; y1: number }

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m ∘ n: apply n first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix | undefined, x: number, y: number): Vec {
  if (!m) return [x, y];
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];
export const scaleAbout = (sx: number, sy: number, ox: number, oy: number): Matrix => [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];

export function pointInPolygon(x: number, y: number, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Bounding box of a fill's spans, in the stroke's own coordinates. */
export function spansBox(spans: number[]): Box | null {
  if (spans.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < spans.length; i += 3) {
    const y = spans[i];
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (spans[i + 1] < x0) x0 = spans[i + 1];
    if (spans[i + 2] > x1) x1 = spans[i + 2];
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** A handful of points on the stroke, in drawing coordinates, for lasso hit tests. */
export function samplePoints(s: Stroke): Vec[] {
  const kind = s.kind ?? 'free';
  let local: Vec[];
  if (kind === 'fill') {
    const b = spansBox(s.spans ?? []);
    local = b ? [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]] : [];
  } else if (kind === 'text') {
    const [a, b] = s.points;
    if (!a || !b) return [];
    local = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]];
  } else if (kind === 'free') {
    const step = Math.max(1, Math.floor(s.points.length / 48));
    local = s.points.filter((_, i) => i % step === 0).map((p) => [p[0], p[1]] as Vec);
  } else {
    const [a, b] = s.points;
    if (!a || !b) return [];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    local = kind === 'line'
      ? [[a[0], a[1]], [mx, my], [b[0], b[1]]]
      : kind === 'rect'
        ? [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [mx, my]]
        : [[mx, a[1]], [b[0], my], [mx, b[1]], [a[0], my], [mx, my]];
  }
  return local.map(([x, y]) => apply(s.matrix, x, y));
}

/** Rough bounds of a stroke in drawing coordinates, including its line width. */
export function strokeBounds(s: Stroke): Box | null {
  const pts = samplePoints(s);
  if (!pts.length) return null;
  const scale = s.matrix ? Math.sqrt(Math.abs(s.matrix[0] * s.matrix[3] - s.matrix[1] * s.matrix[2])) : 1;
  const pad = (s.kind === 'fill' || s.kind === 'text' ? 0 : s.size / 2) * scale;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

export function unionBoxes(boxes: (Box | null)[]): Box | null {
  const bs = boxes.filter((b): b is Box => !!b);
  if (!bs.length) return null;
  return {
    x0: Math.min(...bs.map((b) => b.x0)),
    y0: Math.min(...bs.map((b) => b.y0)),
    x1: Math.max(...bs.map((b) => b.x1)),
    y1: Math.max(...bs.map((b) => b.y1)),
  };
}

/** Indices of the strokes that sit mostly inside a lasso polygon. */
export function strokesInLasso(strokes: Stroke[], lasso: Vec[]): number[] {
  if (lasso.length < 3) return [];
  const hits: number[] = [];
  strokes.forEach((s, i) => {
    const pts = samplePoints(s);
    if (!pts.length) return;
    const inside = pts.filter(([x, y]) => pointInPolygon(x, y, lasso)).length;
    if (inside / pts.length >= 0.5) hits.push(i);
  });
  return hits;
}
