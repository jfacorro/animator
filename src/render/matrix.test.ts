import { describe, expect, it } from 'vitest';
import { mulMatrix } from './render';

describe('mulMatrix', () => {
  it('applies the right-hand matrix first', () => {
    const scale: [number, number, number, number, number, number] = [2, 0, 0, 2, 0, 0];
    const move: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 5];
    // Scale, then move: (1, 1) → (2, 2) → (12, 7).
    const m = mulMatrix(move, scale);
    expect([m[0] * 1 + m[2] * 1 + m[4], m[1] * 1 + m[3] * 1 + m[5]]).toEqual([12, 7]);
    // Move, then scale: (1, 1) → (11, 6) → (22, 12).
    const n = mulMatrix(scale, move);
    expect([n[0] + n[2] + n[4], n[1] + n[3] + n[5]]).toEqual([22, 12]);
  });
});
