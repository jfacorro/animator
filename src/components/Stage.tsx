import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { scaleAbout, strokeBounds, strokesInLasso, translate, unionBoxes, apply, type Box, type Matrix, type Vec } from '../model/geometry';
import { addStroke, drawingAt, transformStrokes, type Point, type Project, type Stroke } from '../model/project';
import { floodFillSpans } from '../render/fill';
import { catchUp, stabilize } from '../model/brushes';
import { cameraAt, cameraCorners, hasCamera, setCameraKey, type CameraView } from '../model/camera';
import { composeFrame, paintStroke, type OnionOptions } from '../render/render';
import { FIT_VIEW, flipAt, pinch, rotateAt, screenToLocal, snapRotation, viewTransform, zoomAt, type View } from '../model/view';
import * as I from './Icons';

export type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'eyedropper' | 'select' | 'camera';

export interface BrushSettings {
  color: string;
  size: number;
  eraserSize: number;
  smoothing: number;
  pressure: boolean;
  /** 0–1: see-through to solid. Also used by shapes and fills. */
  opacity: number;
  /** 0–1: how far the line trails the pointer to steady it. */
  stabilizer: number;
  /** Width change with pressure, used when `pressure` is on. */
  thinning: number;
  /** 0–1: blurred edge. */
  softness: number;
  /** Rectangles and ellipses are filled instead of outlined. */
  fillShapes: boolean;
}

interface Props {
  project: Project;
  frame: number;
  activeLayerId: string;
  tool: Tool;
  brush: BrushSettings;
  onion: OnionOptions | null;
  /** Stroke indices selected in the current drawing (select tool). */
  selection: number[] | null;
  onSelectionChange: (selection: number[] | null) => void;
  /** Apply an edit to the project as one undo step. */
  onCommit: (edit: (p: Project) => Project) => void;
  onPickColor: (color: string) => void;
  /** Space is held: dragging pans instead of drawing. */
  panKey: boolean;
  /** Called when a Space-drag pans, so letting go of Space doesn't toggle playback. */
  onPanned: () => void;
  /** During playback the scene is framed through the camera. */
  playing: boolean;
}

/** Navigation gestures: pan with one pointer, or pinch (zoom/rotate/pan) with two fingers. */
type Nav =
  | { type: 'pan'; pointerId: number; last: Vec }
  | { type: 'pinch'; ids: [number, number]; start: [Vec, Vec]; view: View };

type Gesture =
  | { type: 'stroke'; pointerId: number; stroke: Stroke; tip: Point; pointer: Point }
  | { type: 'shape'; pointerId: number; stroke: Stroke; start: Vec }
  | { type: 'lasso'; pointerId: number; points: Vec[] }
  | { type: 'move'; pointerId: number; start: Vec; matrix: Matrix }
  | { type: 'scale'; pointerId: number; origin: Vec; corner: Vec; matrix: Matrix }
  | { type: 'camera'; pointerId: number; mode: 'move' | 'zoom'; start: Vec; base: CameraView; view: CameraView };

const SHAPES: Tool[] = ['line', 'rect', 'ellipse'];
const EDITS: Tool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'select'];

export function Stage({ project, frame, activeLayerId, tool, brush, onion, selection, onSelectionChange, onCommit, onPickColor, panKey, onPanned, playing }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rafRef = useRef(0);
  const navRef = useRef<Nav | null>(null);
  /** Touch points currently down on the stage, in screen offsets from the stage centre. */
  const touchesRef = useRef(new Map<number, Vec>());
  const [display, setDisplay] = useState({ w: 640, h: 360 });
  const [view, setView] = useState<View>(FIT_VIEW);
  const [navigating, setNavigating] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setOverlayTick] = useState(0);

  const layer = project.layers.find((l) => l.id === activeLayerId);
  const blocked = !layer ? 'Pick a layer to draw on' : layer.locked ? 'This layer is locked' : !layer.visible ? 'This layer is hidden' : null;
  const drawing = layer ? drawingAt(project, layer, frame) : null;
  const scale = display.w / project.width;
  /** Screen px per project px, including zoom. */
  const vs = scale * view.zoom;

  const flash = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };

  // Fit the canvas to the stage, keeping the project's aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const pad = 48;
      const aw = Math.max(100, el.clientWidth - pad);
      const ah = Math.max(100, el.clientHeight - pad);
      const s = Math.min(aw / project.width, ah / project.height);
      setDisplay({ w: Math.floor(project.width * s), h: Math.floor(project.height * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const g = gestureRef.current;
    let shown = project;
    if (g && (g.type === 'move' || g.type === 'scale') && selection) shown = transformStrokes(project, activeLayerId, frame, selection, g.matrix);
    const live = g && (g.type === 'stroke' || g.type === 'shape') ? { layerId: activeLayerId, stroke: g.stroke } : null;
    composeFrame(ctx, shown, frame, { paper: true, onion, live, camera: playing });
  }, [project, frame, onion, activeLayerId, selection, playing]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // A new or opened animation starts fitted to the screen.
  useEffect(() => { setView(FIT_VIEW); }, [project.id]);

  // Wheel: zoom around the pointer. Sideways scrolling (trackpads) or Shift+wheel pans.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const line = e.deltaMode === 1 ? 33 : 1;
      if (!e.ctrlKey && !e.metaKey && (e.deltaX !== 0 || e.shiftKey)) {
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * line;
        const dy = e.shiftKey ? 0 : e.deltaY * line;
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
        return;
      }
      const d = Math.max(-20, Math.min(20, e.deltaY * line));
      const r = el.getBoundingClientRect();
      const at: Vec = [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
      setView((v) => zoomAt(v, Math.exp(-d * 0.01), at));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // View shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [role="dialog"]') || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let next: ((v: View) => View) | null = null;
      if (k === '=' || k === '+') next = (v) => zoomAt(v, 1.25);
      else if (k === '-' || k === '_') next = (v) => zoomAt(v, 0.8);
      else if (k === '0') next = () => FIT_VIEW;
      else if (k === '1') next = (v) => zoomAt(v, 1 / scale / v.zoom);
      else if (mod) return;
      else if (k === '4') next = (v) => rotateAt(v, -15);
      else if (k === '6') next = (v) => rotateAt(v, 15);
      else if (k === '5') next = (v) => rotateAt(v, -v.rotation);
      else if (k === 'm') next = (v) => flipAt(v);
      if (!next) return;
      e.preventDefault();
      setView(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scale]);

  /** Stop a drawing gesture without committing it (a second finger turned it into a pinch). */
  const cancelGesture = () => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    cancelAnimationFrame(rafRef.current);
    paint();
    setOverlayTick((t) => t + 1);
  };

  // Navigation runs on the whole stage, before the canvas sees the pointer.
  const onNavDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.view-controls')) return;
    const at = fromCentre(e);
    if (e.pointerType === 'touch') {
      const touches = touchesRef.current;
      touches.set(e.pointerId, at);
      if (touches.size < 2) return;
      e.stopPropagation();
      if (touches.size > 2 || navRef.current) return;
      const g = gestureRef.current;
      if (g && touches.has(g.pointerId)) cancelGesture();
      const ids = [...touches.keys()] as [number, number];
      navRef.current = { type: 'pinch', ids, start: [touches.get(ids[0])!, touches.get(ids[1])!], view };
      e.currentTarget.setPointerCapture(e.pointerId);
      setNavigating(true);
      return;
    }
    if ((e.pointerType === 'mouse' && e.button === 1) || (panKey && e.button === 0)) {
      e.preventDefault();
      e.stopPropagation();
      if (gestureRef.current || navRef.current) return;
      navRef.current = { type: 'pan', pointerId: e.pointerId, last: at };
      e.currentTarget.setPointerCapture(e.pointerId);
      setNavigating(true);
      if (panKey) onPanned();
    }
  };

  const onNavMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const at = fromCentre(e);
    const touches = touchesRef.current;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, at);
    const n = navRef.current;
    if (n?.type === 'pan' && n.pointerId === e.pointerId) {
      const [dx, dy] = [at[0] - n.last[0], at[1] - n.last[1]];
      n.last = at;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (n?.type === 'pinch' && n.ids.includes(e.pointerId)) {
      const a = touches.get(n.ids[0]);
      const b = touches.get(n.ids[1]);
      if (a && b) setView(pinch(n.view, n.start[0], n.start[1], a, b));
    }
  };

  const onNavUp = (e: React.PointerEvent<HTMLDivElement>) => {
    touchesRef.current.delete(e.pointerId);
    const n = navRef.current;
    if ((n?.type === 'pan' && n.pointerId === e.pointerId) || (n?.type === 'pinch' && n.ids.includes(e.pointerId))) {
      navRef.current = null;
      setNavigating(false);
      if (n.type === 'pinch') setView((v) => snapRotation(v));
    }
  };

  const schedulePaint = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      paint();
      setOverlayTick((t) => t + 1);
    });
  };

  /** Screen offset of a pointer from the stage centre (where the unpanned canvas centre sits). */
  const fromCentre = (e: { clientX: number; clientY: number }): Vec => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
  };

  /** Pointer position on the laid-out (fit-size) canvas, in px from its top-left corner. */
  const toLocal = (e: { clientX: number; clientY: number }): Vec => {
    const [x, y] = screenToLocal(view, fromCentre(e));
    return [x + display.w / 2, y + display.h / 2];
  };

  const toPoint = (e: PointerEvent | React.PointerEvent, usePen: boolean): Point => {
    const [lx, ly] = toLocal(e);
    const x = lx / scale;
    const y = ly / scale;
    const p = usePen ? (e.pressure || 0.5) : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 1000) / 1000];
  };

  // The selection's box, following any move or scale in progress.
  const selectionBox = (): Box | null => {
    if (!selection || !drawing) return null;
    const box = unionBoxes(selection.map((i) => (drawing.strokes[i] ? strokeBounds(drawing.strokes[i]) : null)));
    const g = gestureRef.current;
    if (!box || !g || (g.type !== 'move' && g.type !== 'scale')) return box;
    const a = apply(g.matrix, box.x0, box.y0);
    const b = apply(g.matrix, box.x1, box.y1);
    return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
  };

  const pickColor = (x: number, y: number) => {
    const c = document.createElement('canvas');
    c.width = project.width;
    c.height = project.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    composeFrame(ctx, project, frame, { paper: true });
    const [r, g, b] = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    onPickColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  };

  const fillAt = (x: number, y: number) => {
    const { width: w, height: h } = project;
    // Walls are this drawing's lines only: earlier fills can be refilled.
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    for (const s of drawing?.strokes ?? []) if (s.kind !== 'fill') paintStroke(ctx, s);
    const spans = floodFillSpans(ctx.getImageData(0, 0, w, h).data, w, h, x, y);
    if (!spans) {
      flash('Click inside an area, not on a line');
      return;
    }
    const stroke: Stroke = {
      kind: 'fill', spans, points: [[x, y, 0.5]], color: brush.color, size: 0, erase: false, smoothing: 0, simulatePressure: false, thinning: 0,
      ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
    };
    onCommit((p) => addStroke(p, activeLayerId, frame, stroke, true));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current) return;
    const pt = toPoint(e, false);
    const [x, y] = pt;

    if (tool === 'camera') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const base = cameraAt(project, frame);
      const corners = cameraCorners(base, project.width, project.height);
      const r = 14 / vs;
      const onCorner = corners.some(([cx, cy]) => Math.abs(cx - x) <= r && Math.abs(cy - y) <= r);
      gestureRef.current = { type: 'camera', pointerId: e.pointerId, mode: onCorner ? 'zoom' : 'move', start: [x, y], base, view: base };
      schedulePaint();
      return;
    }

    // Eyedropper, or Alt+click with any drawing tool.
    if (tool === 'eyedropper' || (e.altKey && tool !== 'select' && tool !== 'eraser')) {
      pickColor(x, y);
      return;
    }
    if (blocked && EDITS.includes(tool)) {
      flash(blocked);
      return;
    }
    if (tool === 'fill') {
      fillAt(x, y);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const id = e.pointerId;

    if (tool === 'select') {
      const box = selectionBox();
      if (box) {
        const r = 12 / vs;
        const corners: Vec[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
        const hit = corners.findIndex(([cx, cy]) => Math.abs(cx - x) <= r && Math.abs(cy - y) <= r);
        if (hit >= 0) {
          gestureRef.current = { type: 'scale', pointerId: id, corner: corners[hit], origin: corners[(hit + 2) % 4], matrix: [1, 0, 0, 1, 0, 0] };
          return;
        }
        if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) {
          gestureRef.current = { type: 'move', pointerId: id, start: [x, y], matrix: [1, 0, 0, 1, 0, 0] };
          return;
        }
      }
      onSelectionChange(null);
      gestureRef.current = { type: 'lasso', pointerId: id, points: [[x, y]] };
      schedulePaint();
      return;
    }

    const erase = tool === 'eraser';
    if (SHAPES.includes(tool)) {
      gestureRef.current = {
        type: 'shape', pointerId: id, start: [x, y],
        stroke: {
          kind: tool as Stroke['kind'], points: [pt, pt], color: brush.color, size: brush.size, erase: false,
          smoothing: 0, simulatePressure: false, thinning: 0, filled: tool !== 'line' && brush.fillShapes,
          ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
        },
      };
      schedulePaint();
      return;
    }

    const pen = e.pointerType === 'pen' && brush.pressure;
    const first = toPoint(e, pen);
    gestureRef.current = {
      type: 'stroke', pointerId: id, tip: first, pointer: first,
      stroke: {
        points: [first],
        color: brush.color,
        size: erase ? brush.eraserSize : brush.size,
        erase,
        smoothing: brush.smoothing,
        // Mouse and touch have no pressure: fake it from speed, unless turned off.
        simulatePressure: brush.pressure && !pen && !erase,
        thinning: brush.pressure && !erase ? brush.thinning : 0,
        ...(!erase && brush.opacity < 1 ? { opacity: brush.opacity } : {}),
        ...(!erase && brush.softness > 0 ? { softness: brush.softness } : {}),
      },
    };
    schedulePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [cx, cy] = toLocal(e);
    setCursor({ x: cx, y: cy });
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const [x, y] = toPoint(e, false);

    if (g.type === 'stroke') {
      const pen = e.pointerType === 'pen' && brush.pressure;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const raw = events.length ? events.map((ev) => toPoint(ev, pen)) : [toPoint(e, pen)];
      // The eraser isn't stabilized: it should go exactly where you point.
      const amount = g.stroke.erase ? 0 : brush.stabilizer;
      const pts = raw.map((pt) => (g.tip = amount ? stabilize(g.tip, pt, amount) : pt));
      g.pointer = raw.at(-1)!;
      g.stroke = { ...g.stroke, points: [...g.stroke.points, ...pts] };
    } else if (g.type === 'shape') {
      let [ex, ey] = [x, y];
      const [sx, sy] = g.start;
      if (e.shiftKey) {
        const dx = ex - sx, dy = ey - sy;
        if (g.stroke.kind === 'line') {
          // Snap to 45° steps.
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          ex = sx + Math.cos(angle) * len;
          ey = sy + Math.sin(angle) * len;
        } else {
          // Square or circle.
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          ex = sx + Math.sign(dx || 1) * side;
          ey = sy + Math.sign(dy || 1) * side;
        }
      }
      g.stroke = { ...g.stroke, points: [g.stroke.points[0], [ex, ey, 0.5]] };
    } else if (g.type === 'camera') {
      const b = g.base;
      if (g.mode === 'move') {
        g.view = { ...b, x: b.x + (x - g.start[0]), y: b.y + (y - g.start[1]) };
      } else {
        // Dragging a corner out shows more of the scene (zooms out).
        const d0 = Math.hypot(g.start[0] - b.x, g.start[1] - b.y) || 1;
        const d1 = Math.hypot(x - b.x, y - b.y) || 1;
        g.view = { ...b, zoom: Math.min(20, Math.max(0.1, (b.zoom * d0) / d1)) };
      }
    } else if (g.type === 'lasso') {
      g.points.push([x, y]);
    } else if (g.type === 'move') {
      g.matrix = translate(x - g.start[0], y - g.start[1]);
    } else if (g.type === 'scale') {
      const [ox, oy] = g.origin;
      const [cx, cy] = g.corner;
      let sx = (x - ox) / (cx - ox || 1);
      let sy = (y - oy) / (cy - oy || 1);
      if (e.shiftKey) sx = sy = Math.max(sx, sy);
      sx = Math.max(0.05, sx);
      sy = Math.max(0.05, sy);
      g.matrix = scaleAbout(sx, sy, ox, oy);
    }
    schedulePaint();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    cancelAnimationFrame(rafRef.current);

    if (g.type === 'stroke') {
      const tail = catchUp(g.tip, g.pointer);
      const stroke = tail.length ? { ...g.stroke, points: [...g.stroke.points, ...tail] } : g.stroke;
      onCommit((p) => addStroke(p, activeLayerId, frame, stroke));
    } else if (g.type === 'shape') {
      const [a, b] = g.stroke.points;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) onCommit((p) => addStroke(p, activeLayerId, frame, g.stroke));
      else paint();
    } else if (g.type === 'camera') {
      const v = g.view;
      if (v !== g.base) onCommit((p) => setCameraKey(p, frame, v));
      else paint();
      setOverlayTick((t) => t + 1);
    } else if (g.type === 'lasso') {
      const strokes = drawing?.strokes ?? [];
      let hits = strokesInLasso(strokes, g.points);
      if (!hits.length && g.points.length < 6) {
        // A click: pick the topmost stroke under the pointer.
        const [x, y] = g.points[0];
        for (let i = strokes.length - 1; i >= 0; i--) {
          const b = strokeBounds(strokes[i]);
          if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { hits = [i]; break; }
        }
      }
      onSelectionChange(hits.length ? hits : null);
      setOverlayTick((t) => t + 1);
    } else if (selection) {
      const m = g.matrix;
      if (m[0] !== 1 || m[3] !== 1 || m[4] !== 0 || m[5] !== 0) {
        onCommit((p) => transformStrokes(p, activeLayerId, frame, selection, m));
      } else {
        paint();
      }
    }
  };

  const g = gestureRef.current;
  const box = tool === 'select' ? selectionBox() : null;
  // The camera's frame: shown while the camera tool is on, or faintly whenever the camera moves.
  const camView = g?.type === 'camera' ? g.view : !playing && (tool === 'camera' || hasCamera(project)) ? cameraAt(project, frame) : null;
  const camCorners = camView ? cameraCorners(camView, project.width, project.height) : null;
  const camActive = tool === 'camera';
  const showBrushCursor = (tool === 'brush' || tool === 'eraser') && cursor && !blocked && !panKey && !navigating;
  const cursorSize = (tool === 'eraser' ? brush.eraserSize : brush.size) * scale;
  const canvasClass = tool === 'camera' ? 'camera' : tool === 'eyedropper' ? 'pick' : blocked && EDITS.includes(tool) ? 'blocked' : tool === 'fill' ? 'fill' : tool === 'select' ? 'select' : 'draw';
  const hs = 10 / vs; // handle size in project px

  return (
    <div
      className={`stage${panKey ? ' pan' : ''}${navigating ? ' grabbing' : ''}`}
      ref={wrapRef}
      onPointerDownCapture={onNavDown}
      onPointerMove={onNavMove}
      onPointerUp={onNavUp}
      onPointerCancel={onNavUp}
    >
      <div className="canvas-wrap" style={{ width: display.w, height: display.h, transform: viewTransform(view) }}>
        <canvas
          ref={canvasRef}
          width={project.width}
          height={project.height}
          style={{ width: display.w, height: display.h }}
          className={canvasClass}
          aria-label="Drawing canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={() => setCursor(null)}
        />
        {(box || camCorners || g?.type === 'lasso' || (g?.type === 'stroke' && brush.stabilizer > 0 && !g.stroke.erase)) && (
          <svg className="overlay" viewBox={`0 0 ${project.width} ${project.height}`} aria-hidden="true">
            {camCorners && (
              <g className={`camera-frame${camActive ? ' active' : ''}`}>
                <polygon
                  points={camCorners.map((p) => p.join(',')).join(' ')} fill={camActive ? 'rgba(76,141,240,0.06)' : 'none'}
                  stroke="#4c8df0" strokeWidth={(camActive ? 2 : 1.2) / vs} strokeDasharray={camActive ? undefined : `${8 / vs} ${5 / vs}`}
                />
                {camActive && camCorners.map(([cx, cy], i) => (
                  <rect key={i} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#4c8df0" strokeWidth={1.5 / vs} />
                ))}
                {camActive && (
                  <line x1={camCorners[0][0]} y1={camCorners[0][1]} x2={camCorners[1][0]} y2={camCorners[1][1]} stroke="#4c8df0" strokeWidth={5 / vs} />
                )}
              </g>
            )}
            {g?.type === 'stroke' && (
              // Stabilizer: a string from the pointer to the trailing pen tip.
              <g>
                <line x1={g.tip[0]} y1={g.tip[1]} x2={g.pointer[0]} y2={g.pointer[1]} stroke="#f0a43a" strokeWidth={1.2 / vs} />
                <circle cx={g.pointer[0]} cy={g.pointer[1]} r={3 / vs} fill="#f0a43a" />
              </g>
            )}
            {g?.type === 'lasso' && (
              <polyline points={g.points.map((p) => p.join(',')).join(' ')} fill="rgba(240,164,58,0.08)" stroke="#f0a43a" strokeWidth={1.5 / vs} strokeDasharray={`${5 / vs} ${4 / vs}`} />
            )}
            {box && (
              <g>
                <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="none" stroke="#f0a43a" strokeWidth={1.5 / vs} strokeDasharray={`${6 / vs} ${4 / vs}`} />
                {[[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([cx, cy], i) => (
                  <rect key={i} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#f0a43a" strokeWidth={1.5 / vs} />
                ))}
              </g>
            )}
          </svg>
        )}
        {showBrushCursor && cursorSize > 4 && (
          <div
            className="brush-cursor"
            style={{ width: cursorSize, height: cursorSize, left: cursor.x - cursorSize / 2, top: cursor.y - cursorSize / 2 }}
          />
        )}
      </div>
      {note && <div className="stage-note" role="status">{note}</div>}
      <div className="view-controls" role="group" aria-label="View">
        <button className="icon-btn" aria-label="Zoom out" title="Zoom out (−, or scroll the mouse wheel)" onClick={() => setView((v) => zoomAt(v, 0.8))}><I.Minus /></button>
        <button className="zoom-value" title="Zoom level. Click for actual size, 1 pixel per pixel (1)" onClick={() => setView((v) => zoomAt(v, 1 / scale / v.zoom))}>{Math.round(vs * 100)}%</button>
        <button className="icon-btn" aria-label="Zoom in" title="Zoom in (+, or scroll the mouse wheel)" onClick={() => setView((v) => zoomAt(v, 1.25))}><I.Plus /></button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Rotate left" title="Rotate the view 15° left (4). On a touch screen, twist two fingers." onClick={() => setView((v) => rotateAt(v, -15))}><I.RotateLeft /></button>
        {view.rotation !== 0 && (
          <button className="zoom-value" title="Rotation of the view. Click to straighten it (5)" onClick={() => setView((v) => rotateAt(v, -v.rotation))}>{Math.round(view.rotation)}°</button>
        )}
        <button className="icon-btn" aria-label="Rotate right" title="Rotate the view 15° right (6)" onClick={() => setView((v) => rotateAt(v, 15))}><I.RotateRight /></button>
        <button className={`icon-btn${view.flip ? ' on' : ''}`} aria-label="Mirror view" aria-pressed={view.flip} title="Mirror the view left to right to check your drawing with fresh eyes (M). The drawing itself doesn't change." onClick={() => setView((v) => flipAt(v))}><I.Mirror /></button>
        <span className="sep" />
        <button className="btn small" title="Fit the whole canvas on screen and straighten it (0). Pan with Space+drag, the middle mouse button or two fingers." onClick={() => setView(FIT_VIEW)}>Fit</button>
      </div>
    </div>
  );
}
