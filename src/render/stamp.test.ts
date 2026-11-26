import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/project';
import { strokeDabs } from './stamp';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  points: [[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]], color: '#000', size: 10, erase: false,
  smoothing: 0, simulatePressure: false, thinning: 0, grain: { kind: 'pencil', amount: 0.5 }, ...over,
});

describe('strokeDabs', () => {
  it('spaces dabs evenly along the line, a small part of their size apart', () => {
    const dabs = strokeDabs(stroke());
    // Pencil spacing is 6% of a 10 px dab: about 0.6 px over 100 px.
    expect(dabs.length).toBeGreaterThan(120);
    expect(dabs.length).toBeLessThan(200);
    expect(Math.min(...dabs.map((d) => d.x))).toBeLessThan(2);
    expect(Math.max(...dabs.map((d) => d.x))).toBeGreaterThan(98);
  });

  it('draws the same dabs every time', () => {
    expect(strokeDabs(stroke())).toEqual(strokeDabs(stroke()));
  });

  it('makes dabs smaller and lighter where the pen presses less', () => {
    const light = strokeDabs(stroke({ thinning: 0.8, points: [[0, 0, 0.1], [100, 0, 0.1]] }));
    const heavy = strokeDabs(stroke({ thinning: 0.8, points: [[0, 0, 0.9], [100, 0, 0.9]] }));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(light.map((d) => d.r))).toBeLessThan(avg(heavy.map((d) => d.r)));
    expect(avg(light.map((d) => d.flow))).toBeLessThan(avg(heavy.map((d) => d.flow)));
  });

  it('follows a moved stroke', () => {
    const dabs = strokeDabs(stroke({ matrix: [2, 0, 0, 2, 1000, 0] }));
    expect(Math.min(...dabs.map((d) => d.x))).toBeGreaterThan(995);
    expect(dabs[0].r).toBeGreaterThan(8);
  });

  it('gives a single tap a dot of a few dabs in one place', () => {
    const dabs = strokeDabs(stroke({ points: [[5, 5, 0.5]] }));
    expect(dabs.length).toBeGreaterThan(0);
    expect(dabs.length).toBeLessThan(5);
    for (const d of dabs) expect(Math.hypot(d.x - 5, d.y - 5)).toBeLessThan(3);
  });
});

describe('dab spacing on densely sampled lines', () => {
  it('keeps dabs evenly spaced when the points are closer together than the spacing', async () => {
    const { strokeDabs } = await import('./stamp');
    // A straight line sampled every 0.5 px, like a shape the line tool snapped to.
    const points = Array.from({ length: 401 }, (_, i) => [i * 0.5, 0, 0.5] as [number, number, number]);
    const dabs = strokeDabs({ kind: 'free', points, color: '#000', size: 20, erase: false, smoothing: 0, simulatePressure: false, thinning: 0, grain: { kind: 'chalk', amount: 0.7 } } as never);
    let maxGap = 0;
    for (let i = 1; i < dabs.length; i++) maxGap = Math.max(maxGap, Math.hypot(dabs[i].x - dabs[i - 1].x, dabs[i].y - dabs[i - 1].y));
    expect(dabs.length).toBeGreaterThan(50);
    expect(maxGap).toBeLessThan(10);
  });
});
