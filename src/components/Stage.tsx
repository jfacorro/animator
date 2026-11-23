import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { scaleAbout, strokeBounds, strokesInLasso, translate, unionBoxes, apply, type Box, type Matrix, type Vec } from '../model/geometry';
import { addStroke, drawingAt, transformStrokes, type Point, type Project, type Stroke } from '../model/project';
import { floodFillSpans } from '../render/fill';
import { composeFrame, paintStroke, type OnionOptions } from '../render/render';

export type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'eyedropper' | 'select';

export interface BrushSettings {
  color: string;
  size: number;
  eraserSize: number;
  smoothing: number;
  pressure: boolean;
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
}

type Gesture =
  | { type: 'stroke'; pointerId: number; stroke: Stroke }
  | { type: 'shape'; pointerId: number; stroke: Stroke; start: Vec }
  | { type: 'lasso'; pointerId: number; points: Vec[] }
  | { type: 'move'; pointerId: number; start: Vec; matrix: Matrix }
  | { type: 'scale'; pointerId: number; origin: Vec; corner: Vec; matrix: Matrix };

const SHAPES: Tool[] = ['line', 'rect', 'ellipse'];
const EDITS: Tool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'select'];

export function Stage({ project, frame, activeLayerId, tool, brush, onion, selection, onSelectionChange, onCommit, onPickColor }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rafRef = useRef(0);
  const [display, setDisplay] = useState({ w: 640, h: 360 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setOverlayTick] = useState(0);

  const layer = project.layers.find((l) => l.id === activeLayerId);
  const blocked = !layer ? 'Pick a layer to draw on' : layer.locked ? 'This layer is locked' : !layer.visible ? 'This layer is hidden' : null;
  const drawing = layer ? drawingAt(project, layer, frame) : null;
  const scale = display.w / project.width;

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
    composeFrame(ctx, shown, frame, { paper: true, onion, live });
  }, [project, frame, onion, activeLayerId, selection]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const schedulePaint = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      paint();
      setOverlayTick((t) => t + 1);
    });
  };

  const toPoint = (e: PointerEvent | React.PointerEvent, usePen: boolean): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * project.width;
    const y = ((e.clientY - rect.top) / rect.height) * project.height;
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
    };
    onCommit((p) => addStroke(p, activeLayerId, frame, stroke, true));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current) return;
    const pt = toPoint(e, false);
    const [x, y] = pt;

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
        const r = 12 / scale;
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
        },
      };
      schedulePaint();
      return;
    }

    const pen = e.pointerType === 'pen' && brush.pressure;
    gestureRef.current = {
      type: 'stroke', pointerId: id,
      stroke: {
        points: [toPoint(e, pen)],
        color: brush.color,
        size: erase ? brush.eraserSize : brush.size,
        erase,
        smoothing: brush.smoothing,
        // Mouse and touch have no pressure: fake it from speed, unless turned off.
        simulatePressure: brush.pressure && !pen && !erase,
        thinning: brush.pressure && !erase ? 0.6 : 0,
      },
    };
    schedulePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const [x, y] = toPoint(e, false);

    if (g.type === 'stroke') {
      const pen = e.pointerType === 'pen' && brush.pressure;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const pts = events.length ? events.map((ev) => toPoint(ev, pen)) : [toPoint(e, pen)];
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
      onCommit((p) => addStroke(p, activeLayerId, frame, g.stroke));
    } else if (g.type === 'shape') {
      const [a, b] = g.stroke.points;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) onCommit((p) => addStroke(p, activeLayerId, frame, g.stroke));
      else paint();
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
  const showBrushCursor = (tool === 'brush' || tool === 'eraser') && cursor && !blocked;
  const cursorSize = (tool === 'eraser' ? brush.eraserSize : brush.size) * scale;
  const canvasClass = tool === 'eyedropper' ? 'pick' : blocked && EDITS.includes(tool) ? 'blocked' : tool === 'fill' ? 'fill' : tool === 'select' ? 'select' : 'draw';
  const hs = 10 / scale; // handle size in project px

  return (
    <div className="stage" ref={wrapRef}>
      <div className="canvas-wrap" style={{ width: display.w, height: display.h }}>
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
        {(box || g?.type === 'lasso') && (
          <svg className="overlay" viewBox={`0 0 ${project.width} ${project.height}`} aria-hidden="true">
            {g?.type === 'lasso' && (
              <polyline points={g.points.map((p) => p.join(',')).join(' ')} fill="rgba(240,164,58,0.08)" stroke="#f0a43a" strokeWidth={1.5 / scale} strokeDasharray={`${5 / scale} ${4 / scale}`} />
            )}
            {box && (
              <g>
                <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="none" stroke="#f0a43a" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />
                {[[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([cx, cy], i) => (
                  <rect key={i} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#f0a43a" strokeWidth={1.5 / scale} />
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
    </div>
  );
}
