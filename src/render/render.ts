import { getStroke } from 'perfect-freehand';
import { cameraAt, cameraMatrix, hasCamera } from '../model/camera';
import { compositeOp, sceneUnits } from '../model/groups';
import { celIndexAt, isBlank, type Drawing, type FontId, type Layer, type Paint, type Project, type Stroke } from '../model/project';

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

export const FONTS: Record<FontId, { name: string; css: string }> = {
  sans: { name: 'Sans', css: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  serif: { name: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  hand: { name: 'Handwritten', css: '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive' },
  mono: { name: 'Typewriter', css: 'ui-monospace, Consolas, "Courier New", monospace' },
};
export const LINE_HEIGHT = 1.25;
export const fontCss = (font: FontId | undefined, size: number, bold?: boolean) =>
  `${bold ? 'bold ' : ''}${size}px ${FONTS[font ?? 'sans'].css}`;

let measurer: CanvasRenderingContext2D | null = null;
/** Width and height of a block of text, in px. */
export function measureText(text: string, font: FontId | undefined, size: number, bold?: boolean): { w: number; h: number } {
  measurer ??= makeCanvas(1, 1).getContext('2d')!;
  measurer.font = fontCss(font, size, bold);
  const lines = text.split('\n');
  const w = Math.max(1, ...lines.map((l) => measurer!.measureText(l).width));
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LINE_HEIGHT) };
}

function fillStyleFor(ctx: CanvasRenderingContext2D, s: Stroke): string | CanvasGradient {
  const g = s.gradient;
  if (!g) return s.color;
  const [fx, fy] = g.from;
  const [tx, ty] = g.to;
  const grad = g.type === 'radial'
    ? ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.max(1, Math.hypot(tx - fx, ty - fy)))
    : ctx.createLinearGradient(fx, fy, tx, ty);
  grad.addColorStop(0, g.colors[0]);
  grad.addColorStop(1, g.colors[1]);
  return grad;
}

/**
 * How a drawing is painted: paint-bucket fills on one sheet, lines on another
 * laid over it. The eraser works on both sheets in the order it was used, so
 * it removes what was there when you erased, but never a fill added later.
 */
export function drawingPasses(strokes: Stroke[]): { fills: Stroke[]; lines: Stroke[] } {
  const fills: Stroke[] = [];
  const lines: Stroke[] = [];
  let seenFill = false;
  for (const s of strokes) {
    if (s.kind === 'fill') { fills.push(s); seenFill = true; continue; }
    lines.push(s);
    if (s.erase && seenFill) fills.push(s);
  }
  return { fills, lines };
}

let fillSheet: HTMLCanvasElement | null = null;

/** Paint a drawing's strokes, with its fills under its lines (see drawingPasses). */
export function paintDrawing(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  const { fills, lines } = drawingPasses(strokes);
  if (!fills.length) { for (const s of lines) paintStroke(ctx, s); return; }
  if (!lines.some((s) => s.erase)) {
    // No eraser at all: the fills can go straight onto the page first. (An eraser
    // used before a fill still cuts the lines, so it must not touch the page's fills.)
    for (const s of fills) paintStroke(ctx, s);
    for (const s of lines) paintStroke(ctx, s);
    return;
  }
  const { width, height } = ctx.canvas;
  if (!fillSheet) fillSheet = makeCanvas(width, height);
  if (fillSheet.width < width || fillSheet.height < height) {
    fillSheet.width = Math.max(fillSheet.width, width);
    fillSheet.height = Math.max(fillSheet.height, height);
  }
  const fctx = fillSheet.getContext('2d')!;
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.globalAlpha = 1;
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, width, height);
  fctx.setTransform(ctx.getTransform());
  for (const s of fills) paintStroke(fctx, s);
  for (const s of lines) paintStroke(ctx, s);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(fillSheet, 0, 0, width, height, 0, 0, width, height);
  ctx.restore();
}

/** Paint one stroke. `live` skips caching for a stroke still being drawn. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, live = false) {
  const kind = s.kind ?? 'free';
  if (kind === 'text') {
    paintText(ctx, s);
    return;
  }
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
    ctx.fillStyle = s.erase ? color : fillStyleFor(ctx, s);
    ctx.fill(path);
  }
  ctx.restore();
}

function paintText(ctx: CanvasRenderingContext2D, s: Stroke) {
  const [a] = s.points;
  if (!a || !s.text) return;
  ctx.save();
  if (s.matrix) ctx.transform(...s.matrix);
  if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= s.opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = fontCss(s.font, s.size, s.bold);
  ctx.textBaseline = 'top';
  ctx.fillStyle = s.color;
  s.text.split('\n').forEach((line, i) => ctx.fillText(line, a[0], a[1] + i * s.size * LINE_HEIGHT));
  ctx.restore();
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A rendered picture and where its top-left corner sits on the canvas. */
export interface Pic {
  src: HTMLCanvasElement;
  x: number;
  y: number;
}

/** The part of the canvas a drawing can touch, in whole px, or null when it paints nothing. */
export function drawingBox(d: Drawing, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (m: Stroke['matrix'], x: number, y: number, pad: number) => {
    const [px, py] = m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y];
    if (px - pad < x0) x0 = px - pad;
    if (py - pad < y0) y0 = py - pad;
    if (px + pad > x1) x1 = px + pad;
    if (py + pad > y1) y1 = py + pad;
  };
  if (d.paint) {
    const p = d.paint;
    add(undefined, p.x, p.y, 0);
    add(undefined, p.x + p.width, p.y + p.height, 0);
  }
  for (const s of d.strokes) {
    if (s.erase) continue; // erasing only takes paint away
    const m = s.matrix;
    const grow = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
    const kind = s.kind ?? 'free';
    if (kind === 'fill') {
      const sp = s.spans ?? [];
      let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
      for (let i = 0; i < sp.length; i += 3) {
        fy0 = Math.min(fy0, sp[i]); fy1 = Math.max(fy1, sp[i] + 1);
        fx0 = Math.min(fx0, sp[i + 1]); fx1 = Math.max(fx1, sp[i + 2] + 1);
      }
      if (fx0 === Infinity) continue;
      for (const [x, y] of [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]) add(m, x, y, 2);
      continue;
    }
    if (kind === 'text') {
      const [a, b] = s.points;
      if (!a || !b) continue;
      const pad = s.size * 0.35 + 2; // slanted and overhanging letters
      for (const [x, y] of [[a[0], a[1]], [b[0], a[1]], [a[0], b[1]], [b[0], b[1]]]) add(m, x, y, pad * grow);
      continue;
    }
    // Lines: the widest a pressure stroke gets, plus a soft edge's blur.
    const pad = (s.size + (s.softness ? s.size * s.softness * 0.9 : 0)) * grow + 2;
    for (const p of s.points) add(m, p[0], p[1], pad);
  }
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(w, Math.ceil(x1));
  const by1 = Math.min(h, Math.ceil(y1));
  return bx1 > bx0 && by1 > by0 ? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } : null;
}

// Drawings are immutable, so a rendered bitmap stays valid for as long as
// the drawing object lives. Bitmaps cover only the area a drawing touches,
// and the cache keeps as many as fit in a memory budget, least recently used
// going first.
// Safari on iPad and iPhone stops drawing (blank canvases) once all canvases
// together pass a few hundred MB, so it gets a much smaller budget.
const IOS = typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const CACHE_BYTES = (IOS ? 128 : 384) * 1024 * 1024;
const cache = new Map<string, Pic | null>();
let cacheBytes = 0;
const cacheKeys = new WeakMap<Drawing, Map<string, string>>();
let keyCounter = 0;
const picBytes = (p: Pic | null) => (p ? p.src.width * p.src.height * 4 : 64);

// Canvases of bitmaps that left the cache, kept for reuse: making a new
// canvas costs more than clearing an old one. Sizes are rounded up to 64 px
// so that drawings of about the same size can share them.
const spare = new Map<string, HTMLCanvasElement[]>();
let spareCount = 0;
const SPARE_LIMIT = IOS ? 12 : 48;
const round64 = (v: number) => Math.ceil(v / 64) * 64;
function bitmapCanvas(w: number, h: number): HTMLCanvasElement {
  const list = spare.get(`${w}x${h}`);
  const c = list?.pop();
  if (c) {
    spareCount--;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    return c;
  }
  return makeCanvas(w, h);
}
function retire(p: Pic | null) {
  if (!p) return;
  if (spareCount >= SPARE_LIMIT) {
    // Not kept: shrinking it hands its memory back now rather than at the next garbage collection.
    p.src.width = p.src.height = 0;
    return;
  }
  const k = `${p.src.width}x${p.src.height}`;
  const list = spare.get(k) ?? [];
  list.push(p.src);
  spare.set(k, list);
  spareCount++;
}

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

function cached(key: string, build: () => Pic | null): Pic | null {
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pic = build();
  cache.set(key, pic);
  cacheBytes += picBytes(pic);
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value!;
    const gone = cache.get(oldest)!;
    cacheBytes -= picBytes(gone);
    cache.delete(oldest);
    retire(gone);
  }
  return pic;
}

/** The drawing rendered on its own, or null when it shows nothing. */
export function drawingBitmap(d: Drawing, w: number, h: number): Pic | null {
  // Paint still decoding: show nothing for now (and don't remember that), onImageLoad repaints.
  const sheet = d.paint ? paintSource(d.paint) : null;
  if (d.paint && !sheet) return null;
  return cached(cacheKey(d, 'plain', w, h), () => {
    const box = drawingBox(d, w, h);
    if (!box) return null;
    // Grow the box to the rounded canvas size, staying on the page.
    const cw = Math.min(w, round64(box.w));
    const ch = Math.min(h, round64(box.h));
    box.x = Math.max(0, Math.min(box.x, w - cw));
    box.y = Math.max(0, Math.min(box.y, h - ch));
    const c = bitmapCanvas(cw, ch);
    const ctx = c.getContext('2d')!;
    ctx.translate(-box.x, -box.y);
    if (sheet && d.paint) ctx.drawImage(sheet, d.paint.x, d.paint.y);
    paintDrawing(ctx, d.strokes);
    return { src: c, x: box.x, y: box.y };
  });
}

/** The drawing recoloured in one flat colour, for onion skins. */
export function tintedBitmap(d: Drawing, color: string, w: number, h: number): Pic | null {
  return cached(cacheKey(d, `tint:${color}`, w, h), () => {
    const plain = drawingBitmap(d, w, h);
    if (!plain) return null;
    const c = bitmapCanvas(plain.src.width, plain.src.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(plain.src, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return { src: c, x: plain.x, y: plain.y };
  });
}

// Reference images load asynchronously: whoever painted asks to be told when one arrives.
const images = new Map<string, HTMLImageElement>();
const imageListeners = new Set<() => void>();
/** Call `fn` whenever a reference image finishes loading. Returns an unsubscribe function. */
export function onImageLoad(fn: () => void): () => void {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}
/** The decoded image, or null while it loads. */
export function loadedImage(data: string): HTMLImageElement | null {
  let img = images.get(data);
  if (!img) {
    img = new Image();
    img.onload = () => imageListeners.forEach((fn) => fn());
    img.src = data;
    images.set(data, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Paint drawings: pixels stored as PNG data URLs. A sheet just baked here is
// kept as its canvas, so drawing on a paint layer never waits for a decode.
const baked = new Map<string, HTMLCanvasElement>();
const BAKED_LIMIT = 8;

/** Something to draw a paint drawing's pixels from, or null while its image decodes. */
export function paintSource(p: Paint): CanvasImageSource | null {
  return baked.get(p.data) ?? loadedImage(p.data);
}

/** Wait until every paint drawing can be drawn (before exporting, which draws frames straight away). */
export async function paintReady(project: Project): Promise<void> {
  const waits: Promise<unknown>[] = [];
  for (const d of Object.values(project.drawings)) {
    if (!d.paint || paintSource(d.paint)) continue;
    loadedImage(d.paint.data); // starts decoding
    const img = images.get(d.paint.data);
    if (img) waits.push(img.decode().catch(() => undefined));
  }
  await Promise.all(waits);
}

/**
 * Paint `strokes` onto a paint drawing's pixels (`base`) and return the new pixels,
 * cropped to where there is paint, or null when nothing is left. Fills go under
 * what's already there, like on stroke layers; the eraser really removes paint.
 */
export function bakePaint(base: Paint | undefined, strokes: Stroke[], w: number, h: number): Paint | null {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (base) {
    const src = paintSource(base);
    if (!src) throw new Error('The drawing is still loading. Try again in a moment.');
    ctx.drawImage(src, base.x, base.y);
  }
  paintDrawing(ctx, strokes);
  // Crop to the painted area.
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const crop = makeCanvas(cw, ch);
  crop.getContext('2d')!.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
  const data = crop.toDataURL('image/png');
  baked.set(data, crop);
  while (baked.size > BAKED_LIMIT) baked.delete(baked.keys().next().value!);
  return { data, x: x0, y: y0, width: cw, height: ch };
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
  /** Strokes in progress (with their symmetry copies), drawn into this layer's current drawing. */
  live?: { layerId: string; strokes: Stroke[] } | null;
  /** Show reference image layers (on screen only: never in exports). */
  references?: boolean;
  /** Frame the scene through the camera (playback and export). */
  camera?: boolean;
}

// Scratch canvases for groups and clipping, reused between frames.
const pool: HTMLCanvasElement[] = [];
let poolUsed = 0;
function borrow(w: number, h: number): CanvasRenderingContext2D {
  let c = pool[poolUsed];
  if (!c || c.width !== w || c.height !== h) {
    c = makeCanvas(w, h);
    pool[poolUsed] = c;
  }
  poolUsed++;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  return ctx;
}
const giveBack = (n = 1) => { poolUsed -= n; };

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
  poolUsed = 0;

  const shown = (l: Layer) => l.visible || !!opts.includeHidden;

  /** The layer's picture at this frame (with any stroke in progress), or null when empty. */
  const picture = (layer: Layer): Pic | null => {
    const ref = layer.reference;
    if (ref) {
      const img = opts.references ? loadedImage(ref.data) : null;
      if (!img) return null;
      const rctx = borrow(w, h);
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(img, ref.x, ref.y, ref.width, ref.height);
      return { src: rctx.canvas, x: 0, y: 0 }; // given back after the frame
    }
    const i = celIndexAt(layer, frame);
    const id = i >= 0 ? layer.cels[i].drawingId : null;
    const d = id ? project.drawings[id] : null;
    if (opts.live && opts.live.layerId === layer.id) {
      // Base drawing plus the stroke in progress, so the eraser previews too.
      const sctx = borrow(w, h);
      const base = d ? drawingBitmap(d, w, h) : null;
      if (base) sctx.drawImage(base.src, base.x, base.y);
      for (const s of opts.live.strokes) paintStroke(sctx, s, true);
      return { src: sctx.canvas, x: 0, y: 0 }; // given back after the frame
    }
    return d && !isBlank(d) ? drawingBitmap(d, w, h) : null;
  };

  const onionSkins = (target: CanvasRenderingContext2D, layer: Layer, locked: boolean) => {
    const onion = opts.onion;
    if (!onion || layer.reference || !(onion.layerId === layer.id || (onion.layerId === null && !locked))) return;
    const i = celIndexAt(layer, frame);
    // Past the end of the layer, the previous drawings are the last ones.
    const anchor = i >= 0 ? i : layer.cels.length;
    const draw = (index: number, color: string, step: number, count: number) => {
      const cel = layer.cels[index];
      const d = cel?.drawingId ? project.drawings[cel.drawingId] : null;
      if (!d || isBlank(d)) return;
      target.globalAlpha = (onion.opacity ?? 0.45) * (1 - (step - 1) / (count + 0.5));
      target.globalCompositeOperation = 'source-over';
      const t = tintedBitmap(d, color, w, h);
      if (t) target.drawImage(t.src, t.x, t.y);
    };
    for (let k = onion.before; k >= 1; k--) draw(anchor - k, onion.beforeColor ?? ONION_BEFORE, k, onion.before);
    if (i >= 0) for (let k = onion.after; k >= 1; k--) draw(anchor + k, onion.afterColor ?? ONION_AFTER, k, onion.after);
    target.globalAlpha = 1;
  };

  /** Draw a base layer with the layers clipped to it. */
  const drawStack = (target: CanvasRenderingContext2D, base: Layer, clipped: Layer[], groupLocked: boolean) => {
    if (!shown(base)) return;
    onionSkins(target, base, base.locked || groupLocked);
    const img = picture(base);
    const clips = clipped.filter(shown);
    for (const c of clips) onionSkins(target, c, c.locked || groupLocked);
    if (!img) return;
    let out: Pic = img;
    if (clips.length) {
      // The base at full size: the mask clipped layers are cut to.
      const mctx = borrow(w, h);
      mctx.drawImage(img.src, img.x, img.y);
      const bctx = borrow(w, h);
      bctx.drawImage(mctx.canvas, 0, 0);
      for (const c of clips) {
        const cimg = picture(c);
        if (!cimg) continue;
        // The clipped layer, cut to where the base has paint, then blended onto it.
        const tctx = borrow(w, h);
        tctx.globalAlpha = c.opacity;
        tctx.drawImage(cimg.src, cimg.x, cimg.y);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mctx.canvas, 0, 0);
        bctx.globalCompositeOperation = compositeOp(c.blend);
        bctx.drawImage(tctx.canvas, 0, 0);
        bctx.globalCompositeOperation = 'source-over';
        giveBack();
      }
      out = { src: bctx.canvas, x: 0, y: 0 };
    }
    target.globalAlpha = base.opacity;
    target.globalCompositeOperation = compositeOp(base.blend);
    target.drawImage(out.src, out.x, out.y);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
  };

  for (const unit of sceneUnits(project)) {
    if (unit.kind === 'stack') {
      drawStack(ctx, unit.base, unit.clipped, false);
      continue;
    }
    const g = unit.group;
    if (!g.visible && !opts.includeHidden) continue;
    // A group is drawn on its own, then faded and blended as one picture.
    const gctx = borrow(w, h);
    for (const st of unit.stacks) drawStack(gctx, st.base, st.clipped, g.locked);
    ctx.globalAlpha = g.opacity;
    ctx.globalCompositeOperation = compositeOp(g.blend);
    ctx.drawImage(gctx.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  poolUsed = 0;
  ctx.restore();
}
