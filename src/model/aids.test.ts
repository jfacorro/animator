import { describe, expect, it } from 'vitest';
import { addGuide, addReferenceLayer, fitImage, moveGuide, placeReference, referenceGotDrawings, removeGuide, rulerStep, snapToGuides, symmetricStrokes } from './aids';
import { addStroke, createProject, removeLayer, type Stroke } from './project';

const stroke = (kind: Stroke['kind'] = 'free'): Stroke => ({
  kind, points: [[10, 20, 0.5], [30, 40, 0.7]], color: '#000', size: 4, erase: false, smoothing: 0.5, simulatePressure: false, thinning: 0,
});

describe('symmetry', () => {
  it('mirrors across the canvas centre lines', () => {
    expect(symmetricStrokes(stroke(), 'off', 100, 60)).toHaveLength(1);
    const [, lr] = symmetricStrokes(stroke(), 'x', 100, 60);
    expect(lr.points).toEqual([[90, 20, 0.5], [70, 40, 0.7]]);
    const [, tb] = symmetricStrokes(stroke(), 'y', 100, 60);
    expect(tb.points).toEqual([[10, 40, 0.5], [30, 20, 0.7]]);
    const all = symmetricStrokes(stroke(), 'xy', 100, 60);
    expect(all).toHaveLength(4);
    expect(all[3].points[0]).toEqual([90, 40, 0.5]);
  });

  it('leaves paint-bucket fills alone', () => {
    expect(symmetricStrokes(stroke('fill'), 'xy', 100, 60)).toHaveLength(1);
  });
});

describe('guides', () => {
  it('adds, moves and removes guides', () => {
    let p = addGuide(createProject(), 'x', 100.04);
    p = addGuide(p, 'y', 50);
    expect(p.guides).toEqual({ x: [100], y: [50] });
    p = moveGuide(p, 'x', 0, 200);
    expect(p.guides!.x).toEqual([200]);
    p = removeGuide(removeGuide(p, 'x', 0), 'y', 0);
    expect(p.guides).toBeUndefined();
  });

  it('snaps points that are close to a guide', () => {
    const g = { x: [100, 110], y: [50] };
    expect(snapToGuides([104, 80], g, 5)).toEqual([100, 80]);
    expect(snapToGuides([107, 52], g, 5)).toEqual([110, 50]);
    expect(snapToGuides([120, 60], g, 5)).toEqual([120, 60]);
  });

  it('spaces ruler labels sensibly', () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(0.5)).toBe(200);
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(0.05)).toBe(2000);
  });
});

describe('reference images', () => {
  it('fits an image inside the canvas', () => {
    expect(fitImage(2000, 1000, 1280, 720)).toEqual({ x: 0, y: 40, width: 1280, height: 640 });
  });

  it('adds a see-through layer at the bottom that holds no drawings', () => {
    const base = createProject();
    const { project, layerId } = addReferenceLayer(base, 'Ref', { data: 'data:,', x: 0, y: 0, width: 10, height: 10 });
    expect(project.layers[0].id).toBe(layerId);
    expect(project.layers[0].opacity).toBe(0.5);
    expect(referenceGotDrawings(project)).toBe(false);
    expect(referenceGotDrawings(addStroke(project, layerId, 0, stroke()))).toBe(true);
    const moved = placeReference(project, layerId, { x: 5, y: 6, width: 20, height: 30 });
    expect(moved.layers[0].reference).toMatchObject({ x: 5, y: 6, width: 20, height: 30, data: 'data:,' });
  });

  it('keeps at least one layer to draw on', () => {
    let { project } = addReferenceLayer(createProject(), 'Ref', { data: 'data:,', x: 0, y: 0, width: 10, height: 10 });
    project = removeLayer(project, project.layers[1].id);
    project = removeLayer(project, project.layers[1].id);
    expect(project.layers).toHaveLength(2);
    expect(removeLayer(project, project.layers[0].id).layers).toHaveLength(1);
  });
});

describe('perspective', () => {
  it('snaps a line towards a vanishing point, upright or level', async () => {
    const { snapPerspective } = await import('./aids');
    const one = { on: true, points: [[100, 0] as [number, number]] };
    // Dragged roughly towards the point: lands exactly on the line to it.
    const [x, y] = snapPerspective([0, 100], [46, 50], one);
    expect(x + y).toBeCloseTo(100);
    expect(x).toBeCloseTo(48);
    expect(snapPerspective([0, 100], [3, 40], one)).toEqual([0, 40]);
    expect(snapPerspective([0, 100], [60, 97], one)).toEqual([60, 100]);
    // Two points: no level lines, only towards either point or upright.
    const two = { on: true, points: [[-100, 0], [200, 0]] as [number, number][] };
    const [ex, ey] = snapPerspective([50, 100], [120, 60], two);
    expect((ey - 100) / (ex - 50)).toBeCloseTo(-100 / 150);
    expect(snapPerspective([50, 100], [52, 160], two)).toEqual([50, 160]);
  });
});
