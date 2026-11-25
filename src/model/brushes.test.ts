import { describe, expect, it } from 'vitest';
import type { Point } from './project';
import { catchUp, matchingPreset, PRESETS, stabilize, validBrush } from './brushes';

describe('brushes', () => {
  it('recognises preset settings', () => {
    expect(matchingPreset(PRESETS[1])?.id).toBe('ink');
    expect(matchingPreset({ ...PRESETS[1], size: 9 })).toBeUndefined();
  });

  it('tells textured brushes apart by their grain, and finds saved brushes', () => {
    const chalk = PRESETS.find((p) => p.id === 'chalk')!;
    expect(matchingPreset(chalk)?.id).toBe('chalk');
    expect(matchingPreset({ ...chalk, grain: 'canvas' })).toBeUndefined();
    // No grain and a zero amount are the same brush.
    expect(matchingPreset({ ...PRESETS[1], grain: 'pencil', grainAmount: 0 })?.id).toBe('ink');
    const mine = validBrush({ id: 'b1', name: 'Mine', size: 9, opacity: 1, smoothing: 0.5, stabilizer: 0, thinning: 0, softness: 0, grain: 'chalk', grainAmount: 0.3 })!;
    expect(mine.custom).toBe(true);
    expect(matchingPreset({ ...mine }, [mine])?.name).toBe('Mine');
    expect(validBrush({ id: 'x', name: 'Bad', size: '9' })).toBeNull();
    expect(validBrush({ ...mine, grain: 'glitter' })?.grain).toBe('none');
  });

  it('stabilizer trails the pointer and smooths wobble', () => {
    expect(stabilize([0, 0, 0.5], [10, 0, 0.7], 0)).toEqual([10, 0, 0.7]);
    const half = stabilize([0, 0, 0.5], [10, 0, 0.5], 0.5);
    expect(half[0]).toBeGreaterThan(4);
    expect(half[0]).toBeLessThan(6);
    // A zig-zag pointer gives a much flatter line.
    let tip: Point = [0, 0, 0.5];
    let maxY = 0;
    for (let i = 1; i <= 40; i++) {
      tip = stabilize(tip, [i * 4, i % 2 ? 6 : -6, 0.5], 0.8);
      if (i > 10) maxY = Math.max(maxY, Math.abs(tip[1]));
    }
    expect(maxY).toBeLessThan(2);
  });

  it('catches up to where the pointer stopped', () => {
    const pts = catchUp([0, 0, 0.5], [9, 0, 0.5]);
    expect(pts).toHaveLength(3);
    expect(pts.at(-1)).toEqual([9, 0, 0.5]);
    expect(catchUp([1, 1, 0.5], [1, 1, 0.5])).toEqual([]);
  });
});
