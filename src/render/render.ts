import { getStroke } from 'perfect-freehand';
import { cameraAt, cameraMatrix, hasCamera } from '../model/camera';
import { compositeOp, sceneUnits } from '../model/groups';
import { celIndexAt, isBlank, type Drawing, type FontId, type GrainKind, type Layer, type Paint, type Project, type Stroke } from '../model/project';

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
    // Usually two points; bent shapes (Warp, Liquify) keep their outline as many.
    path.moveTo(a[0], a[1]);
    for (let i = 1; i < s.points.length; i++) path.lineTo(s.points[i][0], s.points[i][1]);
    if (s.filled) path.closePath();
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

/**
 * The selected strokes' shape as a solid silhouette, cropped to its box, so the
 * selection can be outlined along its real edges. Eraser strokes are left out.
 */
export function selectionMask(strokes: Stroke[], indices: number[], box: { x0: number; y0: number; x1: number; y1: number }) {
  const pad = 4;
  const x = Math.floor(box.x0) - pad;
  const y = Math.floor(box.y0) - pad;
  const width = Math.ceil(box.x1) + pad - x;
  const height = Math.ceil(box.y1) + pad - y;
  if (width <= 0 || height <= 0 || width * height > 16e6) return null;
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d')!;
  ctx.translate(-x, -y);
  for (const i of indices) {
    const s = strokes[i];
    if (!s || s.erase) continue;
    paintStroke(ctx, { ...s, opacity: 1, softness: 0, color: '#000', gradient: undefined });
  }
  return { url: c.toDataURL('image/png'), x, y, width, height };
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
  const sheet = fillSheet;
  const putFills = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(sheet, 0, 0, width, height, 0, 0, width, height);
    ctx.restore();
  };
  // An alpha-locked stroke keeps to the fills too, so they go under the lines before it.
  const firstLocked = lines.findIndex((s) => s.atop);
  lines.forEach((s, i) => {
    if (i === firstLocked) putFills();
    paintStroke(ctx, s);
  });
  if (firstLocked < 0) putFills();
}

/** Paint one stroke. `live` skips caching for a stroke still being drawn. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, live = false) {
  const kind = s.kind ?? 'free';
  if (kind === 'text') {
    paintText(ctx, s);
    return;
  }
  if (s.grain && s.grain.amount > 0 && !s.erase && kind !== 'fill') {
    paintGrainy(ctx, s, live);
    return;
  }
  const path = strokePath(s, live);
  ctx.save();
  if (s.matrix) ctx.transform(...s.matrix);
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : s.atop ? 'source-atop' : 'source-over';
  if (!s.erase && s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= s.opacity;
  // Soft edges: blur in canvas pixels, scaled by how much the stroke's matrix (and any zoom) enlarges it.
  if (s.softness && !s.erase && 'filter' in ctx) {
    const t = ctx.getTransform();
    const grow = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
    ctx.filter = `blur(${(s.size * s.softness * 0.3 * grow).toFixed(2)}px)`;
  }
  const color = s.erase ? '#000' : s.color;
  const outline = (kind === 'line' || kind === 'rect' || kind === 'ellipse') && !s.filled;
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

// Textured brushes: the stroke is painted on its own, then a grain pattern is
// knocked out of it, and the result laid down like any other stroke.
let grainSheet: HTMLCanvasElement | null = null;
const grainTiles = new Map<GrainKind, HTMLCanvasElement>();

/** A repeating 256 px tile of grain: where it's dark, paint is taken away. */
function grainTile(kind: GrainKind): HTMLCanvasElement {
  let tile = grainTiles.get(kind);
  if (tile) return tile;
  const n = 256;
  tile = makeCanvas(n, n);
  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  let seed = kind === 'pencil' ? 7 : kind === 'chalk' ? 11 : 13;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Value noise: random values on a coarse grid, smoothly blended, wrapping at the edges.
  const coarse = (cells: number) => {
    const v = Array.from({ length: cells * cells }, rand);
    return (x: number, y: number) => {
      const fx = (x / n) * cells, fy = (y / n) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => v[((j % cells) * cells) + (i % cells)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const big = coarse(16), mid = coarse(64), fine = coarse(128);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let k: number;
      if (kind === 'pencil') k = Math.max(0, (fine(x, y) * 0.7 + mid(x, y) * 0.3 - 0.45) * 2.4);
      else if (kind === 'chalk') k = Math.max(0, (big(x, y) * 0.5 + mid(x, y) * 0.3 + fine(x, y) * 0.2 - 0.4) * 2.2);
      else {
        // Canvas: a woven grid with a little noise.
        const weave = (Math.sin((x / n) * Math.PI * 2 * 64) * Math.sin((y / n) * Math.PI * 2 * 64) + 1) / 2;
        k = Math.max(0, weave * 0.7 + fine(x, y) * 0.3 - 0.35) * 1.6;
      }
      const o = (y * n + x) * 4;
      img.data[o + 3] = Math.min(255, k * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTiles.set(kind, tile);
  return tile;
}

function paintGrainy(ctx: CanvasRenderingContext2D, s: Stroke, live: boolean) {
  const { width, height } = ctx.canvas;
  if (!grainSheet) grainSheet = makeCanvas(width, height);
  if (grainSheet.width < width || grainSheet.height < height) {
    grainSheet.width = Math.max(grainSheet.width, width);
    grainSheet.height = Math.max(grainSheet.height, height);
  }
  // Only the part of the canvas this stroke can touch.
  const t = ctx.getTransform();
  const m = s.matrix;
  const grow = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) * (m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1);
  const pad = s.size * grow * (1 + (s.softness ?? 0)) + 4;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) {
    const px = m ? m[0] * p[0] + m[2] * p[1] + m[4] : p[0];
    const py = m ? m[1] * p[0] + m[3] * p[1] + m[5] : p[1];
    const dx = t.a * px + t.c * py + t.e, dy = t.b * px + t.d * py + t.f;
    x0 = Math.min(x0, dx); y0 = Math.min(y0, dy); x1 = Math.max(x1, dx); y1 = Math.max(y1, dy);
  }
  const bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
  const bw = Math.min(width, Math.ceil(x1 + pad)) - bx, bh = Math.min(height, Math.ceil(y1 + pad)) - by;
  if (bw <= 0 || bh <= 0) return;
  const g = grainSheet.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(bx, by, bw, bh);
  g.setTransform(t);
  paintStroke(g, { ...s, grain: undefined, opacity: undefined, atop: undefined }, live);
  // The grain is anchored to the page, so it stays put under the brush like paper does.
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = Math.min(1, s.grain!.amount);
  const pattern = g.createPattern(grainTile(s.grain!.kind), 'repeat');
  if (pattern) {
    const scale = Math.max(0.5, s.size / 24);
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
    g.fillStyle = pattern;
    // Cover the stroke's area in page units.
    const inv = t.inverse();
    const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(([x, y]) => [inv.a * x + inv.c * y + inv.e, inv.b * x + inv.d * y + inv.f]);
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    g.fillRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= s.opacity;
  ctx.globalCompositeOperation = s.atop ? 'source-atop' : 'source-over';
  ctx.drawImage(grainSheet, bx, by, bw, bh, bx, by, bw, bh);
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
  /** Already in the output canvas's own pixels (a scratch sheet, or a picture drawn for the current view). */
  sheet?: boolean;
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
  return baked.get(p.data) ?? live.get(p.data) ?? loadedImage(p.data);
}

/** Wait until every paint drawing can be drawn (before exporting, which draws frames straight away). */
export async function paintReady(project: Project): Promise<void> {
  const waits: Promise<unknown>[] = [];
  const paints = [...Object.values(project.drawings).map((d) => d.paint), ...project.layers.map((l) => l.mask)];
  for (const p of paints) {
    if (!p || paintSource(p)) continue;
    loadedImage(p.data); // starts decoding
    const img = images.get(p.data);
    if (img) waits.push(img.decode().catch(() => undefined));
  }
  await Promise.all(waits);
}

/** A paint drawing's pixels on a project-size sheet. Throws while its image is still decoding. */
export function paintSheet(base: Paint | undefined, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  if (base) {
    const src = paintSource(base);
    if (!src) throw new Error('The drawing is still loading. Try again in a moment.');
    c.getContext('2d', { willReadFrequently: true })!.drawImage(src, base.x, base.y);
  }
  return c;
}

/**
 * Pixels inside `region` (a closed outline) taken from `sheet`, moved by `m`.
 * `keep` leaves the original in place (duplicate); `remove` drops the region (delete).
 */
export function movePaintRegion(sheet: HTMLCanvasElement, region: [number, number][], m: Matrix, opts: { keep?: boolean; remove?: boolean } = {}): HTMLCanvasElement {
  const { width: w, height: h } = sheet;
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const outline = () => {
    ctx.beginPath();
    region.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.drawImage(sheet, 0, 0);
  if (!opts.keep) {
    ctx.save();
    outline();
    ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
  }
  if (!opts.remove) {
    ctx.save();
    ctx.setTransform(...m);
    ctx.imageSmoothingQuality = 'high';
    outline();
    ctx.clip();
    ctx.drawImage(sheet, 0, 0);
    ctx.restore();
  }
  return out;
}

// The one sheet being dragged right now, kept apart so it never pushes real paint out of `baked`.
const live = new Map<string, HTMLCanvasElement>();
let liveCounter = 0;
/** Show a sheet as a paint drawing without encoding it (while dragging a selection). */
export function livePaint(c: HTMLCanvasElement): Paint {
  const data = `live:${++liveCounter}`;
  live.clear();
  live.set(data, c);
  return { data, x: 0, y: 0, width: c.width, height: c.height };
}

/**
 * Paint `strokes` onto a paint drawing's pixels (`base`) and return the new pixels,
 * cropped to where there is paint, or null when nothing is left. Fills go under
 * what's already there, like on stroke layers; the eraser really removes paint.
 */
export function bakePaint(base: Paint | undefined, strokes: Stroke[], w: number, h: number): Paint | null {
  const c = paintSheet(base, w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  // Alpha-locked paint keeps to what's already there, so it goes on in order, onto the same sheet.
  if (strokes.some((s) => s.atop)) for (const s of strokes) paintStroke(ctx, s);
  else paintDrawing(ctx, strokes);
  return encodePaint(c, w, h);
}

/** A project-size sheet of pixels as a paint drawing, cropped to where there is paint (null when empty). */
export function encodePaint(c: HTMLCanvasElement, w: number, h: number): Paint | null {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
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
  /** Strokes being painted on a layer's mask (hiding, or revealing with the eraser). */
  liveMask?: { layerId: string; strokes: Stroke[] } | null;
  /** Show this layer's mask as a red tint (while it's being painted). */
  showMask?: string | null;
  /** Show reference image layers (on screen only: never in exports). */
  references?: boolean;
  /** Frame the scene through the camera (playback and export). */
  camera?: boolean;
  /**
   * Draw for the screen instead of at project size: `matrix` maps project px
   * to the output canvas's px. Line layers are redrawn from their vectors at
   * that scale, so they stay sharp at any zoom. The caller clears the canvas.
   */
  view?: { matrix: Matrix; width: number; height: number } | null;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** a·b: apply b first, then a. */
export function mulMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// Drawings drawn for the current view, in screen pixels. They're only good
// for one zoom and position, so the whole set is dropped when the view changes.
const VIEW_BYTES = (IOS ? 48 : 160) * 1024 * 1024;
const viewPics = new Map<Drawing, Pic | null>();
let viewKey = '';
let viewBytes = 0;
/** Onion skins for the current view: a drawing's view picture in one flat colour. */
const viewTints = new Map<string, { d: Drawing; pic: Pic | null }>();
function dropViewPics() {
  for (const p of viewPics.values()) retire(p);
  viewPics.clear();
  for (const t of viewTints.values()) retire(t.pic);
  viewTints.clear();
  viewBytes = 0;
}

/** A drawing redrawn for the view in one flat colour, for onion skins, so they stay sharp when zoomed in. */
function viewTint(d: Drawing, color: string, m: Matrix, ow: number, oh: number, w: number, h: number): Pic | null {
  const key = `${d.id}|${color}`;
  const hit = viewTints.get(key);
  if (hit && hit.d === d) return hit.pic;
  if (hit) { viewBytes -= picBytes(hit.pic); retire(hit.pic); }
  const plain = viewBitmap(d, m, ow, oh, w, h);
  let pic: Pic | null = null;
  if (plain) {
    const c = bitmapCanvas(plain.src.width, plain.src.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(plain.src, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    pic = { src: c, x: plain.x, y: plain.y, sheet: true };
  }
  viewTints.set(key, { d, pic });
  viewBytes += picBytes(pic);
  return pic;
}

/** A drawing redrawn from its vectors through `m` onto a canvas of ow × oh px. */
function viewBitmap(d: Drawing, m: Matrix, ow: number, oh: number, w: number, h: number): Pic | null {
  const sheet = d.paint ? paintSource(d.paint) : null;
  if (d.paint && !sheet) return null;
  if (viewPics.has(d)) {
    const hit = viewPics.get(d)!;
    viewPics.delete(d);
    viewPics.set(d, hit);
    return hit;
  }
  let pic: Pic | null = null;
  const box = drawingBox(d, w, h);
  if (box) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
      const sx = m[0] * px + m[2] * py + m[4];
      const sy = m[1] * px + m[3] * py + m[5];
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    const bx = Math.max(0, Math.floor(x0) - 1);
    const by = Math.max(0, Math.floor(y0) - 1);
    const bw = Math.min(ow, Math.ceil(x1) + 1) - bx;
    const bh = Math.min(oh, Math.ceil(y1) + 1) - by;
    if (bw > 0 && bh > 0) {
      const c = bitmapCanvas(round64(bw), round64(bh));
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, -bx, -by);
      ctx.transform(...m);
      if (sheet && d.paint) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sheet, d.paint.x, d.paint.y);
      }
      // Lines from their vectors. Bucket fills are pixels by nature (the area
      // the bucket found), so they're drawn at project size and smoothed into
      // place under the lines, instead of showing their pixel steps.
      const { fills, lines } = drawingPasses(d.strokes);
      for (const s of lines) paintStroke(ctx, s);
      if (fills.length) {
        const fc = bitmapCanvas(round64(box.w), round64(box.h));
        const fctx = fc.getContext('2d')!;
        fctx.translate(-box.x, -box.y);
        for (const s of fills) paintStroke(fctx, s);
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(fc, box.x, box.y);
        ctx.restore();
        retire({ src: fc, x: 0, y: 0 });
      }
      pic = { src: c, x: bx, y: by, sheet: true };
    }
  }
  viewPics.set(d, pic);
  viewBytes += picBytes(pic);
  while (viewBytes > VIEW_BYTES && viewPics.size > 1) {
    const [oldest, gone] = viewPics.entries().next().value!;
    viewBytes -= picBytes(gone);
    viewPics.delete(oldest);
    retire(gone);
  }
  return pic;
}

// Scratch canvases for groups and clipping, reused between frames.
// The screen view keeps its own set, so it and project-size frames don't keep
// resizing each other's canvases.
const projectPool: HTMLCanvasElement[] = [];
const viewPool: HTMLCanvasElement[] = [];
let pool = projectPool;
let poolUsed = 0;
function borrow(w: number, h: number): CanvasRenderingContext2D {
  let c = pool[poolUsed];
  if (!c || c.width !== w || c.height !== h) {
    if (c) c.width = c.height = 0;
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

/** Paint one frame of the scene, bottom layer first, at project size (or for the screen: see `view`). */
export function composeFrame(ctx: CanvasRenderingContext2D, project: Project, frame: number, opts: ComposeOptions) {
  const { width: w, height: h } = project;
  const cam = opts.camera && hasCamera(project) ? cameraAt(project, frame) : null;
  const C = cam ? cameraMatrix(cam, w, h) : IDENTITY;
  // A camera zoomed in enlarges the scene: redraw lines through it, like a
  // zoomed view, instead of enlarging their project-size pictures.
  const view = opts.view ?? (cam && cam.zoom > 1.01 ? { matrix: IDENTITY, width: w, height: h } : null);
  const ow = view ? view.width : w;
  const oh = view ? view.height : h;
  const V = view ? view.matrix : IDENTITY;
  // Where project-space pictures go, and where scratch sheets go, on the output
  // canvas and on scratch sheets. At project size, scratch sheets are in project
  // space and the camera applies when they reach the output. For the screen,
  // sheets are in screen pixels and pictures go through camera and view.
  const VC = mulMatrix(V, C);
  const outPic = VC;
  const outSheet = view ? IDENTITY : C;
  const scratchPic = view ? VC : IDENTITY;
  if (view) {
    const key = `${VC.map((v) => v.toFixed(4)).join(',')}|${ow}x${oh}`;
    if (key !== viewKey) { dropViewPics(); viewKey = key; }
  }

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(...V);
  if (opts.paper) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
  } else if (!opts.view) {
    ctx.clearRect(0, 0, w, h);
  }
  pool = view ? viewPool : projectPool;
  poolUsed = 0;

  const scratch = () => {
    const c = borrow(ow, oh);
    c.setTransform(...scratchPic);
    return c;
  };
  /** Draw a picture (or scratch sheet) onto the output or a scratch sheet. */
  const put = (t: CanvasRenderingContext2D, p: Pic) => {
    const out = t === ctx;
    t.setTransform(...(p.sheet ? (out ? outSheet : IDENTITY) : (out ? outPic : scratchPic)));
    t.drawImage(p.src, p.x, p.y);
  };
  const sheetOf = (t: CanvasRenderingContext2D): Pic => ({ src: t.canvas, x: 0, y: 0, sheet: true });
  /** A drawing's picture: redrawn for the screen when it has lines, else the cached one. */
  const drawingPic = (d: Drawing): Pic | null => (view && d.strokes.length ? viewBitmap(d, VC, ow, oh, w, h) : drawingBitmap(d, w, h));

  const shown = (l: Layer) => l.visible || !!opts.includeHidden;

  /** The layer's mask on a scratch sheet (with any mask stroke in progress), or null when it hides nothing. */
  const maskSheet = (layer: Layer): CanvasRenderingContext2D | null => {
    const liveStrokes = opts.liveMask?.layerId === layer.id ? opts.liveMask.strokes : null;
    if (layer.mask === undefined || (layer.maskOff && !liveStrokes)) return null;
    const src = layer.mask ? paintSource(layer.mask) : null;
    if (!src && !liveStrokes?.length) return null;
    const m = scratch();
    if (src && layer.mask) m.drawImage(src, layer.mask.x, layer.mask.y);
    if (liveStrokes) for (const s of liveStrokes) paintStroke(m, s, true);
    return m;
  };

  /** The layer's picture with its mask applied. */
  const picture = (layer: Layer): Pic | null => {
    const img = layerPicture(layer);
    if (!img || layer.reference) return img;
    const mark = poolUsed;
    const m = maskSheet(layer);
    if (!m) { poolUsed = mark; return img; }
    const t = scratch();
    put(t, img);
    t.globalCompositeOperation = 'destination-out';
    put(t, sheetOf(m));
    t.globalCompositeOperation = 'source-over';
    return sheetOf(t);
  };

  /** The layer's picture at this frame (with any stroke in progress), or null when empty. */
  const layerPicture = (layer: Layer): Pic | null => {
    const ref = layer.reference;
    if (ref) {
      const img = opts.references ? loadedImage(ref.data) : null;
      if (!img) return null;
      const rctx = scratch();
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(img, ref.x, ref.y, ref.width, ref.height);
      return sheetOf(rctx);
    }
    const i = celIndexAt(layer, frame);
    const id = i >= 0 ? layer.cels[i].drawingId : null;
    const d = id ? project.drawings[id] : null;
    if (opts.live && opts.live.layerId === layer.id) {
      // Base drawing plus the stroke in progress, so the eraser previews too.
      const sctx = scratch();
      const base = d ? drawingPic(d) : null;
      if (base) put(sctx, base);
      sctx.setTransform(...scratchPic);
      for (const s of opts.live.strokes) paintStroke(sctx, s, true);
      return sheetOf(sctx);
    }
    return d && !isBlank(d) ? drawingPic(d) : null;
  };

  const onionSkins = (target: CanvasRenderingContext2D, layer: Layer, locked: boolean) => {
    const onion = opts.onion;
    if (!onion || layer.reference || layer.everyFrame || !(onion.layerId === layer.id || (onion.layerId === null && !locked))) return;
    const i = celIndexAt(layer, frame);
    // Past the end of the layer, the previous drawings are the last ones.
    const anchor = i >= 0 ? i : layer.cels.length;
    const draw = (index: number, color: string, step: number, count: number) => {
      const cel = layer.cels[index];
      const d = cel?.drawingId ? project.drawings[cel.drawingId] : null;
      if (!d || isBlank(d)) return;
      target.globalAlpha = (onion.opacity ?? 0.45) * (1 - (step - 1) / (count + 0.5));
      target.globalCompositeOperation = 'source-over';
      const t = view && d.strokes.length ? viewTint(d, color, VC, ow, oh, w, h) : tintedBitmap(d, color, w, h);
      if (t) put(target, t);
    };
    for (let k = onion.before; k >= 1; k--) draw(anchor - k, onion.beforeColor ?? ONION_BEFORE, k, onion.before);
    if (i >= 0) for (let k = onion.after; k >= 1; k--) draw(anchor + k, onion.afterColor ?? ONION_AFTER, k, onion.after);
    target.globalAlpha = 1;
  };

  /** Draw a base layer with the layers clipped to it. */
  const drawStack = (target: CanvasRenderingContext2D, base: Layer, clipped: Layer[], groupLocked: boolean) => {
    if (!shown(base)) return;
    // Scratch sheets borrowed in here are done with once the stack is drawn.
    const mark = poolUsed;
    onionSkins(target, base, base.locked || groupLocked);
    const img = picture(base);
    const clips = clipped.filter(shown);
    for (const c of clips) onionSkins(target, c, c.locked || groupLocked);
    if (!img) { poolUsed = mark; return; }
    let out: Pic = img;
    if (clips.length) {
      // The base at full size: the mask clipped layers are cut to.
      const mctx = scratch();
      put(mctx, img);
      const bctx = scratch();
      put(bctx, sheetOf(mctx));
      for (const c of clips) {
        const inner = poolUsed;
        const cimg = picture(c);
        if (!cimg) continue;
        // The clipped layer, cut to where the base has paint, then blended onto it.
        const tctx = scratch();
        tctx.globalAlpha = c.opacity;
        put(tctx, cimg);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = 'destination-in';
        put(tctx, sheetOf(mctx));
        bctx.globalCompositeOperation = compositeOp(c.blend);
        put(bctx, sheetOf(tctx));
        bctx.globalCompositeOperation = 'source-over';
        poolUsed = inner;
      }
      out = sheetOf(bctx);
    }
    target.globalAlpha = base.opacity;
    target.globalCompositeOperation = compositeOp(base.blend);
    put(target, out);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    poolUsed = mark;
  };

  for (const unit of sceneUnits(project)) {
    if (unit.kind === 'stack') {
      drawStack(ctx, unit.base, unit.clipped, false);
      continue;
    }
    const g = unit.group;
    if (!g.visible && !opts.includeHidden) continue;
    // A group is drawn on its own, then faded and blended as one picture.
    const gctx = scratch();
    for (const st of unit.stacks) drawStack(gctx, st.base, st.clipped, g.locked);
    ctx.globalAlpha = g.opacity;
    ctx.globalCompositeOperation = compositeOp(g.blend);
    put(ctx, sheetOf(gctx));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    poolUsed = 0;
  }
  poolUsed = 0;
  // While a mask is painted, show it as a red tint, like a rubylith.
  const masked = opts.showMask ? findLayerIn(project, opts.showMask) : null;
  if (masked) {
    const m = maskSheet({ ...masked, maskOff: false });
    if (m) {
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = 'source-in';
      m.fillStyle = '#e0303a';
      m.fillRect(0, 0, m.canvas.width, m.canvas.height);
      ctx.globalAlpha = 0.45;
      put(ctx, sheetOf(m));
      ctx.globalAlpha = 1;
    }
    poolUsed = 0;
  }
  ctx.restore();
}

function findLayerIn(project: Project, id: string): Layer | null {
  return project.layers.find((l) => l.id === id) ?? null;
}

/** Liquify on paint: pixels within `radius` of `at` slide along by `delta`, less towards the edge. */
export function pushPixels(sheet: HTMLCanvasElement, at: [number, number], delta: [number, number], radius: number) {
  const { width: w, height: h } = sheet;
  const reach = Math.ceil(radius + Math.hypot(delta[0], delta[1]));
  const bx = Math.max(0, Math.floor(at[0] - reach)), by = Math.max(0, Math.floor(at[1] - reach));
  const bw = Math.min(w, Math.ceil(at[0] + reach)) - bx, bh = Math.min(h, Math.ceil(at[1] + reach)) - by;
  if (bw <= 0 || bh <= 0) return;
  const ctx = sheet.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(bx, by, bw, bh);
  const dst = img.data;
  const src = new Uint8ClampedArray(dst);
  const r2 = radius * radius;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const dx = bx + x + 0.5 - at[0], dy = by + y + 0.5 - at[1];
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const f = (1 - d2 / r2) ** 2;
      // Where this pixel's colour comes from: back along the push.
      const sx = Math.min(bw - 1.001, Math.max(0, x - delta[0] * f));
      const sy = Math.min(bh - 1.001, Math.max(0, y - delta[1] * f));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * bw + x0) * 4, i10 = i00 + 4, i01 = i00 + bw * 4, i11 = i01 + 4;
      const o = (y * bw + x) * 4;
      // Blend premultiplied, so see-through pixels don't bleed dark edges.
      let a = 0;
      const acc = [0, 0, 0];
      for (const [i, wgt] of [[i00, (1 - fx) * (1 - fy)], [i10, fx * (1 - fy)], [i01, (1 - fx) * fy], [i11, fx * fy]] as const) {
        const al = src[i + 3] * wgt;
        a += al;
        acc[0] += src[i] * al; acc[1] += src[i + 1] * al; acc[2] += src[i + 2] * al;
      }
      dst[o + 3] = a;
      if (a > 0) { dst[o] = acc[0] / a; dst[o + 1] = acc[1] / a; dst[o + 2] = acc[2] / a; }
    }
  }
  ctx.putImageData(img, bx, by);
}

/**
 * Warp on paint: the pixels inside `region` bent through `warp` (a function from
 * where a point was to where it goes, over `box`), drawn as a mesh of small triangles.
 */
export function warpPaintRegion(sheet: HTMLCanvasElement, region: [number, number][], box: { x0: number; y0: number; x1: number; y1: number }, warp: (x: number, y: number) => [number, number]): HTMLCanvasElement {
  const { width: w, height: h } = sheet;
  // The selected pixels on their own, and the sheet without them.
  const piece = makeCanvas(w, h);
  const pctx = piece.getContext('2d')!;
  const outline = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    region.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  };
  outline(pctx);
  pctx.clip();
  pctx.drawImage(sheet, 0, 0);
  const out = movePaintRegion(sheet, region, [1, 0, 0, 1, 0, 0], { remove: true });
  const ctx = out.getContext('2d')!;
  const N = 12;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const at = (i: number, j: number): [number, number] => [box.x0 + (bw * i) / N, box.y0 + (bh * j) / N];
  const tri = (s: [number, number][], d: [number, number][]) => {
    // The affine map taking triangle s onto triangle d, with a hair of overlap to hide seams.
    const [[x0, y0], [x1, y1], [x2, y2]] = s;
    const [[u0, v0], [u1, v1], [u2, v2]] = d;
    const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!den) return;
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den;
    const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den;
    const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
    const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
    const e = u0 - a * x0 - c * y0, f = v0 - b * x0 - dd * y0;
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
    const grow = (p: [number, number]): [number, number] => { const l = Math.hypot(p[0] - cx, p[1] - cy) || 1; return [p[0] + ((p[0] - cx) / l) * 0.6, p[1] + ((p[1] - cy) / l) * 0.6]; };
    ctx.save();
    ctx.beginPath();
    d.map(grow).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, b, c, dd, e, f);
    ctx.drawImage(piece, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const s00 = at(i, j), s10 = at(i + 1, j), s01 = at(i, j + 1), s11 = at(i + 1, j + 1);
      const [d00, d10, d01, d11] = [s00, s10, s01, s11].map(([x, y]) => warp(x, y));
      tri([s00, s10, s11], [d00, d10, d11]);
      tri([s00, s11, s01], [d00, d11, d01]);
    }
  }
  return out;
}

/** A round, soft-edged mask of radius r on a 2r × 2r canvas, at `alpha` in the middle. */
function softDab(r: number, alpha: number): HTMLCanvasElement {
  const size = Math.max(2, Math.ceil(r * 2));
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.5, `rgba(0,0,0,${alpha * 0.8})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * Mix `patch` (2r × 2r, already masked) into `sheet` centred on `at`: where the
 * patch's mask is strong the patch replaces the sheet, fading to no change.
 */
function mixInto(sheet: HTMLCanvasElement, patch: HTMLCanvasElement, mask: HTMLCanvasElement, at: [number, number]) {
  const ctx = sheet.getContext('2d')!;
  const x = Math.round(at[0] - mask.width / 2), y = Math.round(at[1] - mask.height / 2);
  ctx.save();
  // Take away as much of the old colour as the new one brings…
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, x, y);
  // …and add the new one (premultiplied, so the two add up exactly).
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(patch, x, y);
  ctx.restore();
}

/** The sheet's pixels in a 2r × 2r square around `at`, cut to `mask`. */
function grab(sheet: HTMLCanvasElement, at: [number, number], mask: HTMLCanvasElement, filter?: string): HTMLCanvasElement {
  const c = makeCanvas(mask.width, mask.height);
  const ctx = c.getContext('2d')!;
  if (filter && 'filter' in ctx) ctx.filter = filter;
  ctx.drawImage(sheet, -Math.round(at[0] - mask.width / 2), -Math.round(at[1] - mask.height / 2));
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}

/** Smudge on paint: drag the colour under the brush from `from` towards `to`, like a finger. */
export function smudgeStep(sheet: HTMLCanvasElement, from: [number, number], to: [number, number], radius: number, strength: number) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const step = Math.max(1, radius / 4);
  const n = Math.max(1, Math.ceil(dist / step));
  const mask = softDab(radius, strength);
  for (let i = 1; i <= n; i++) {
    const a: [number, number] = [from[0] + ((to[0] - from[0]) * (i - 1)) / n, from[1] + ((to[1] - from[1]) * (i - 1)) / n];
    const b: [number, number] = [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n];
    mixInto(sheet, grab(sheet, a, mask), mask, b);
  }
}

/** Blur on paint: soften the paint under the brush. */
export function blurStep(sheet: HTMLCanvasElement, at: [number, number], radius: number, strength: number) {
  const mask = softDab(radius, strength);
  mixInto(sheet, grab(sheet, at, mask, `blur(${Math.max(1, radius / 6).toFixed(1)}px)`), mask, at);
}
