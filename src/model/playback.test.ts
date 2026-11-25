import { describe, expect, it } from 'vitest';
import { nextFrame, playOrder } from './playback';

describe('playback', () => {
  it('loops back to the start', () => {
    expect(nextFrame(3, 4, 'loop', 1)).toEqual({ frame: 0, dir: 1, stop: false });
  });

  it('ping-pongs at both ends', () => {
    let s = { frame: 0, dir: 1 as 1 | -1 };
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) { const n = nextFrame(s.frame, 4, 'pingpong', s.dir); s = n; seen.push(n.frame); }
    expect(seen).toEqual([1, 2, 3, 2, 1, 0, 1, 2]);
  });

  it('stops at the end when played once', () => {
    expect(nextFrame(3, 4, 'once', 1)).toEqual({ frame: 3, dir: 1, stop: true });
  });

  it('exports a ping-pong without repeating the turning frames', () => {
    expect(playOrder(4, 'pingpong')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playOrder(4, 'loop')).toEqual([0, 1, 2, 3]);
  });
});
