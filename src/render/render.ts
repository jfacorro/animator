import { getStroke } from 'perfect-freehand';
import { cameraAt, cameraMatrix, hasCamera } from '../model/camera';
import { celIndexAt, type Drawing, type Project, type Stroke } from '../model/project';

export const PAPER = '#fbfaf7';
export const ONION_BEFORE = '#e5534b';
export const ONION_AFTER = '#4c8df0';

export function strokeOutline(s: Stroke, last = true): number[][] {
  return getStroke(s.points, {
    size: s.size,
    thinning: s.thinning ?? 0.6,
    smoothing: s.smoothing,
    streamline: Math.min(0.9, 0.2 + s.smoothing * 0.6),
    simulatePressure: s.simulatePressure,
    last,
  });
}

/** Turn a perfect-freehand outline into a smooth closed path. */
export function outlineToPath(points: number[][]): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;
  const [first, ...rest] = points;
  path.moveTo(first[0], first[1]);
  for (let i = 0; i < rest.length; i++) {
    const [x0, y0] = rest[i];
    const [x1, y1] = rest[(i + 1) % rest.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

const pathCache = new WeakMap<Stroke, Path2D>();

/** The stroke's shape in its own coordinates (before its matrix). */
function buildPath(s: Stroke, live: boolean): Path2D {
  const kind = s.kind ?? 'free';
  if (kind === 'free') return outlineToPath(strokeOutline(s, !live));
  const path = new Path2D();
  if (kind === 'fill') {
    const sp = s.spans ?? [];
    for (let i = 0; i < sp.length; i += 3) path.rect(sp[i + 1], sp[i], sp[i + 2] - sp[i + 1] + 1, 1);
    return path;
  }
  const [a, b] = s.points;
  if (!a || !b) return path;
  if (kind === 'line') {
    path.moveTo(a[0], a[1]);
    path.lineTo(b[0], b[1]);
  } else if (kind === 'rect') {
    path.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else {
    path.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
  }
  return path;
}

function strokePath(s: Stroke, live: boolean): Path2D {
  if (live) return buildPath(s, true);
  let p = pathCache.get(s);
  if (!p) {
    p = buildPath(s, false);
    pathCache.set(s, p);
  }
  return p;
}

/** Paint one stroke. `live` skips caching for a stroke still being drawn. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, live = false) {
  const kind = s.kind ?? 'free';
  const path = strokePath(s, live);
  ctx.save();
  if (s.matrix) ctx.transform(...s.matrix);
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  if (!s.erase && s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= s.opacity;
  // Soft edges: blur in screen pixels, scaled by how much the stroke's matrix enlarges it.
  if (s.softness && !s.erase && 'filter' in ctx) {
    const m = s.matrix;
    const grow = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
    ctx.filter = `blur(${(s.size * s.softness * 0.3 * grow).toFixed(2)}px)`;
  }
  const color = s.erase ? '#000' : s.color;
  const outline = kind === 'line' || ((kind === 'rect' || kind === 'ellipse') && !s.filled);
  if (outline) {
    ctx.strokeStyle = color;
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.restore();
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Drawings are immutable, so a rendered bitmap stays valid for as long as
// the drawing object lives. A small LRU keeps memory bounded.
const CACHE_LIMIT = 80;
const cache = new Map<string, HTMLCanvasElement>();
const cacheKeys = new WeakMap<Drawing, Map<string, string>>();
let keyCounter = 0;

function cacheKey(d: Drawing, variant: string, w: number, h: number): string {
  let byVariant = cacheKeys.get(d);
  if (!byVariant) {
    byVariant = new Map();
    cacheKeys.set(d, byVariant);
  }
  const v = `${variant}|${w}x${h}`;
  let key = byVariant.get(v);
  if (!key) {
    key = `${++keyCounter}`;
    byVariant.set(v, key);
  }
  return key;
}

function cached(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const c = build();
  cache.set(key, c);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return c;
}

export function drawingBitmap(d: Drawing, w: number, h: number): HTMLCanvasElement {
  return cached(cacheKey(d, 'plain', w, h), () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    for (const s of d.strokes) paintStroke(ctx, s);
    return c;
  });
}

/** The drawing recoloured in one flat colour, for onion skins. */
export function tintedBitmap(d: Drawing, color: string, w: number, h: number): HTMLCanvasElement {
  return cached(cacheKey(d, `tint:${color}`, w, h), () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(drawingBitmap(d, w, h), 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c;
  });
}

export interface OnionOptions {
  /** The layer to show onion skins for, or null for every visible layer. */
  layerId: string | null;
  before: number;
  after: number;
  /** Strength of the nearest onion skin, 0–1. Further ones fade. */
  opacity?: number;
  beforeColor?: string;
  afterColor?: string;
}

export interface ComposeOptions {
  paper: boolean;
  onion?: OnionOptions | null;
  includeHidden?: boolean;
  /** A stroke in progress, drawn into this layer's current drawing. */
  live?: { layerId: string; stroke: Stroke } | null;
  /** Frame the scene through the camera (playback and export). */
  camera?: boolean;
}

let scratch: HTMLCanvasElement | null = null;

/** Paint one frame of the scene, bottom layer first, at project size. */
export function composeFrame(ctx: CanvasRenderingContext2D, project: Project, frame: number, opts: ComposeOptions) {
  const { width: w, height: h } = project;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (opts.paper) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  if (opts.camera && hasCamera(project)) ctx.setTransform(...cameraMatrix(cameraAt(project, frame), w, h));

  for (const layer of project.layers) {
    if (!layer.visible && !opts.includeHidden) continue;

    const onion = opts.onion;
    if (onion && (onion.layerId === layer.id || (onion.layerId === null && !layer.locked))) {
      const i = celIndexAt(layer, frame);
      // Past the end of the layer, the previous drawings are the last ones.
      const anchor = i >= 0 ? i : layer.cels.length;
      const draw = (index: number, color: string, step: number, count: number) => {
        const cel = layer.cels[index];
        const d = cel?.drawingId ? project.drawings[cel.drawingId] : null;
        if (!d || !d.strokes.length) return;
        ctx.globalAlpha = (onion.opacity ?? 0.45) * (1 - (step - 1) / (count + 0.5));
        ctx.drawImage(tintedBitmap(d, color, w, h), 0, 0);
      };
      for (let k = onion.before; k >= 1; k--) draw(anchor - k, onion.beforeColor ?? ONION_BEFORE, k, onion.before);
      if (i >= 0) for (let k = onion.after; k >= 1; k--) draw(anchor + k, onion.afterColor ?? ONION_AFTER, k, onion.after);
      ctx.globalAlpha = 1;
    }

    const i = celIndexAt(layer, frame);
    const id = i >= 0 ? layer.cels[i].drawingId : null;
    const d = id ? project.drawings[id] : null;
    if (opts.live && opts.live.layerId === layer.id) {
      // Base drawing plus the stroke in progress, so the eraser previews too.
      if (!scratch || scratch.width !== w || scratch.height !== h) scratch = makeCanvas(w, h);
      const sctx = scratch.getContext('2d')!;
      sctx.clearRect(0, 0, w, h);
      if (d) sctx.drawImage(drawingBitmap(d, w, h), 0, 0);
      paintStroke(sctx, opts.live.stroke, true);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(scratch, 0, 0);
      ctx.globalAlpha = 1;
      continue;
    }
    if (!d || !d.strokes.length) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(drawingBitmap(d, w, h), 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
