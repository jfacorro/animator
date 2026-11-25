// Bending drawings: Warp (a 3×3 grid of handles over a selection) and Liquify
// (push lines or paint along with the pointer).
import type { Matrix, Vec } from './geometry';
import type { Box } from './geometry';
import type { Point, Stroke } from './project';

/** 3×3 handles, row by row, over a box. */
export interface Grid { box: Box; pts: Vec[] }

export function startGrid(box: Box): Grid {
  const pts: Vec[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) pts.push([box.x0 + ((box.x1 - box.x0) * i) / 2, box.y0 + ((box.y1 - box.y0) * j) / 2]);
  return { box, pts };
}

export const isFlat = (g: Grid) => startGrid(g.box).pts.every((p, i) => p[0] === g.pts[i][0] && p[1] === g.pts[i][1]);

/**
 * Where a point inside the grid's box goes when the handles have moved: a smooth
 * (quadratic) surface through all nine handles, so bends come out as curves.
 */
export function warpPoint(g: Grid, x: number, y: number): Vec {
  const { x0, y0, x1, y1 } = g.box;
  const u = (x - x0) / (x1 - x0 || 1);
  const v = (y - y0) / (y1 - y0 || 1);
  const basis = (t: number) => [2 * (t - 0.5) * (t - 1), -4 * t * (t - 1), 2 * t * (t - 0.5)];
  const bu = basis(u), bv = basis(v);
  let px = 0, py = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const w = bu[i] * bv[j];
    px += w * g.pts[j * 3 + i][0];
    py += w * g.pts[j * 3 + i][1];
  }
  return [px, py];
}

const applyM = (m: Matrix | undefined, x: number, y: number): Vec => (m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y]);
/** Bake a stroke's matrix into its points (widths scale with it), so its points can be bent. */
function flatten(s: Stroke): Stroke {
  const m = s.matrix;
  if (!m) return s;
  const grow = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const { matrix: _drop, ...rest } = s;
  void _drop;
  return { ...rest, size: s.size * grow, points: s.points.map((p) => { const [x, y] = applyM(m, p[0], p[1]); return [x, y, p[2]]; }) };
}

/** Strokes that can be bent point by point: lines and shapes, not fills or text. */
export const bendable = (s: Stroke) => s.kind !== 'fill' && s.kind !== 'text';

/** Rectangles and ellipses have two corner points; bending needs their outline as points. */
function outlinePoints(s: Stroke): Stroke {
  if (s.kind !== 'rect' && s.kind !== 'ellipse') return s;
  const [a, b] = s.points;
  const pts: Point[] = [];
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  if (s.kind === 'rect') {
    const corners: Vec[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    for (let k = 1; k < corners.length; k++) for (let i = 0; i < 16; i++) {
      const t = i / 16;
      pts.push([corners[k - 1][0] + (corners[k][0] - corners[k - 1][0]) * t, corners[k - 1][1] + (corners[k][1] - corners[k - 1][1]) * t, 0.5]);
    }
    pts.push([x0, y0, 0.5]);
  } else {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, 0.5]); }
  }
  // The same outline as points: an even line, or a filled polygon.
  return { ...s, kind: 'line', points: pts };
}

/** Add points along long straight runs, so bending makes curves rather than kinks. */
function densify(s: Stroke, step: number): Stroke {
  const out: Stroke['points'] = [];
  s.points.forEach((p, i) => {
    if (i) {
      const q = s.points[i - 1];
      const n = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / step);
      for (let k = 1; k < n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n, q[2] + ((p[2] - q[2]) * k) / n]);
    }
    out.push(p);
  });
  return { ...s, points: out };
}

/** Bend the chosen strokes through a warp grid. */
export function warpStrokes(strokes: Stroke[], indices: number[], g: Grid): Stroke[] {
  const set = new Set(indices);
  return strokes.map((s, i) => {
    if (!set.has(i) || !bendable(s)) return s;
    const flat = densify(outlinePoints(flatten(s)), 6);
    return { ...flat, points: flat.points.map((p): Point => { const [x, y] = warpPoint(g, p[0], p[1]); return [x, y, p[2]]; }) };
  });
}

/** How strongly Liquify moves a point at distance d from its centre. */
export const falloff = (d: number, r: number) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

/**
 * Liquify: points within `radius` of `at` move along with the pointer by `delta`,
 * less the further they are. Returns null when nothing was in reach.
 */
export function pushStrokes(strokes: Stroke[], at: Vec, delta: Vec, radius: number): Stroke[] | null {
  let changed = false;
  const out = strokes.map((s) => {
    if (!bendable(s)) return s;
    // Quick reject by the box around the stroke's points.
    const m = s.matrix;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) {
      const [x, y] = applyM(m, p[0], p[1]);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (at[0] < x0 - radius || at[0] > x1 + radius || at[1] < y0 - radius || at[1] > y1 + radius) return s;
    const flat = densify(outlinePoints(flatten(s)), 4);
    if (!flat.points.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < radius)) return s;
    changed = true;
    return {
      ...flat,
      points: flat.points.map((p) => {
        const f = falloff(Math.hypot(p[0] - at[0], p[1] - at[1]), radius);
        return (f ? [p[0] + delta[0] * f, p[1] + delta[1] * f, p[2]] : p) as Point;
      }),
    };
  });
  return changed ? out : null;
}
