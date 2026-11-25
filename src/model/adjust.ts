// Colour adjustments (hue, saturation, brightness) and Recolour, for lines and paint.
import { hexToHsv, hsvToHex, hexToRgb } from './colour';
import type { Stroke } from './project';

/** Hue turn in degrees (−180–180); saturation and brightness −1–1, 0 leaves them as they are. */
export interface Adjust { hue: number; saturation: number; brightness: number }
export const NO_ADJUST: Adjust = { hue: 0, saturation: 0, brightness: 0 };

const push = (x: number, by: number) => (by >= 0 ? x + (1 - x) * by : x * (1 + by));

/** One colour, adjusted. Keeps a '#rrggbbaa' see-through suffix. */
export function adjustHex(hex: string, a: Adjust): string {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return hex;
  const c = hexToHsv(hex.slice(0, 7));
  const out = hsvToHex({ h: c.h + a.hue, s: push(c.s, a.saturation), v: push(c.v, a.brightness) });
  return out + hex.slice(7);
}

function mapColours(s: Stroke, fn: (hex: string) => string): Stroke {
  if (s.erase) return s;
  const next: Stroke = { ...s, color: fn(s.color) };
  if (s.gradient) next.gradient = { ...s.gradient, colors: [fn(s.gradient.colors[0]), fn(s.gradient.colors[1])] };
  return next;
}

/** Adjust the strokes (only those at `only`, when given). */
export function adjustStrokes(strokes: Stroke[], a: Adjust, only?: number[] | null): Stroke[] {
  return strokes.map((s, i) => (only && !only.includes(i) ? s : mapColours(s, (h) => adjustHex(h, a))));
}

/** Adjust RGBA pixels in place. Colours repeat a lot, so each is worked out once. */
export function adjustPixels(px: Uint8ClampedArray, a: Adjust) {
  const cache = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      const hex = adjustHex('#' + key.toString(16).padStart(6, '0'), a);
      out = parseInt(hex.slice(1, 7), 16);
      cache.set(key, out);
    }
    px[i] = (out >> 16) & 255; px[i + 1] = (out >> 8) & 255; px[i + 2] = out & 255;
  }
}

/** 0 for the same colour, 1 for black against white. */
export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 441.673;
}

/**
 * Recolour: what's close to `from` (within `tolerance`, 0–1) becomes `to`.
 * Shades of it keep their difference, so shading and anti-aliasing survive.
 */
export function recolourHex(hex: string, from: string, to: string, tolerance: number): string {
  if (!/^#[0-9a-f]{6}/i.test(hex) || colourDistance(hex.slice(0, 7), from) > tolerance) return hex;
  const [r, g, b] = hexToRgb(hex), [fr, fg, fb] = hexToRgb(from), [tr, tg, tb] = hexToRgb(to);
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${c(tr + r - fr)}${c(tg + g - fg)}${c(tb + b - fb)}` + hex.slice(7);
}

export function recolourStrokes(strokes: Stroke[], from: string, to: string, tolerance: number, only?: number[] | null): Stroke[] {
  return strokes.map((s, i) => (only && !only.includes(i) ? s : mapColours(s, (h) => recolourHex(h, from, to, tolerance))));
}

export function recolourPixels(px: Uint8ClampedArray, from: string, to: string, tolerance: number) {
  const cache = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      out = parseInt(recolourHex('#' + key.toString(16).padStart(6, '0'), from, to, tolerance).slice(1, 7), 16);
      cache.set(key, out);
    }
    px[i] = (out >> 16) & 255; px[i + 1] = (out >> 8) & 255; px[i + 2] = out & 255;
  }
}

/** The colours a drawing's strokes use, most used first. */
export function strokeColours(strokes: Stroke[]): string[] {
  const n = new Map<string, number>();
  for (const s of strokes) if (!s.erase && /^#[0-9a-f]{6}$/i.test(s.color)) n.set(s.color.toLowerCase(), (n.get(s.color.toLowerCase()) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** The main colours in some pixels, most common first (near-identical shades count as one, shown by their most common shade). */
export function pixelColours(px: Uint8ClampedArray, max = 8): string[] {
  const buckets = new Map<number, Map<number, number>>();
  for (let i = 0; i < px.length; i += 16) {
    if (px[i + 3] < 200) continue;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const exact = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = new Map()));
    b.set(exact, (b.get(exact) ?? 0) + 1);
  }
  const total = (b: Map<number, number>) => [...b.values()].reduce((a, n) => a + n, 0);
  const top = (b: Map<number, number>) => [...b.entries()].sort((x, y) => y[1] - x[1])[0][0];
  return [...buckets.values()].sort((a, b) => total(b) - total(a)).slice(0, max).map((b) => '#' + top(b).toString(16).padStart(6, '0'));
}
