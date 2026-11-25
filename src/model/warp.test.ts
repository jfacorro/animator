import { describe, expect, it } from 'vitest';
import type { Stroke } from './project';
import { pushStrokes, startGrid, warpPoint, warpStrokes } from './warp';

const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
const line: Stroke = { points: [[0, 50, 0.5], [100, 50, 0.5]], color: '#000', size: 4, erase: false, smoothing: 0, simulatePressure: false, thinning: 0 };

describe('warp', () => {
  it('leaves points alone until a handle moves', () => {
    const [x, y] = warpPoint(startGrid(box), 30, 70);
    expect(x).toBeCloseTo(30);
    expect(y).toBeCloseTo(70);
  });

  it('moving the centre handle bends the middle most', () => {
    const g = startGrid(box);
    g.pts[4] = [50, 70];
    expect(warpPoint(g, 50, 50)[1]).toBeCloseTo(70);
    expect(warpPoint(g, 0, 50)[1]).toBeCloseTo(50);
    expect(warpPoint(g, 25, 50)[1]).toBeCloseTo(65);
  });

  it('bends strokes through the grid, turning shapes into outlines', () => {
    const g = startGrid(box);
    g.pts[4] = [50, 70];
    const rect: Stroke = { ...line, kind: 'rect', points: [[10, 10, 0.5], [90, 90, 0.5]] };
    const [l, r] = warpStrokes([line, rect], [0, 1], g);
    expect(l.points.length).toBeGreaterThan(2);
    expect(Math.max(...l.points.map((p) => p[1]))).toBeCloseTo(70);
    expect(r.kind).toBe('line');
    expect(r.points.length).toBeGreaterThan(4);
  });
});

describe('liquify', () => {
  it('pushes nearby points with the pointer, far ones stay', () => {
    const out = pushStrokes([line], [50, 50], [0, 10], 20)!;
    const ys = out[0].points.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(59);
    expect(out[0].points[0][1]).toBe(50);
  });

  it('does nothing out of reach', () => {
    expect(pushStrokes([line], [50, 0], [0, 10], 20)).toBeNull();
  });
});
