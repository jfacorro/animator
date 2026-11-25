import { describe, expect, it } from 'vitest';
import { harmony, hexToHsv, hsvToHex, remember } from './colour';

describe('colour', () => {
  it('converts hex to HSV and back', () => {
    for (const c of ['#ff0000', '#00ff00', '#0000ff', '#e5534b', '#1a1a1a', '#ffffff', '#7f3fbf']) expect(hsvToHex(hexToHsv(c))).toBe(c);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ffff').h).toBeCloseTo(180);
  });

  it('turns hues around the wheel for harmonies', () => {
    expect(harmony('#FF0000', 'complementary')).toEqual(['#ff0000', '#00ffff']);
    expect(harmony('#ff0000', 'triadic')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(harmony('#ff0000', 'tetradic')).toHaveLength(4);
    // Grey has no hue: its harmonies are the same grey.
    expect(new Set(harmony('#808080', 'triadic')).size).toBe(1);
  });

  it('keeps recent colours newest first, without repeats', () => {
    expect(remember(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
    expect(remember(['#111111'], '#AABBCC', 2)).toEqual(['#aabbcc', '#111111']);
    expect(remember(['#1', '#2'], '#3', 2)).toEqual(['#3', '#1']);
  });
});
