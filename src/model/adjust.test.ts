import { describe, expect, it } from 'vitest';
import { adjustHex, adjustPixels, adjustStrokes, recolourHex, recolourStrokes, strokeColours, NO_ADJUST } from './adjust';
import type { Stroke } from './project';

const line = (color: string, erase = false): Stroke => ({ points: [[0, 0, 0.5]], color, size: 4, erase, smoothing: 0, simulatePressure: false, thinning: 0 });

describe('adjustments', () => {
  it('turns hue, and pushes saturation and brightness', () => {
    expect(adjustHex('#ff0000', { ...NO_ADJUST, hue: 120 })).toBe('#00ff00');
    expect(adjustHex('#ff0000', { ...NO_ADJUST, saturation: -1 })).toBe('#ffffff');
    expect(adjustHex('#804020', { ...NO_ADJUST, brightness: -1 })).toBe('#000000');
    expect(adjustHex('#804020', NO_ADJUST)).toBe('#804020');
    // A see-through gradient end stays see-through.
    expect(adjustHex('#ff000000', { ...NO_ADJUST, hue: 120 })).toBe('#00ff0000');
  });

  it('adjusts strokes and gradients, but not erasers or unselected strokes', () => {
    const g: Stroke = { ...line('#ff0000'), kind: 'fill', gradient: { type: 'linear', from: [0, 0], to: [1, 1], colors: ['#ff0000', '#0000ff00'] } };
    const out = adjustStrokes([line('#ff0000'), line('#ff0000', true), g, line('#ff0000')], { ...NO_ADJUST, hue: 120 }, [0, 1, 2]);
    expect(out.map((s) => s.color)).toEqual(['#00ff00', '#ff0000', '#00ff00', '#ff0000']);
    expect(out[2].gradient!.colors).toEqual(['#00ff00', '#ff000000']);
  });

  it('adjusts pixels and skips see-through ones', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 0]);
    adjustPixels(px, { ...NO_ADJUST, hue: 240 });
    expect([...px]).toEqual([0, 0, 255, 255, 255, 0, 0, 0]);
  });

  it('recolours close colours and keeps their shading', () => {
    expect(recolourHex('#ff0000', '#ff0000', '#0000ff', 0.1)).toBe('#0000ff');
    expect(recolourHex('#f00a0a', '#ff0000', '#0000ff', 0.1)).toBe('#000aff');
    expect(recolourHex('#00ff00', '#ff0000', '#0000ff', 0.1)).toBe('#00ff00');
    expect(recolourStrokes([line('#ff0000'), line('#00ff00')], '#ff0000', '#123456', 0.2).map((s) => s.color)).toEqual(['#123456', '#00ff00']);
    expect(strokeColours([line('#00ff00'), line('#FF0000'), line('#ff0000'), line('#000000', true)])).toEqual(['#ff0000', '#00ff00']);
  });
});
