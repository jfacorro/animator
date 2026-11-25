import { useEffect, useRef, useState } from 'react';
import type { Project } from '../model/project';
import { composeFrame } from '../render/render';

interface Props {
  project: Project;
  frame: number;
  onClose: () => void;
}

type Mode = 'canvas' | 'image';
interface Place { x: number; y: number; w: number; h: number }

const PLACE_KEY = 'animator:reference-window';
const IMAGE_KEY = 'animator:reference-window-image';
const HEAD = 30;

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* too big or blocked: kept for this visit only */ }
}

let full: HTMLCanvasElement | null = null;

/**
 * A small floating window that stays on top while you draw: the whole frame as
 * it will look (through the camera), or a picture to look at.
 */
export function ReferenceWindow({ project, frame, onClose }: Props) {
  const [place, setPlace] = useState<Place>(() => {
    const p = load<Place | null>(PLACE_KEY, null);
    const ok = p && [p.x, p.y, p.w, p.h].every((n) => typeof n === 'number');
    return ok ? clampPlace(p!) : clampPlace({ x: window.innerWidth - 300, y: 120, w: 260, h: 190 });
  });
  const [mode, setMode] = useState<Mode>(() => (load<string | null>(IMAGE_KEY, null) ? 'image' : 'canvas'));
  const [image, setImage] = useState<string | null>(() => load<string | null>(IMAGE_KEY, null));
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; kind: 'move' | 'size'; x: number; y: number; start: Place } | null>(null);

  useEffect(() => { save(PLACE_KEY, place); }, [place]);

  // The frame, drawn at project size once and shrunk to the window.
  useEffect(() => {
    if (mode !== 'canvas') return;
    const c = canvas.current;
    if (!c) return;
    const t = window.setTimeout(() => {
      const { width: w, height: h } = project;
      if (!full) full = document.createElement('canvas');
      if (full.width !== w || full.height !== h) { full.width = w; full.height = h; }
      composeFrame(full.getContext('2d')!, project, frame, { paper: true, camera: true });
      const dpr = window.devicePixelRatio || 1;
      const s = Math.min(place.w / w, (place.h - HEAD) / h);
      c.width = Math.max(1, Math.round(w * s * dpr));
      c.height = Math.max(1, Math.round(h * s * dpr));
      c.style.width = `${w * s}px`;
      c.style.height = `${h * s}px`;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, 0, 0, c.width, c.height);
    }, 60);
    return () => window.clearTimeout(t);
  }, [project, frame, mode, place.w, place.h]);

  const startDrag = (e: React.PointerEvent, kind: 'move' | 'size') => {
    if ((e.target as HTMLElement).closest('button, select') && kind === 'move') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, start: place };
    e.preventDefault();
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setPlace(clampPlace(d.kind === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy }));
  };
  const endDrag = () => { drag.current = null; };

  const pickImage = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      setImage(url);
      setMode('image');
      save(IMAGE_KEY, url);
    };
    r.readAsDataURL(f);
  };

  return (
    <div className="ref-window" role="dialog" aria-label="Reference window" style={{ left: place.x, top: place.y, width: place.w, height: place.h }}>
      <div className="ref-head" onPointerDown={(e) => startDrag(e, 'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <select value={mode} aria-label="Show" onChange={(e) => { const m = e.target.value as Mode; if (m === 'image' && !image) fileInput.current?.click(); else setMode(m); }}>
          <option value="canvas">This frame</option>
          <option value="image">Image</option>
        </select>
        {mode === 'image' && <button className="btn small" title="Show another picture" onClick={() => fileInput.current?.click()}>Change…</button>}
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Close reference window" title="Close" onClick={onClose}>✕</button>
      </div>
      <div className="ref-body">
        {mode === 'canvas'
          ? <canvas ref={canvas} aria-label="The whole frame" />
          : image ? <img src={image} alt="Reference" draggable={false} /> : null}
      </div>
      <div className="ref-resize" title="Drag to resize" onPointerDown={(e) => startDrag(e, 'size')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ''; }} />
    </div>
  );
}

/** Keep the window on screen and at a usable size. */
function clampPlace(p: Place): Place {
  const w = Math.min(Math.max(160, p.w), window.innerWidth - 16);
  const h = Math.min(Math.max(120, p.h), window.innerHeight - 16);
  return { w, h, x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8), y: Math.min(Math.max(8, p.y), window.innerHeight - h - 8) };
}
