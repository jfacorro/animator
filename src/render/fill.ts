// Flood fill for the paint bucket. Pure (no DOM), so it's unit-tested.

/**
 * Fill the region around (sx, sy) bounded by pixels whose alpha is above
 * `threshold` in `rgba` (a drawing's own pixels). The region grows by
 * `grow` px so it tucks under the soft edges of the lines it stops at.
 * Returns spans as a flat list [y, x0, x1, ...] (x1 inclusive), or null if
 * the start point is on a line.
 */
export function floodFillSpans(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  threshold = 96,
  grow = 2,
): number[] | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const wall = (i: number) => rgba[i * 4 + 3] > threshold;
  if (wall(sy * w + sx)) return null;

  const mask = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    if (mask[i] || wall(i)) continue;
    // Walk left to the start of this run, then fill rightwards.
    while (x > 0 && !mask[i - 1] && !wall(i - 1)) { x--; i--; }
    let up = false, down = false;
    for (; x < w && !mask[i] && !wall(i); x++, i++) {
      mask[i] = 1;
      if (y > 0) {
        const open = !mask[i - w] && !wall(i - w);
        if (open && !up) stack.push(x, y - 1);
        up = open;
      }
      if (y < h - 1) {
        const open = !mask[i + w] && !wall(i + w);
        if (open && !down) stack.push(x, y + 1);
        down = open;
      }
    }
  }

  let filled: Uint8Array = mask;
  for (let g = 0; g < grow; g++) filled = dilate(filled, w, h);

  const spans: number[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    const row = y * w;
    while (x < w) {
      if (!filled[row + x]) { x++; continue; }
      const start = x;
      while (x < w && filled[row + x]) x++;
      spans.push(y, start, x - 1);
    }
  }
  return spans;
}

function dilate(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) out[i] = 1;
    }
  }
  return out;
}
