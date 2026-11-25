import { describe, expect, it } from 'vitest';
import { adjustShape, recognize, shapePoints } from './quickshape';

type V = [number, number];
const wobble = (i: number) => Math.sin(i * 1.7) * 1.5;

describe('recognize', () => {
  it('a wobbly straight stroke is a line', () => {
    const pts: V[] = Array.from({ length: 50 }, (_, i) => [i * 4, 100 + wobble(i)]);
    const s = recognize(pts);
    expect(s?.kind).toBe('line');
  });

  it('a rough loop is a circle', () => {
    const pts: V[] = Array.from({ length: 80 }, (_, i) => {
      const t = (i / 79) * Math.PI * 2;
      const r = 100 + wobble(i) * 2;
      return [200 + Math.cos(t) * r, 200 + Math.sin(t) * r];
    });
    const s = recognize(pts);
    expect(s?.kind).toBe('ellipse');
    if (s?.kind === 'ellipse') {
      expect(s.rx).toBeCloseTo(s.ry);
      expect(Math.abs(s.cx - 200)).toBeLessThan(5);
    }
  });

  it('a flat loop is an ellipse, not a circle', () => {
    const pts: V[] = Array.from({ length: 80 }, (_, i) => {
      const t = (i / 79) * Math.PI * 2;
      return [200 + Math.cos(t) * 150, 200 + Math.sin(t) * 60];
    });
    const s = recognize(pts);
    expect(s?.kind).toBe('ellipse');
    if (s?.kind === 'ellipse') expect(Math.max(s.rx, s.ry) / Math.min(s.rx, s.ry)).toBeGreaterThan(2);
  });

  it('a rough box is a closed four-sided shape', () => {
    const corners: V[] = [[0, 0], [200, 0], [200, 120], [0, 120], [0, 0]];
    const pts: V[] = [];
    for (let k = 1; k < corners.length; k++) {
      for (let i = 0; i < 20; i++) {
        const t = i / 20;
        pts.push([corners[k - 1][0] + (corners[k][0] - corners[k - 1][0]) * t + wobble(i), corners[k - 1][1] + (corners[k][1] - corners[k - 1][1]) * t + wobble(i + 3)]);
      }
    }
    const s = recognize(pts);
    expect(s).toMatchObject({ kind: 'polygon', closed: true });
    if (s?.kind === 'polygon') expect(s.points.length).toBe(4);
  });

  it('a scribble stays as drawn', () => {
    const pts: V[] = Array.from({ length: 80 }, (_, i) => [i * 3, 100 + Math.sin(i * 0.3) * 40 + (i % 7) * 5]);
    expect(recognize(pts)).toBeNull();
  });
});

describe('shapes', () => {
  it('points run along the shape at one pressure', () => {
    const pts = shapePoints({ kind: 'line', a: [0, 0], b: [10, 0] }, 0.4, 2);
    expect(pts[0]).toEqual([0, 0, 0.4]);
    expect(pts.at(-1)).toEqual([10, 0, 0.4]);
  });

  it('holding on, a line end follows the pen and a circle grows', () => {
    expect(adjustShape({ kind: 'line', a: [0, 0], b: [10, 0] }, [10, 0], [20, 5])).toEqual({ kind: 'line', a: [0, 0], b: [20, 5] });
    const c = adjustShape({ kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10, angle: 0 }, [10, 0], [20, 0]);
    expect(c).toMatchObject({ rx: 20, ry: 20 });
  });
});

describe('hand-drawn strokes', () => {
  const noise = (i: number, a: number) => (Math.sin(i * 2.3) + Math.sin(i * 0.7)) * a;
  const loop = (over: number): V[] => Array.from({ length: 61 }, (_, i) => {
    const t = (i / 60) * Math.PI * 2 * (1 + over);
    return [300 + Math.cos(t) * (100 + noise(i, 3)), 300 + Math.sin(t) * (90 + noise(i + 5, 3))];
  });

  it('a loop that stops short or overshoots is still an ellipse', () => {
    for (const over of [-0.15, 0.25]) expect(recognize(loop(over))?.kind).toBe('ellipse');
  });

  it('jitter from holding the pen still at the end is ignored', () => {
    const pts: V[] = [];
    for (let i = 0; i <= 40; i++) pts.push([100 + i * 5, 100 + noise(i, 1)]);
    for (let i = 0; i < 30; i++) pts.push([300 + noise(i, 0.5), 100 + noise(i + 1, 0.5)]);
    expect(recognize(pts)?.kind).toBe('line');
  });

  it('a slightly bowed line is still a line', () => {
    const pts: V[] = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40;
      return [100 + t * 300, 100 + t * 150 + Math.sin(t * Math.PI) * 0.08 * 335];
    });
    expect(recognize(pts)?.kind).toBe('line');
  });
});
