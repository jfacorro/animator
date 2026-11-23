import { describe, expect, it } from 'vitest';
import { apply, multiply, scaleAbout, strokeBounds, strokesInLasso, translate, type Vec } from './geometry';
import type { Stroke } from './project';

const base = { color: '#000', size: 4, erase: false, smoothing: 0, simulatePressure: false, thinning: 0 };
const free = (pts: number[][]): Stroke => ({ ...base, points: pts.map(([x, y]) => [x, y, 0.5]) });
const rect = (x0: number, y0: number, x1: number, y1: number): Stroke => ({ ...base, kind: 'rect', points: [[x0, y0, 0.5], [x1, y1, 0.5]] });

describe('matrices', () => {
  it('composes translate and scale', () => {
    const m = multiply(translate(10, 0), scaleAbout(2, 2, 0, 0));
    expect(apply(m, 1, 1)).toEqual([12, 2]);
    expect(apply(scaleAbout(2, 2, 5, 5), 6, 5)).toEqual([7, 5]);
  });
});

describe('selection', () => {
  const lasso: Vec[] = [[0, 0], [50, 0], [50, 50], [0, 50]];

  it('selects strokes mostly inside the lasso', () => {
    const strokes = [free([[10, 10], [20, 20], [30, 30]]), free([[40, 40], [60, 60], [80, 80]]), rect(5, 5, 45, 45)];
    expect(strokesInLasso(strokes, lasso)).toEqual([0, 2]);
  });

  it('uses moved positions', () => {
    const moved = { ...rect(5, 5, 20, 20), matrix: translate(100, 0) };
    expect(strokesInLasso([moved], lasso)).toEqual([]);
    expect(strokeBounds(moved)).toEqual({ x0: 103, y0: 3, x1: 122, y1: 22 });
  });
});
