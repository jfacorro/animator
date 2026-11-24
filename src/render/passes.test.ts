import { describe, expect, it } from 'vitest';
import type { Stroke } from '../model/project';
import { drawingPasses } from './render';

const base: Stroke = { points: [[0, 0, 0.5]], color: '#000', size: 4, erase: false, smoothing: 0, simulatePressure: false, thinning: 0 };
const line = (color: string): Stroke => ({ ...base, color });
const fill = (color: string): Stroke => ({ ...base, kind: 'fill', spans: [0, 0, 1], color });
const erase = (color: string): Stroke => ({ ...base, erase: true, color });
const names = (s: Stroke[]) => s.map((x) => x.color);

describe('drawingPasses', () => {
  it('a fill made after erasing is not cut by that eraser', () => {
    const { fills, lines } = drawingPasses([line('a'), erase('e1'), fill('f')]);
    expect(names(fills)).toEqual(['f']);
    expect(names(lines)).toEqual(['a', 'e1']);
  });

  it('erasing after a fill still takes it away', () => {
    const { fills, lines } = drawingPasses([line('a'), fill('f'), erase('e1'), fill('g'), erase('e2')]);
    expect(names(fills)).toEqual(['f', 'e1', 'g', 'e2']);
    expect(names(lines)).toEqual(['a', 'e1', 'e2']);
  });

  it('drawings saved with fills first paint as before', () => {
    const { fills, lines } = drawingPasses([fill('f'), line('a'), erase('e1')]);
    expect(names(fills)).toEqual(['f', 'e1']);
    expect(names(lines)).toEqual(['a', 'e1']);
  });
});
