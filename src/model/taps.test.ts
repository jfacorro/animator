import { describe, expect, it } from 'vitest';
import { tapDown, tapMove, tapUp, type Taps } from './taps';

/** Fingers go down one after another, then lift; returns the tap count. */
function run(fingers: number, opts: { move?: number; ms?: number } = {}) {
  let t: Taps | null = null;
  for (let i = 0; i < fingers; i++) t = tapDown(t, i, i, [i * 50, 0], i * 10);
  if (opts.move) tapMove(t, 0, [opts.move, 0]);
  let result = 0;
  for (let left = fingers - 1; left >= 0; left--) result = tapUp(t, left, opts.ms ?? 120);
  return result;
}

describe('finger taps', () => {
  it('counts two- and three-finger taps', () => {
    expect(run(2)).toBe(2);
    expect(run(3)).toBe(3);
  });
  it('a pinch or slow press is not a tap', () => {
    expect(run(2, { move: 40 })).toBe(0);
    expect(run(2, { ms: 900 })).toBe(0);
  });
  it('only reports once the last finger lifts', () => {
    let t = tapDown(null, 0, 1, [0, 0], 0);
    t = tapDown(t, 1, 2, [10, 0], 5);
    expect(tapUp(t, 1, 50)).toBe(0);
    expect(tapUp(t, 0, 60)).toBe(2);
  });
  it('a new touch after all fingers lifted starts a new tap', () => {
    const t = tapDown(null, 0, 1, [0, 0], 0);
    t.spoiled = true;
    const next = tapDown(t, 0, 2, [0, 0], 1000);
    expect(next.spoiled).toBe(false);
  });
});
