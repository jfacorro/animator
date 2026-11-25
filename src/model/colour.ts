// Colour maths for the colour disc: hex ↔ HSV, and colour harmonies.

/** Hue 0–360, saturation and value 0–1. */
export interface Hsv { h: number; s: number; v: number }

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s, x = c * (1 - Math.abs((hh % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export type Harmony = 'complementary' | 'split' | 'analogous' | 'triadic' | 'tetradic';
export const HARMONIES: { id: Harmony; name: string }[] = [
  { id: 'complementary', name: 'Complementary' },
  { id: 'split', name: 'Split complementary' },
  { id: 'analogous', name: 'Analogous' },
  { id: 'triadic', name: 'Triadic' },
  { id: 'tetradic', name: 'Tetradic' },
];
const TURNS: Record<Harmony, number[]> = {
  complementary: [0, 180],
  split: [0, 150, 210],
  analogous: [0, -30, 30],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

/** The colour and the ones that go with it, turned around the colour wheel. */
export function harmony(hex: string, kind: Harmony): string[] {
  const c = hexToHsv(hex);
  return TURNS[kind].map((t) => (t === 0 ? hex.toLowerCase() : hsvToHex({ ...c, h: c.h + t })));
}

/** Put a colour first in the recent list, without repeats. */
export function remember(recent: string[], hex: string, max = 12): string[] {
  const c = hex.toLowerCase();
  return [c, ...recent.filter((x) => x !== c)].slice(0, max);
}
