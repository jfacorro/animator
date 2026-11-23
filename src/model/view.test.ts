import { describe, expect, it } from 'vitest';
import type { Vec } from './geometry';
import { FIT_VIEW, flipAt, localToScreen, pinch, rotateAt, screenToLocal, snapRotation, zoomAt, type View } from './view';

const close = (a: Vec, b: Vec) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('canvas view', () => {
  const views: View[] = [
    FIT_VIEW,
    { zoom: 2.5, x: 40, y: -12, rotation: 30, flip: false },
    { zoom: 0.5, x: -7, y: 90, rotation: -135, flip: true },
  ];

  it('maps screen points to the canvas and back', () => {
    for (const v of views) {
      const s: Vec = [123, -45];
      close(localToScreen(v, screenToLocal(v, s)), s);
    }
    close(screenToLocal({ ...FIT_VIEW, zoom: 2, x: 10 }, [30, 20]), [10, 10]);
    close(screenToLocal({ ...FIT_VIEW, flip: true }, [30, 20]), [-30, 20]);
    close(screenToLocal({ ...FIT_VIEW, rotation: 90 }, [0, 10]), [10, 0]);
  });

  it('zooms and rotates around a point that stays still', () => {
    for (const v of views) {
      const at: Vec = [60, 25];
      const local = screenToLocal(v, at);
      close(localToScreen(zoomAt(v, 1.7, at), local), at);
      close(localToScreen(rotateAt(v, 15, at), local), at);
      close(localToScreen(flipAt(v, at), local), at); // on the mirror line
    }
    expect(zoomAt(FIT_VIEW, 1000).zoom).toBe(32);
    expect(rotateAt({ ...FIT_VIEW, rotation: 170 }, 20).rotation).toBe(-170);
  });

  it('follows two fingers in a pinch', () => {
    for (const v of views) {
      const a0: Vec = [-50, 0], b0: Vec = [50, 0];
      const a1: Vec = [10, 10], b1: Vec = [10, 210]; // moved, rotated 90° and doubled
      const next = pinch(v, a0, b0, a1, b1);
      close(localToScreen(next, screenToLocal(v, a0)), a1);
      close(localToScreen(next, screenToLocal(v, b0)), b1);
    }
  });

  it('snaps nearly straight rotations', () => {
    expect(snapRotation({ ...FIT_VIEW, rotation: 3 }).rotation).toBe(0);
    expect(snapRotation({ ...FIT_VIEW, rotation: 87 }).rotation).toBe(90);
    expect(snapRotation({ ...FIT_VIEW, rotation: 30 }).rotation).toBe(30);
  });
});
