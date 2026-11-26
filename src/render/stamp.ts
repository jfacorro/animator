// Textured brushes (Graphite, Chalk and saved brushes with grain), drawn the way
// paint apps do: as many small textured dabs along the line, on the GPU.
//
// Each dab has a tip shape that gives the edge its character, and its own size,
// angle and position jitter. The paper grain stays fixed to the page, and paint
// only sticks where the dab's coverage beats the grain there, so a light touch
// marks the paper's high points and pressing harder fills the grain in. Dabs
// are combined with "max" blending, so overlapping dabs don't darken the line.
// Nothing is read back from the GPU: the result is drawn straight onto the
// 2D canvas. Without WebGL 2, paintStroke falls back to its own textured path.
import { getStrokePoints } from 'perfect-freehand';
import type { GrainKind, Stroke } from '../model/project';

export interface Dab {
  x: number;
  y: number;
  /** Radius, in the same units as x and y. */
  r: number;
  angle: number;
  /** How much paint the dab carries, 0–1: from pressure. */
  flow: number;
}

/** How each grain's brush is stamped. Spacing, scatter and size jitter are fractions of the dab's diameter. */
const STYLE: Record<GrainKind, { spacing: number; scatter: number; sizeJitter: number }> = {
  pencil: { spacing: 0.06, scatter: 0.04, sizeJitter: 0.06 },
  chalk: { spacing: 0.09, scatter: 0.12, sizeJitter: 0.14 },
  canvas: { spacing: 0.08, scatter: 0.04, sizeJitter: 0.05 },
};

/** More dabs than any real stroke needs: a guard against runaway strokes. */
const MAX_DABS = 200_000;

/** A repeatable pseudo-random number in [0, 1) for dab `i`, so a stroke looks the same every time it's drawn. */
function rand(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The dabs along a freehand stroke, in page units, with the stroke's matrix applied. */
export function strokeDabs(s: Stroke, last = true): Dab[] {
  const style = STYLE[s.grain?.kind ?? 'pencil'];
  const pts = getStrokePoints(s.points, {
    size: s.size, thinning: s.thinning, smoothing: s.smoothing,
    streamline: Math.min(0.9, 0.2 + s.smoothing * 0.6), simulatePressure: s.simulatePressure, last,
  });
  if (!pts.length) return [];
  // Pressure: from the pen, or imitated from speed (slow is heavy, fast is light), as perfect-freehand does.
  const pressure: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < pts.length; i++) {
    if (!s.simulatePressure) { pressure.push(pts[i].pressure); continue; }
    const sp = Math.min(1, pts[i].distance / Math.max(1, s.size));
    const rp = Math.min(1, 1 - sp);
    prev = i === 0 ? 0.5 : Math.min(1, prev + (rp - prev) * (sp * 0.275));
    pressure.push(prev);
  }
  const radius = (p: number) => Math.max(0.3, s.size * (0.5 - s.thinning * (0.5 - p)));
  const m = s.matrix;
  const ms = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
  const dabs: Dab[] = [];
  const add = (x: number, y: number, p: number) => {
    const i = dabs.length;
    const r0 = radius(p) * (1 + (rand(i, 1) - 0.5) * 2 * style.sizeJitter);
    const a = rand(i, 2) * Math.PI * 2;
    const off = rand(i, 3) * style.scatter * r0 * 2;
    let px = x + Math.cos(a) * off, py = y + Math.sin(a) * off;
    if (m) [px, py] = [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
    dabs.push({ x: px, y: py, r: r0 * ms, angle: rand(i, 4) * Math.PI * 2, flow: 0.7 + 0.3 * p });
  };
  add(pts[0].point[0], pts[0].point[1], pressure[0]);
  // Walk the line, putting a dab down every `step` of distance.
  // `next` is how far along the current segment the next dab goes; what's left over carries on to the next segment.
  const stepAt = (p: number) => Math.max(0.35, radius(p) * 2 * style.spacing);
  let next = stepAt(pressure[0]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1].point, [x1, y1] = pts[i].point;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!(len > 0)) continue;
    // Written so a bad number (NaN) ends the walk instead of looping forever.
    while (next <= len && dabs.length < MAX_DABS) {
      const u = next / len;
      const p = pressure[i - 1] + (pressure[i] - pressure[i - 1]) * u;
      add(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, p);
      next += stepAt(p);
    }
    next = Number.isFinite(next) ? next - len : 1;
  }
  return dabs;
}

// ---- WebGL ----

const VERT = `#version 300 es
in vec2 corner;
in vec4 dab;
in float flow;
uniform mat3 toDevice;
uniform vec2 origin;
uniform vec2 area;
out vec2 uv;
out vec2 page;
out float vFlow;
out float vGrain;
void main() {
  float c = cos(dab.w), s = sin(dab.w);
  // The dab's radius on screen. Tiny dabs are kept at least a pixel wide, and the grain
  // bites less into them: otherwise a thin, fast line breaks up until nothing is left.
  float scale = sqrt(abs(toDevice[0][0] * toDevice[1][1] - toDevice[0][1] * toDevice[1][0]));
  float px = dab.z * scale;
  float r = max(px, 1.0) / scale;
  page = dab.xy + vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * r;
  uv = corner;
  vFlow = flow * min(1.0, 0.6 + 0.4 * px);
  vGrain = smoothstep(1.0, 5.0, px);
  vec2 dev = (toDevice * vec3(page, 1.0)).xy;
  vec2 clip = (dev - origin) / area * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
in vec2 page;
in float vFlow;
in float vGrain;
uniform sampler2D tip;
uniform sampler2D grain;
uniform float grainSize;
uniform float amount;
uniform float soft;
uniform vec3 color;
out vec4 outColor;
void main() {
  float d = length(uv);
  if (d > 1.0) discard;
  float a = texture(tip, uv * 0.5 + 0.5).a * vFlow * (1.0 - smoothstep(1.0 - soft, 1.0, d));
  float g = texture(grain, page / grainSize).a;
  float k = amount * (0.25 + 0.75 * vGrain);
  float v = clamp((a - g * k * 0.8) * (1.0 + 0.4 * vGrain), 0.0, 1.0);
  outColor = vec4(color, v);
}`;

interface GL {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  dabBuffer: WebGLBuffer;
  flowBuffer: WebGLBuffer;
  u: Record<string, WebGLUniformLocation | null>;
  tips: Map<GrainKind, WebGLTexture>;
  grains: Map<GrainKind, WebGLTexture>;
  max: number;
}
let state: GL | null = null;
let unavailable = false;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
}

function setup(): GL | null {
  if (state && state.gl.isContextLost()) state = null;
  if (state) return state;
  if (unavailable || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
    if (!gl) { unavailable = true; return null; }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) { unavailable = true; return null; }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { unavailable = true; return null; }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const cornerLoc = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(cornerLoc);
    gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);
    const dabBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, dabBuffer);
    const dabLoc = gl.getAttribLocation(program, 'dab');
    gl.enableVertexAttribArray(dabLoc);
    gl.vertexAttribPointer(dabLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(dabLoc, 1);
    const flowBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, flowBuffer);
    const flowLoc = gl.getAttribLocation(program, 'flow');
    gl.enableVertexAttribArray(flowLoc);
    gl.vertexAttribPointer(flowLoc, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(flowLoc, 1);
    gl.bindVertexArray(null);
    const u: GL['u'] = {};
    for (const name of ['toDevice', 'origin', 'area', 'tip', 'grain', 'grainSize', 'amount', 'soft', 'color']) u[name] = gl.getUniformLocation(program, name);
    canvas.addEventListener('webglcontextlost', () => { state = null; });
    state = {
      gl, canvas, program, vao, dabBuffer, flowBuffer, u, tips: new Map(), grains: new Map(),
      max: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number),
    };
    return state;
  } catch {
    unavailable = true;
    return null;
  }
}

function texture(gl: WebGL2RenderingContext, source: HTMLCanvasElement, repeat: boolean): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

/** The tip each grain's brush stamps with: its alpha is how much paint each spot of the dab lays down. */
export function tipShape(kind: GrainKind): HTMLCanvasElement {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  let seed = kind === 'pencil' ? 3 : kind === 'chalk' ? 5 : 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Edge wobble: a few random bumps around the rim (lumpy for chalk).
  const bumps = Array.from({ length: 7 }, () => [rnd() * Math.PI * 2, rnd()] as const);
  const lump = kind === 'chalk' ? 0.16 : kind === 'pencil' ? 0.06 : 0.04;
  const speck = kind === 'chalk' ? 0.35 : kind === 'pencil' ? 0.25 : 0.1;
  const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      let rim = 0.9;
      for (const [ph, w] of bumps) rim -= lump * w * (0.5 + 0.5 * Math.cos(ang * 3 + ph)) / bumps.length * 2;
      const shape = 1 - smooth(rim - 0.3, rim, d);
      const a = shape * (1 - speck * rnd());
      img.data[(y * n + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const colorCache = new Map<string, [number, number, number]>();
function rgb(color: string): [number, number, number] {
  let c = colorCache.get(color);
  if (c) return c;
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  const v = m ? parseInt(m[1], 16) : 0;
  c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  colorCache.set(color, c);
  return c;
}

/**
 * Paint a textured freehand stroke as dabs on the GPU, then onto `ctx`. Returns false when it
 * can't (no WebGL 2, or too big an area), and the caller draws it another way.
 * `grainTile` is the repeating paper texture (alpha: how much the paper resists paint), and
 * `grainScale` how much it's enlarged.
 */
export function paintStamped(ctx: CanvasRenderingContext2D, s: Stroke, live: boolean, grainTile: HTMLCanvasElement, grainScale: number): boolean {
  if (!s.grain || (s.kind ?? 'free') !== 'free') return false;
  try {
    return stamp(ctx, s as Stroke & { grain: NonNullable<Stroke['grain']> }, live, grainTile, grainScale);
  } catch (e) {
    // Anything going wrong on the GPU: stop using it, and let the caller draw the stroke its own way.
    console.error('Textured brush: GPU drawing failed, using the canvas instead.', e);
    unavailable = true;
    state = null;
    return false;
  }
}

function stamp(ctx: CanvasRenderingContext2D, s: Stroke & { grain: NonNullable<Stroke['grain']> }, live: boolean, grainTile: HTMLCanvasElement, grainScale: number): boolean {
  const g = setup();
  if (!g) return false;
  const dabs = strokeDabs(s, !live);
  if (!dabs.length) return true;
  const t = ctx.getTransform();
  const grow = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of dabs) {
    const dx = t.a * d.x + t.c * d.y + t.e, dy = t.b * d.x + t.d * d.y + t.f;
    const r = d.r * grow * 1.42 + 2;
    x0 = Math.min(x0, dx - r); y0 = Math.min(y0, dy - r); x1 = Math.max(x1, dx + r); y1 = Math.max(y1, dy + r);
  }
  const { width, height } = ctx.canvas;
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
  const bw = Math.min(width, Math.ceil(x1)) - bx, bh = Math.min(height, Math.ceil(y1)) - by;
  if (bw <= 0 || bh <= 0) return true;
  if (bw > g.max || bh > g.max) return false;
  const { gl, canvas } = g;
  if (canvas.width < bw || canvas.height < bh) {
    canvas.width = Math.min(g.max, Math.max(canvas.width, 2 ** Math.ceil(Math.log2(bw))));
    canvas.height = Math.min(g.max, Math.max(canvas.height, 2 ** Math.ceil(Math.log2(bh))));
  }
  const kind = s.grain.kind;
  let tip = g.tips.get(kind);
  if (!tip) { tip = texture(gl, tipShape(kind), false); g.tips.set(kind, tip); }
  let grain = g.grains.get(kind);
  if (!grain) { grain = texture(gl, grainTile, true); g.grains.set(kind, grain); }

  const data = new Float32Array(dabs.length * 4), flow = new Float32Array(dabs.length);
  dabs.forEach((d, i) => { data.set([d.x, d.y, d.r, d.angle], i * 4); flow[i] = d.flow; });

  gl.viewport(0, 0, bw, bh);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, bw, bh);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(g.program);
  gl.bindVertexArray(g.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.dabBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.flowBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, flow, gl.DYNAMIC_DRAW);
  gl.uniformMatrix3fv(g.u.toDevice, false, [t.a, t.b, 0, t.c, t.d, 0, t.e, t.f, 1]);
  gl.uniform2f(g.u.origin, bx, by);
  gl.uniform2f(g.u.area, bw, bh);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tip);
  gl.uniform1i(g.u.tip, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, grain);
  gl.uniform1i(g.u.grain, 1);
  gl.uniform1f(g.u.grainSize, grainTile.width * grainScale);
  gl.uniform1f(g.u.amount, Math.min(1, s.grain.amount));
  gl.uniform1f(g.u.soft, Math.min(1, 0.25 + (s.softness ?? 0) * 0.75));
  gl.uniform3f(g.u.color, ...rgb(s.color));
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MAX);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dabs.length);
  gl.bindVertexArray(null);
  if (gl.isContextLost()) { state = null; return false; }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= s.opacity;
  ctx.globalCompositeOperation = s.atop ? 'source-atop' : 'source-over';
  // The GPU drew at the canvas's bottom-left (its y axis points up).
  ctx.drawImage(canvas, 0, canvas.height - bh, bw, bh, bx, by, bw, bh);
  ctx.restore();
  return true;
}
