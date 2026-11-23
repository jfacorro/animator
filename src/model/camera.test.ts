import { describe, expect, it } from 'vitest';
import { apply } from './geometry';
import { cameraAt, cameraCorners, cameraMatrix, keyAt, removeCameraKey, restingCamera, setCameraKey } from './camera';
import { createProject } from './project';

describe('camera', () => {
  const p0 = createProject(); // 1280 × 720

  it('rests on the whole canvas without keys', () => {
    expect(cameraAt(p0, 5)).toEqual(restingCamera(p0));
    const m = cameraMatrix(restingCamera(p0), 1280, 720);
    expect(apply(m, 100, 50)).toEqual([100, 50]);
  });

  it('eases between keys and holds outside them', () => {
    let p = setCameraKey(p0, 10, { x: 640, y: 360, zoom: 1, rotation: 0 });
    p = setCameraKey(p, 0, { x: 440, y: 360, zoom: 2, rotation: 10 });
    expect(p.camera!.map((k) => k.frame)).toEqual([0, 10]);
    const mid = cameraAt(p, 5);
    expect(mid.x).toBeCloseTo(540);
    expect(mid.zoom).toBeCloseTo(Math.SQRT2);
    expect(mid.rotation).toBeCloseTo(5);
    expect(cameraAt(p, 1).x).toBeLessThan(450); // eased: starts slowly
    expect(cameraAt(p, 20).x).toBe(640);
    expect(cameraAt(p, -1).x).toBe(440);
    expect(keyAt(p, 10)?.frame).toBe(10);
    p = removeCameraKey(removeCameraKey(p, 0), 10);
    expect(p.camera).toBeUndefined();
  });

  it('puts the camera centre in the middle of the picture', () => {
    const view = { x: 300, y: 200, zoom: 2, rotation: 30 };
    const m = cameraMatrix(view, 1280, 720);
    const [cx, cy] = apply(m, 300, 200);
    expect(cx).toBeCloseTo(640);
    expect(cy).toBeCloseTo(360);
    // The view's corners land on the picture's corners.
    const corners = cameraCorners(view, 1280, 720).map(([x, y]) => apply(m, x, y));
    [[0, 0], [1280, 0], [1280, 720], [0, 720]].forEach(([x, y], i) => {
      expect(corners[i][0]).toBeCloseTo(x);
      expect(corners[i][1]).toBeCloseTo(y);
    });
  });
});
