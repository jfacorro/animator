import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Point, Project, Stroke } from '../model/project';
import { composeFrame, outlineToPath, strokeOutline, type OnionOptions } from '../render/render';

export type Tool = 'brush' | 'eraser';

export interface BrushSettings {
  color: string;
  size: number;
  eraserSize: number;
  smoothing: number;
  pressure: boolean;
}

interface Props {
  project: Project;
  frame: number;
  activeLayerId: string;
  tool: Tool;
  brush: BrushSettings;
  onion: OnionOptions | null;
  onStroke: (stroke: Stroke) => void;
}

interface LiveStroke {
  pointerId: number;
  stroke: Stroke;
}

export function Stage({ project, frame, activeLayerId, tool, brush, onion, onStroke }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<LiveStroke | null>(null);
  const rafRef = useRef(0);
  const [display, setDisplay] = useState({ w: 640, h: 360 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const layer = project.layers.find((l) => l.id === activeLayerId);
  const blocked = !layer ? 'Pick a layer to draw on' : layer.locked ? 'This layer is locked' : !layer.visible ? 'This layer is hidden' : null;

  // Fit the canvas to the stage, keeping the project's aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const pad = 48;
      const aw = Math.max(100, el.clientWidth - pad);
      const ah = Math.max(100, el.clientHeight - pad);
      const scale = Math.min(aw / project.width, ah / project.height);
      setDisplay({ w: Math.floor(project.width * scale), h: Math.floor(project.height * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const live = liveRef.current;
    composeFrame(ctx, project, frame, {
      paper: true,
      onion,
      live: live ? { layerId: activeLayerId, stroke: live.stroke, path: outlineToPath(strokeOutline(live.stroke, false)) } : null,
    });
  }, [project, frame, onion, activeLayerId]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const scale = display.w / project.width;

  const toPoint = (e: PointerEvent | React.PointerEvent, usePen: boolean): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * project.width;
    const y = ((e.clientY - rect.top) / rect.height) * project.height;
    const p = usePen ? (e.pressure || 0.5) : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 1000) / 1000];
  };

  const schedulePaint = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(paint);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (liveRef.current) return;
    if (blocked) {
      setNote(blocked);
      window.setTimeout(() => setNote(null), 1600);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const pen = e.pointerType === 'pen' && brush.pressure;
    const erase = tool === 'eraser';
    liveRef.current = {
      pointerId: e.pointerId,
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
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    const pen = e.pointerType === 'pen' && brush.pressure;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const pts = events.length ? events.map((ev) => toPoint(ev, pen)) : [toPoint(e, pen)];
    live.stroke = { ...live.stroke, points: [...live.stroke.points, ...pts] };
    schedulePaint();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    liveRef.current = null;
    cancelAnimationFrame(rafRef.current);
    onStroke(live.stroke);
  };

  const cursorSize = (tool === 'eraser' ? brush.eraserSize : brush.size) * scale;

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        width={project.width}
        height={project.height}
        style={{ width: display.w, height: display.h }}
        className={blocked ? 'blocked' : 'draw'}
        aria-label="Drawing canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => setCursor(null)}
      />
      {cursor && !blocked && cursorSize > 4 && (
        <div
          className="brush-cursor"
          style={{
            width: cursorSize,
            height: cursorSize,
            left: `calc(50% - ${display.w / 2}px + ${cursor.x - cursorSize / 2}px)`,
            top: `calc(50% - ${display.h / 2}px + ${cursor.y - cursorSize / 2}px)`,
          }}
        />
      )}
      {note && <div className="stage-note" role="status">{note}</div>}
    </div>
  );
}
