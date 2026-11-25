import { describe, expect, it } from 'vitest';
import {
  addLayer,
  isBlank,
  setPaint,
  addStroke,
  deleteStrokes,
  duplicateStrokes,
  transformStrokes,
  clearCelAt,
  dropIndex,
  insertDrawing,
  moveCel,
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
  moveLayerToGap,
  pasteStrokes,
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

describe('frame menu and dragging', () => {
  const ids = (p: ReturnType<typeof createProject>) => p.layers[1].cels.map((c) => c.drawingId);

  it('inserts a drawing before or after a cel', () => {
    const p = createProject();
    const id = p.layers[1].id;
    const original = p.layers[1].cels[0].drawingId;
    const before = insertDrawing(p, id, 1, 'before');
    expect(before.frame).toBe(0);
    expect(ids(before.project)[1]).toBe(original);
    const after = insertDrawing(p, id, 1, 'after');
    expect(after.frame).toBe(2);
    expect(ids(after.project)[0]).toBe(original);
  });

  it('clears a drawing but keeps its cel and hold', () => {
    const p0 = createProject();
    const id = p0.layers[1].id;
    const p = clearCelAt(setHoldAt(addStroke(p0, id, 0, stroke), id, 0, 3), id, 0);
    expect(p.layers[1].cels).toEqual([{ drawingId: p0.layers[1].cels[0].drawingId, hold: 3 }]);
    expect(drawingAt(p, p.layers[1], 0)?.strokes).toEqual([]);
  });

  it('moves a cel to a new position', () => {
    const l = layer([2, 1, 3]);
    const p = { ...createProject(), layers: [l] };
    const r = moveCel(p, 'l', 0, 2);
    expect(r.project.layers[0].cels.map((c) => c.drawingId)).toEqual(['d1', 'd2', 'd0']);
    expect(r.frame).toBe(4);
    expect(moveCel(p, 'l', 2, 0).project.layers[0].cels.map((c) => c.drawingId)).toEqual(['d2', 'd0', 'd1']);
  });

  it('works out where a dragged cel lands', () => {
    const l = layer([2, 2, 2]); // frames 0-1, 2-3, 4-5
    expect(dropIndex(l, 0, 3, 0.5)).toBe(1); // second half of cel 1: after it
    expect(dropIndex(l, 0, 2, 0.2)).toBe(0); // first half of cel 1: before it = where it was
    expect(dropIndex(l, 2, 0, 0.1)).toBe(0); // to the front
    expect(dropIndex(l, 0, 9, 0.5)).toBe(2); // past the end: last
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

describe('stroke editing', () => {
  const s = (kind: Stroke['kind'], color = '#000'): Stroke => ({ ...stroke, kind, color });

  it('keeps strokes in the order they were made, fills too', () => {
    let p = createProject();
    const id = p.layers[1].id;
    p = addStroke(p, id, 0, s('free'));
    p = addStroke(p, id, 0, s('fill', 'red'));
    p = addStroke(p, id, 0, s('fill', 'blue'));
    expect(drawingAt(p, p.layers[1], 0)!.strokes.map((x) => x.color)).toEqual(['#000', 'red', 'blue']);
  });

  it('moves, duplicates and deletes selected strokes', () => {
    let p = createProject();
    const id = p.layers[1].id;
    p = addStroke(addStroke(p, id, 0, s('free')), id, 0, s('line'));
    p = transformStrokes(p, id, 0, [1], [1, 0, 0, 1, 5, 0]);
    p = transformStrokes(p, id, 0, [1], [1, 0, 0, 1, 5, 0]);
    const d = () => drawingAt(p, p.layers[1], 0)!;
    expect(d().strokes[1].matrix).toEqual([1, 0, 0, 1, 10, 0]);
    expect(d().strokes[0].matrix).toBeUndefined();
    const dup = duplicateStrokes(p, id, 0, [1]);
    expect(dup.indices).toEqual([2]);
    p = deleteStrokes(dup.project, id, 0, [0]);
    expect(d().strokes.map((x) => x.kind)).toEqual(['line', 'line']);
  });
});

describe('copy and paste', () => {
  it('pastes strokes on top of a drawing, or into an empty frame', () => {
    let p = createProject();
    const id = p.layers[1].id;
    p = addStroke(p, id, 0, stroke);
    const copied = drawingAt(p, p.layers[1], 0)!.strokes;
    const into = pasteStrokes(p, id, 0, copied);
    expect(into.indices).toEqual([1]);
    expect(drawingAt(into.project, into.project.layers[1], 0)!.strokes).toHaveLength(2);
    const empty = pasteStrokes(p, id, 4, copied);
    expect(empty.indices).toEqual([0]);
    expect(empty.project.layers[1].cels.map((c) => c.hold)).toEqual([2, 2, 2]);
    // Pasted strokes are copies, not shared with the source.
    const pasted = drawingAt(empty.project, empty.project.layers[1], 4)!.strokes[0];
    expect(pasted).toEqual(copied[0]);
    expect(pasted.points).not.toBe(copied[0].points);
  });
});

it('drags a layer into a gap in the stack', () => {
  const base = createProject();
  const p = addLayer(addLayer(base, 'A', base.layers[1].id).project, 'B', base.layers[1].id).project;
  const names = (q: typeof p) => q.layers.map((l) => l.name);
  expect(names(p)).toEqual(['Background', 'Layer 1', 'B', 'A']);
  const bg = p.layers[0].id;
  expect(names(moveLayerToGap(p, bg, 4))).toEqual(['Layer 1', 'B', 'A', 'Background']);
  expect(names(moveLayerToGap(p, bg, 2))).toEqual(['Layer 1', 'Background', 'B', 'A']);
  expect(moveLayerToGap(p, bg, 1)).toBe(p); // its own gap
  const top = p.layers[3].id;
  expect(names(moveLayerToGap(p, top, 0))).toEqual(['A', 'Background', 'Layer 1', 'B']);
});

it('stretches the scene to the sound and the camera', () => {
  const p = createProject(); // 2 frames at 12 fps
  expect(sceneLength({ ...p, audio: { name: 'a', data: '', start: 3, volume: 1, duration: 1.5 } })).toBe(21);
  expect(sceneLength({ ...p, camera: [{ frame: 30, x: 0, y: 0, zoom: 1, rotation: 0 }] })).toBe(31);
});

describe('paint layers', () => {
  const pix = { data: 'data:image/png;base64,AAAA', x: 10, y: 20, width: 5, height: 6 };

  it('adds a paint layer and stores its pixels on the drawing', () => {
    const r = addLayer(createProject(), 'Paint 1', undefined, { paint: true });
    const layer = r.project.layers.find((l) => l.id === r.layerId)!;
    expect(layer.paint).toBe(true);
    const p = setPaint(r.project, r.layerId, 0, pix);
    const d = drawingAt(p, p.layers.find((l) => l.id === r.layerId)!, 0)!;
    expect(d.paint).toEqual(pix);
    expect(d.strokes).toEqual([]);
    expect(isBlank(d)).toBe(false);
  });

  it('duplicates and clears paint like strokes', () => {
    const r = addLayer(createProject(), 'Paint 1', undefined, { paint: true });
    let p = setPaint(r.project, r.layerId, 0, pix);
    p = duplicateCelAt(p, r.layerId, 0).project;
    const layer = () => p.layers.find((l) => l.id === r.layerId)!;
    expect(drawingAt(p, layer(), 2)!.paint).toEqual(pix);
    p = clearCelAt(p, r.layerId, 0);
    expect(isBlank(drawingAt(p, layer(), 0))).toBe(true);
    expect(drawingAt(p, layer(), 2)!.paint).toEqual(pix);
  });

  it('erasing everything leaves a blank drawing', () => {
    const r = addLayer(createProject(), 'Paint 1', undefined, { paint: true });
    const p = setPaint(setPaint(r.project, r.layerId, 0, pix), r.layerId, 0, null);
    expect(isBlank(drawingAt(p, p.layers.find((l) => l.id === r.layerId)!, 0))).toBe(true);
  });
});
