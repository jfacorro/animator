// Drawing aids: symmetry, guides with snapping, ruler ticks and reference images.
import type { Vec } from './geometry';
import type { Layer, Project, Stroke } from './project';
import { newId, pruneGroups } from './project';

/** Mirror what you draw: left–right ('x'), top–bottom ('y'), or both. */
export type Symmetry = 'off' | 'x' | 'y' | 'xy';

/** The stroke mirrored across the canvas centre lines. */
export function mirrorStroke(s: Stroke, flipX: boolean, flipY: boolean, w: number, h: number): Stroke {
  return {
    ...s,
    points: s.points.map(([x, y, p]) => [flipX ? w - x : x, flipY ? h - y : y, p]),
  };
}

/** The stroke plus its mirrored copies for the symmetry mode, original first. */
export function symmetricStrokes(s: Stroke, mode: Symmetry, w: number, h: number): Stroke[] {
  if (mode === 'off' || s.kind === 'fill' || s.kind === 'text') return [s];
  const out = [s];
  if (mode === 'x' || mode === 'xy') out.push(mirrorStroke(s, true, false, w, h));
  if (mode === 'y' || mode === 'xy') out.push(mirrorStroke(s, false, true, w, h));
  if (mode === 'xy') out.push(mirrorStroke(s, true, true, w, h));
  return out;
}

/** Guide lines, in project px: `x` holds vertical lines, `y` horizontal ones. */
export interface Guides {
  x: number[];
  y: number[];
}

export type GuideAxis = keyof Guides;

const guidesOf = (p: Project): Guides => p.guides ?? { x: [], y: [] };
const round = (v: number) => Math.round(v * 10) / 10;

export function addGuide(project: Project, axis: GuideAxis, pos: number): Project {
  const g = guidesOf(project);
  return { ...project, guides: { ...g, [axis]: [...g[axis], round(pos)] } };
}

export function moveGuide(project: Project, axis: GuideAxis, index: number, pos: number): Project {
  const g = guidesOf(project);
  return { ...project, guides: { ...g, [axis]: g[axis].map((v, i) => (i === index ? round(pos) : v)) } };
}

export function removeGuide(project: Project, axis: GuideAxis, index: number): Project {
  const g = guidesOf(project);
  const next = { ...g, [axis]: g[axis].filter((_, i) => i !== index) };
  return { ...project, guides: next.x.length || next.y.length ? next : undefined };
}

/** Pull a point onto the nearest guide within `within` project px, on each axis. */
export function snapToGuides(pt: Vec, guides: Guides | undefined, within: number): Vec {
  if (!guides) return pt;
  const near = (v: number, lines: number[]) => {
    let best = v;
    let d = within;
    for (const l of lines) {
      if (Math.abs(l - v) <= d) {
        d = Math.abs(l - v);
        best = l;
      }
    }
    return best;
  };
  return [near(pt[0], guides.x), near(pt[1], guides.y)];
}

/**
 * Spacing of labelled ruler ticks, in project px: the smallest of 1, 2, 5,
 * 10, 20, 50… that keeps labels at least `minGap` screen px apart.
 */
export function rulerStep(screenPerUnit: number, minGap = 60): number {
  for (let mag = 1; ; mag *= 10) {
    for (const m of [1, 2, 5]) if (m * mag * screenPerUnit >= minGap) return m * mag;
    if (mag > 1e6) return mag;
  }
}

/** An image to trace over. It shows on every frame and is never exported. */
export interface RefImage {
  /** The picture as a data: URL, so it travels inside the project file. */
  data: string;
  /** Where it sits on the canvas, in project px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fit an image of `iw`×`ih` inside the canvas, centred. */
export function fitImage(iw: number, ih: number, w: number, h: number): Omit<RefImage, 'data'> {
  const s = Math.min(w / iw, h / ih);
  const width = round(iw * s);
  const height = round(ih * s);
  return { x: round((w - width) / 2), y: round((h - height) / 2), width, height };
}

export const isReference = (l: Layer | null | undefined) => !!l?.reference;

/** Add a reference image as a see-through layer at the bottom of the stack. */
export function addReferenceLayer(project: Project, name: string, image: RefImage): { project: Project; layerId: string } {
  const layer: Layer = { id: newId('l'), name, visible: true, locked: false, opacity: 0.5, cels: [], reference: image };
  return { project: pruneGroups({ ...project, layers: [layer, ...project.layers] }), layerId: layer.id };
}

/** Move or resize the reference image of a layer. */
export function placeReference(project: Project, layerId: string, rect: Omit<RefImage, 'data'>): Project {
  return {
    ...project,
    layers: project.layers.map((l) => (l.id === layerId && l.reference
      ? { ...l, reference: { ...l.reference, x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } }
      : l)),
  };
}

/** Reference layers never hold drawings: true if an edit gave one some. */
export const referenceGotDrawings = (p: Project) => p.layers.some((l) => l.reference && l.cels.length > 0);
