// The project data model and pure operations on it.
//
// A project is a stack of layers. Each layer holds an ordered list of cels
// (an "exposure sheet"): every cel shows one drawing for `hold` frames, so a
// background can be a single drawing held for the whole scene while a
// character layer changes every 2 frames ("on twos").

export type Point = [x: number, y: number, pressure: number];

export interface Stroke {
  points: Point[];
  color: string;
  size: number;
  /** Eraser strokes cut through the earlier strokes of the same drawing. */
  erase: boolean;
  /** perfect-freehand options captured when the stroke was drawn. */
  smoothing: number;
  simulatePressure: boolean;
  /** How much pressure changes the line width: 0 draws an even line. */
  thinning: number;
}

export interface Drawing {
  id: string;
  strokes: Stroke[];
}

export interface Cel {
  /** `null` is a blank cel: the layer shows nothing for these frames. */
  drawingId: string | null;
  hold: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  cels: Cel[];
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Layers from bottom (index 0) to top. */
  layers: Layer[];
  drawings: Record<string, Drawing>;
}

export const MAX_HOLD = 24;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function createDrawing(): Drawing {
  return { id: newId('d'), strokes: [] };
}

export function createLayer(name: string, drawings: Record<string, Drawing>, hold = 2): Layer {
  const d = createDrawing();
  drawings[d.id] = d;
  return { id: newId('l'), name, visible: true, locked: false, opacity: 1, cels: [{ drawingId: d.id, hold }] };
}

export function createProject(name = 'Untitled animation'): Project {
  const drawings: Record<string, Drawing> = {};
  const background = createLayer('Background', drawings, 2);
  const layer = createLayer('Layer 1', drawings, 2);
  return { version: 1, id: newId('p'), name, width: 1280, height: 720, fps: 12, layers: [background, layer], drawings };
}

/** Number of frames a layer covers. */
export function layerLength(layer: Layer): number {
  return layer.cels.reduce((sum, c) => sum + c.hold, 0);
}

/** Length of the whole scene: the longest layer, at least 1 frame. */
export function sceneLength(project: Project): number {
  return Math.max(1, ...project.layers.map(layerLength));
}

/** Index of the cel showing at `frame` (0-based), or -1 past the layer's end. */
export function celIndexAt(layer: Layer, frame: number): number {
  let start = 0;
  for (let i = 0; i < layer.cels.length; i++) {
    const end = start + layer.cels[i].hold;
    if (frame >= start && frame < end) return i;
    start = end;
  }
  return -1;
}

/** First frame of the cel at `index`. */
export function celStart(layer: Layer, index: number): number {
  let start = 0;
  for (let i = 0; i < index; i++) start += layer.cels[i].hold;
  return start;
}

export function drawingAt(project: Project, layer: Layer, frame: number): Drawing | null {
  const i = celIndexAt(layer, frame);
  if (i < 0) return null;
  const id = layer.cels[i].drawingId;
  return id ? project.drawings[id] ?? null : null;
}

function mapLayer(project: Project, layerId: string, fn: (layer: Layer) => Layer): Project {
  return { ...project, layers: project.layers.map((l) => (l.id === layerId ? fn(l) : l)) };
}

function findLayer(project: Project, layerId: string): Layer {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`No layer ${layerId}`);
  return layer;
}

/**
 * Make sure the layer has a drawing at `frame` that strokes can go into.
 * Past the layer's end, a blank cel fills the gap and a new cel starts at
 * `frame`; a blank cel at `frame` gets a fresh drawing.
 */
export function ensureDrawingAt(project: Project, layerId: string, frame: number): { project: Project; drawingId: string } {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  if (i >= 0 && layer.cels[i].drawingId) return { project, drawingId: layer.cels[i].drawingId! };

  const d = createDrawing();
  const drawings = { ...project.drawings, [d.id]: d };
  let cels: Cel[];
  if (i >= 0) {
    cels = layer.cels.map((c, j) => (j === i ? { ...c, drawingId: d.id } : c));
  } else {
    const length = layerLength(layer);
    const hold = layer.cels.at(-1)?.hold ?? 2;
    cels = [...layer.cels];
    if (frame > length) cels.push({ drawingId: null, hold: frame - length });
    cels.push({ drawingId: d.id, hold });
  }
  return { project: { ...mapLayer(project, layerId, (l) => ({ ...l, cels })), drawings }, drawingId: d.id };
}

export function addStroke(project: Project, layerId: string, frame: number, stroke: Stroke): Project {
  const ensured = ensureDrawingAt(project, layerId, frame);
  const p = ensured.project;
  const drawing = p.drawings[ensured.drawingId];
  return { ...p, drawings: { ...p.drawings, [drawing.id]: { ...drawing, strokes: [...drawing.strokes, stroke] } } };
}

/**
 * Insert a new empty drawing right before or after the cel at `frame`, with
 * the same hold. Past the layer's end, the drawing starts at `frame`.
 * Returns the frame where the new drawing starts.
 */
export function insertDrawing(
  project: Project,
  layerId: string,
  frame: number,
  side: 'before' | 'after' = 'after',
): { project: Project; frame: number } {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  if (i < 0) {
    // Past the end: start the new drawing at this frame, filling any gap.
    const ensured = ensureDrawingAt(project, layerId, frame);
    return { project: ensured.project, frame };
  }
  const d = createDrawing();
  const drawings = { ...project.drawings, [d.id]: d };
  const at = side === 'after' ? i + 1 : i;
  const cels = [...layer.cels];
  cels.splice(at, 0, { drawingId: d.id, hold: layer.cels[i].hold });
  const next = { ...mapLayer(project, layerId, (l) => ({ ...l, cels })), drawings };
  return { project: next, frame: celStart({ ...layer, cels }, at) };
}

export function insertDrawingAfter(project: Project, layerId: string, frame: number) {
  return insertDrawing(project, layerId, frame, 'after');
}

/** Erase everything in the drawing at `frame`, keeping its place and hold. */
export function clearCelAt(project: Project, layerId: string, frame: number): Project {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  const id = i >= 0 ? layer.cels[i].drawingId : null;
  if (!id || !project.drawings[id]?.strokes.length) return project;
  return { ...project, drawings: { ...project.drawings, [id]: { ...project.drawings[id], strokes: [] } } };
}

/**
 * Move the cel at index `from` so it ends up at index `to` (an index into the
 * resulting list). Returns the frame where the moved cel now starts.
 */
export function moveCel(project: Project, layerId: string, from: number, to: number): { project: Project; frame: number } {
  const layer = findLayer(project, layerId);
  const n = layer.cels.length;
  if (from < 0 || from >= n) return { project, frame: 0 };
  const target = Math.max(0, Math.min(n - 1, to));
  if (target === from) return { project, frame: celStart(layer, from) };
  const cels = [...layer.cels];
  const [cel] = cels.splice(from, 1);
  cels.splice(target, 0, cel);
  return { project: mapLayer(project, layerId, (l) => ({ ...l, cels })), frame: celStart({ ...layer, cels }, target) };
}

/**
 * The gap a dragged cel would drop into when released over `frame` (plus a
 * `fraction` of that frame): the first half of a cel means the gap before it,
 * the second half the gap after it, and past the end the last gap. Gaps are
 * numbered 0..cels.length, in the list before the dragged cel is removed.
 */
export function dropSlot(layer: Layer, frame: number, fraction: number): number {
  const over = celIndexAt(layer, frame);
  if (over < 0) return frame < 0 ? 0 : layer.cels.length;
  const pos = (frame - celStart(layer, over) + fraction) / layer.cels[over].hold;
  return pos < 0.5 ? over : over + 1;
}

/** The index a cel dragged from `from` ends up at, for `moveCel`. */
export function dropIndex(layer: Layer, from: number, frame: number, fraction: number): number {
  const slot = dropSlot(layer, frame, fraction);
  return Math.min(layer.cels.length - 1, slot > from ? slot - 1 : slot);
}

/** Copy the drawing at `frame` into a new cel right after it. */
export function duplicateCelAt(project: Project, layerId: string, frame: number): { project: Project; frame: number } {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  if (i < 0) return { project, frame };
  const src = layer.cels[i];
  const drawings = { ...project.drawings };
  let drawingId: string | null = null;
  if (src.drawingId) {
    const copy: Drawing = { id: newId('d'), strokes: [...(project.drawings[src.drawingId]?.strokes ?? [])] };
    drawings[copy.id] = copy;
    drawingId = copy.id;
  }
  const cels = [...layer.cels];
  cels.splice(i + 1, 0, { drawingId, hold: src.hold });
  return {
    project: { ...mapLayer(project, layerId, (l) => ({ ...l, cels })), drawings },
    frame: celStart({ ...layer, cels }, i + 1),
  };
}

export function deleteCelAt(project: Project, layerId: string, frame: number): Project {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  if (i < 0) return project;
  const cels = layer.cels.filter((_, j) => j !== i);
  return pruneDrawings(mapLayer(project, layerId, (l) => ({ ...l, cels })));
}

export function setHoldAt(project: Project, layerId: string, frame: number, hold: number): Project {
  const layer = findLayer(project, layerId);
  const i = celIndexAt(layer, frame);
  if (i < 0) return project;
  const h = Math.max(1, Math.min(MAX_HOLD, Math.round(hold)));
  return mapLayer(project, layerId, (l) => ({ ...l, cels: l.cels.map((c, j) => (j === i ? { ...c, hold: h } : c)) }));
}

/**
 * Make the cel at `frame` last until the end of the scene (e.g. a background).
 * Past the layer's end, its last cel is stretched instead.
 */
export function holdToEnd(project: Project, layerId: string, frame: number): Project {
  const layer = findLayer(project, layerId);
  let i = celIndexAt(layer, frame);
  if (i < 0) i = layer.cels.length - 1;
  if (i < 0) return project;
  const others = Math.max(1, ...project.layers.filter((l) => l.id !== layerId).map(layerLength));
  const start = celStart(layer, i);
  const after = layer.cels.slice(i + 1).reduce((s, c) => s + c.hold, 0);
  const hold = Math.max(1, others - start - after);
  return mapLayer(project, layerId, (l) => ({ ...l, cels: l.cels.map((c, j) => (j === i ? { ...c, hold } : c)) }));
}

export function addLayer(project: Project, name: string, aboveLayerId?: string): { project: Project; layerId: string } {
  const drawings = { ...project.drawings };
  const layer = createLayer(name, drawings);
  const layers = [...project.layers];
  const at = aboveLayerId ? layers.findIndex((l) => l.id === aboveLayerId) + 1 : layers.length;
  layers.splice(at <= 0 ? layers.length : at, 0, layer);
  return { project: { ...project, layers, drawings }, layerId: layer.id };
}

export function removeLayer(project: Project, layerId: string): Project {
  if (project.layers.length <= 1) return project;
  return pruneDrawings({ ...project, layers: project.layers.filter((l) => l.id !== layerId) });
}

export function updateLayer(project: Project, layerId: string, patch: Partial<Omit<Layer, 'id' | 'cels'>>): Project {
  return mapLayer(project, layerId, (l) => ({ ...l, ...patch }));
}

/** Move a layer up (+1, toward the top) or down (-1). */
export function moveLayer(project: Project, layerId: string, delta: number): Project {
  const layers = [...project.layers];
  const i = layers.findIndex((l) => l.id === layerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layers.length) return project;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...project, layers };
}

/** Drop drawings no cel points at any more. */
export function pruneDrawings(project: Project): Project {
  const used = new Set<string>();
  for (const l of project.layers) for (const c of l.cels) if (c.drawingId) used.add(c.drawingId);
  const drawings: Record<string, Drawing> = {};
  for (const id of used) if (project.drawings[id]) drawings[id] = project.drawings[id];
  return { ...project, drawings };
}

/** Light validation for projects loaded from storage or a file. */
export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Project;
  return (
    p.version === 1 &&
    typeof p.width === 'number' &&
    typeof p.height === 'number' &&
    typeof p.fps === 'number' &&
    Array.isArray(p.layers) &&
    p.layers.every((l) => Array.isArray(l.cels)) &&
    typeof p.drawings === 'object'
  );
}
