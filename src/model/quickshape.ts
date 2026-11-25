// QuickShape: draw a rough line, circle or box and hold the pen still at the
// end, and the stroke snaps into a clean version of the shape.
import type { Point } from './project';

type Vec = [number, number];

export type QuickShape =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number }
  | { kind: 'polygon'; points: Vec[]; closed: boolean };

/** How long the pen has to stay still at the end of a stroke. */
export const HOLD_MS = 500;

const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pathLength(pts: Vec[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Distance from p to the segment a–b. */
function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker: the few points that keep the path's shape within eps. */
export function simplify(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, at + 1), eps);
  return [...left.slice(0, -1), ...simplify(pts.slice(at), eps)];
}

function fitEllipse(pts: Vec[]): { shape: QuickShape & { kind: 'ellipse' }; error: number } | null {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(angle), s = Math.sin(angle);
  // The shape's extent along its own axes.
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of pts) {
    const u = (x - mx) * c + (y - my) * s;
    const v = -(x - mx) * s + (y - my) * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const rx = (u1 - u0) / 2, ry = (v1 - v0) / 2;
  if (rx < 2 || ry < 2) return null;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cx = mx + uc * c - vc * s, cy = my + uc * s + vc * c;
  let err = 0;
  for (const [x, y] of pts) {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    err += Math.abs(Math.hypot(u / rx, v / ry) - 1);
  }
  return { shape: { kind: 'ellipse', cx, cy, rx, ry, angle }, error: err / n };
}

/** The clean shape a rough stroke looks like, or null to leave it as drawn. */
export function recognize(points: readonly (Point | Vec)[], minGap = 3): QuickShape | null {
  // Holding the pen still adds a cluster of jittery points at the end, and slow
  // drawing bunches points up: keep only points some distance apart.
  const pts: Vec[] = [];
  for (const p of points) {
    const v: Vec = [p[0], p[1]];
    if (!pts.length || dist(pts[pts.length - 1], v) >= minGap) pts.push(v);
  }
  const lastRaw = points[points.length - 1];
  if (lastRaw && pts.length > 1 && dist(pts[pts.length - 1], [lastRaw[0], lastRaw[1]]) > 0) pts[pts.length - 1] = [lastRaw[0], lastRaw[1]];
  if (pts.length < 3) return null;
  const length = pathLength(pts);
  if (length < 12) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const span = dist(a, b);

  // A line: nearly as long as the path, and never far off it.
  let dev = 0;
  for (const p of pts) dev = Math.max(dev, segDist(p, a, b));
  if (span > 0.85 * length && dev < Math.max(3, span * 0.09)) return { kind: 'line', a, b };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.hypot(x1 - x0, y1 - y0);
  // Closed: the ends meet, or the stroke went (nearly) all the way round, even if it overshot.
  let turn = 0;
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn += d;
  }
  const closed = span < size * 0.4 || Math.abs(turn) > Math.PI * 1.6;
  const eps = size * 0.07;
  const corners = simplify(pts, eps);
  const meanDev = (poly: Vec[], close: boolean) => {
    let sum = 0;
    for (const p of pts) {
      let best = Infinity;
      for (let i = 1; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i - 1], poly[i]));
      if (close) best = Math.min(best, segDist(p, poly[poly.length - 1], poly[0]));
      sum += best;
    }
    return sum / pts.length / size;
  };

  if (closed) {
    // Sharp corners make a polygon; otherwise try an ellipse.
    const poly = corners.slice(0, dist(corners[0], corners[corners.length - 1]) < eps * 2 ? -1 : undefined);
    const ellipse = fitEllipse(pts);
    const polyOk = poly.length >= 3 && poly.length <= 6 && meanDev(poly, true) < 0.025;
    if (ellipse && ellipse.error < 0.08 && !(polyOk && meanDev(poly, true) < ellipse.error * 0.25)) {
      const e = ellipse.shape;
      // Nearly round: a circle.
      if (Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry) > 0.88) e.rx = e.ry = (e.rx + e.ry) / 2;
      return e;
    }
    if (polyOk) return { kind: 'polygon', points: poly, closed: true };
    return null;
  }
  // Open: a few straight pieces.
  if (corners.length >= 3 && corners.length <= 5 && meanDev(corners, false) < 0.02) {
    return { kind: 'polygon', points: corners, closed: false };
  }
  return null;
}

/** Points along the shape, about `step` apart, all at one pressure. */
export function shapePoints(s: QuickShape, pressure: number, step = 2): Point[] {
  const out: Point[] = [];
  const seg = (a: Vec, b: Vec, last: boolean) => {
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let i = 0; i < n + (last ? 1 : 0); i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, pressure]);
  };
  if (s.kind === 'line') seg(s.a, s.b, true);
  else if (s.kind === 'polygon') {
    const p = s.closed ? [...s.points, s.points[0]] : s.points;
    for (let i = 1; i < p.length; i++) seg(p[i - 1], p[i], i === p.length - 1);
  } else {
    const perimeter = Math.PI * (3 * (s.rx + s.ry) - Math.sqrt((3 * s.rx + s.ry) * (s.rx + 3 * s.ry)));
    const n = Math.max(12, Math.ceil(perimeter / step));
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const u = Math.cos(t) * s.rx, v = Math.sin(t) * s.ry;
      out.push([s.cx + u * c - v * sn, s.cy + u * sn + v * c, pressure]);
    }
  }
  return out;
}

/**
 * Keep shaping while the pen stays down: a line's or open shape's last point
 * follows the pen; a closed shape turns and grows about its centre.
 */
export function adjustShape(s: QuickShape, from: Vec, to: Vec): QuickShape {
  if (s.kind === 'line') return { ...s, b: to };
  if (s.kind === 'polygon' && !s.closed) return { ...s, points: [...s.points.slice(0, -1), to] };
  const centre: Vec = s.kind === 'ellipse' ? [s.cx, s.cy] : centroid(s.points);
  const d0 = dist(centre, from), d1 = dist(centre, to);
  if (d0 < 1) return s;
  const k = d1 / d0;
  const turn = Math.atan2(to[1] - centre[1], to[0] - centre[0]) - Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  if (s.kind === 'ellipse') return { ...s, rx: s.rx * k, ry: s.ry * k, angle: s.angle + turn };
  const c = Math.cos(turn), sn = Math.sin(turn);
  return {
    ...s,
    points: s.points.map(([x, y]) => {
      const dx = (x - centre[0]) * k, dy = (y - centre[1]) * k;
      return [centre[0] + dx * c - dy * sn, centre[1] + dx * sn + dy * c] as Vec;
    }),
  };
}

function centroid(pts: Vec[]): Vec {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

export const SHAPE_NAMES: Record<QuickShape['kind'], string> = { line: 'Line', ellipse: 'Ellipse', polygon: 'Shape' };
