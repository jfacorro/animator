import { describe, expect, it } from 'vitest';
import { floodFillSpans } from './fill';

// A 10×10 image with a closed 1px box from (2,2) to (7,7).
function boxImage(gap = false) {
  const w = 10, h = 10;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 2; i <= 7; i++) {
    for (const [x, y] of [[i, 2], [i, 7], [2, i], [7, i]]) {
      if (gap && x === 7 && y === 4) continue;
      rgba[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { rgba, w, h };
}
const area = (spans: number[]) => { let n = 0; for (let i = 0; i < spans.length; i += 3) n += spans[i + 2] - spans[i + 1] + 1; return n; };

describe('flood fill', () => {
  it('fills inside a closed shape only', () => {
    const { rgba, w, h } = boxImage();
    const spans = floodFillSpans(rgba, w, h, 4, 4, 96, 0)!;
    expect(area(spans)).toBe(16); // 4×4 interior
    expect(spans.slice(0, 3)).toEqual([3, 3, 6]);
  });

  it('grows the region under the lines', () => {
    const { rgba, w, h } = boxImage();
    expect(area(floodFillSpans(rgba, w, h, 4, 4, 96, 1)!)).toBe(16 + 16);
  });

  it('leaks out through a gap', () => {
    const { rgba, w, h } = boxImage(true);
    expect(area(floodFillSpans(rgba, w, h, 4, 4, 96, 0)!)).toBe(100 - 19);
  });

  it('does nothing when started on a line or outside', () => {
    const { rgba, w, h } = boxImage();
    expect(floodFillSpans(rgba, w, h, 2, 2)).toBeNull();
    expect(floodFillSpans(rgba, w, h, -1, 2)).toBeNull();
  });
});
