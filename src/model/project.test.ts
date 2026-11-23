import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addStroke,
  celIndexAt,
  celStart,
  createProject,
  deleteCelAt,
  drawingAt,
  duplicateCelAt,
  holdToEnd,
  insertDrawingAfter,
  isProject,
  layerLength,
  moveLayer,
  removeLayer,
  sceneLength,
  setHoldAt,
  type Layer,
  type Stroke,
} from './project';

const stroke: Stroke = { points: [[0, 0, 0.5], [10, 10, 0.5]], color: '#000', size: 6, erase: false, smoothing: 0.5, simulatePressure: true, thinning: 0.6 };
const layer = (holds: number[]): Layer => ({
  id: 'l', name: 'L', visible: true, locked: false, opacity: 1,
  cels: holds.map((hold, i) => ({ drawingId: `d${i}`, hold })),
});

describe('exposure sheet', () => {
  it('finds the cel shown at each frame', () => {
    const l = layer([2, 1, 3]);
    expect([0, 1, 2, 3, 4, 5, 6].map((f) => celIndexAt(l, f))).toEqual([0, 0, 1, 2, 2, 2, -1]);
    expect(celStart(l, 2)).toBe(3);
    expect(layerLength(l)).toBe(6);
  });

  it('scene length is the longest layer', () => {
    const p = createProject();
    expect(sceneLength(p)).toBe(2);
    const p2 = setHoldAt(p, p.layers[0].id, 0, 10);
    expect(sceneLength(p2)).toBe(10);
  });
});

describe('drawing', () => {
  it('adds strokes to the drawing held at a frame', () => {
    const p = createProject();
    const id = p.layers[1].id;
    const p2 = addStroke(p, id, 1, stroke);
    expect(drawingAt(p2, p2.layers[1], 0)?.strokes).toHaveLength(1);
    expect(p.drawings[p.layers[1].cels[0].drawingId!].strokes).toHaveLength(0);
  });

  it('drawing past the end fills the gap with a blank cel', () => {
    const p = createProject();
    const id = p.layers[1].id;
    const p2 = addStroke(p, id, 5, stroke);
    const l = p2.layers[1];
    expect(l.cels.map((c) => c.hold)).toEqual([2, 3, 2]);
    expect(l.cels[1].drawingId).toBeNull();
    expect(drawingAt(p2, l, 5)?.strokes).toHaveLength(1);
  });
});

describe('cel editing', () => {
  it('inserts a new drawing after the current one with the same hold', () => {
    const p = createProject();
    const id = p.layers[1].id;
    const { project, frame } = insertDrawingAfter(p, id, 0);
    expect(frame).toBe(2);
    expect(project.layers[1].cels).toHaveLength(2);
    expect(drawingAt(project, project.layers[1], 2)?.strokes).toEqual([]);
  });

  it('duplicates a drawing as an independent copy', () => {
    const id = createProject().layers[1].id;
    const p = addStroke(createProjectWith(id), id, 0, stroke);
    const { project, frame } = duplicateCelAt(p, id, 0);
    const a = drawingAt(project, project.layers[1], 0)!;
    const b = drawingAt(project, project.layers[1], frame)!;
    expect(b.id).not.toBe(a.id);
    expect(b.strokes).toHaveLength(1);
  });

  it('sets holds within bounds and deletes cels', () => {
    const p = createProject();
    const id = p.layers[1].id;
    expect(setHoldAt(p, id, 0, 0).layers[1].cels[0].hold).toBe(1);
    expect(setHoldAt(p, id, 0, 3).layers[1].cels[0].hold).toBe(3);
    const after = deleteCelAt(p, id, 0);
    expect(after.layers[1].cels).toHaveLength(0);
    expect(Object.keys(after.drawings)).toHaveLength(1);
  });

  it('holds a background to the end of the scene', () => {
    let p = createProject();
    const [bg, fg] = p.layers.map((l) => l.id);
    p = setHoldAt(p, fg, 0, 24);
    p = holdToEnd(p, bg, 0);
    expect(p.layers[0].cels[0].hold).toBe(24);
  });

  it('stretches the last cel when holding to the end from past it', () => {
    let p = createProject();
    const [bg, fg] = p.layers.map((l) => l.id);
    p = setHoldAt(p, fg, 0, 12);
    p = holdToEnd(p, bg, 8);
    expect(p.layers[0].cels[0].hold).toBe(12);
  });
});

describe('layers', () => {
  it('adds, moves and removes layers', () => {
    let p = createProject();
    const { project, layerId } = addLayer(p, 'Ball', p.layers[0].id);
    p = project;
    expect(p.layers.map((l) => l.name)).toEqual(['Background', 'Ball', 'Layer 1']);
    p = moveLayer(p, layerId, 1);
    expect(p.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Ball']);
    p = removeLayer(p, layerId);
    expect(p.layers).toHaveLength(2);
  });

  it('never removes the last layer', () => {
    let p = createProject();
    p = removeLayer(p, p.layers[0].id);
    p = removeLayer(p, p.layers[0].id);
    expect(p.layers).toHaveLength(1);
  });
});

it('validates loaded projects', () => {
  expect(isProject(createProject())).toBe(true);
  expect(isProject({ version: 2 })).toBe(false);
  expect(isProject(null)).toBe(false);
});

function createProjectWith(layerId: string) {
  const p = createProject();
  p.layers[1] = { ...p.layers[1], id: layerId };
  return p;
}
