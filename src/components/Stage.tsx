import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { scaleAbout, spansBox, strokeBounds, strokesInLasso, translate, unionBoxes, apply, type Box, type Matrix, type Vec } from '../model/geometry';
import { addStroke, updateLayer, celIndexAt, drawingAt, replaceStrokes, setPaint, transformStrokes, type FontId, type GrainKind, type Paint, type Point, type Project, type Stroke } from '../model/project';
import { floodFillSpans } from '../render/fill';
import { catchUp, stabilize } from '../model/brushes';
import { groupOf } from '../model/groups';
import { cameraAt, cameraCorners, hasCamera, setCameraKey, type CameraView } from '../model/camera';
import { bakePaint, composeFrame, encodePaint, livePaint, movePaintRegion, mulMatrix, paintSheet, PAPER, pushPixels, warpPaintRegion, smudgeStep, blurStep, paintReady, fontCss, LINE_HEIGHT, measureText, onImageLoad, paintSource, paintStroke, selectionMask, type OnionOptions } from '../render/render';
import { placeReference, rulerStep, snapPerspective, snapToGuides, symmetricStrokes, type GuideAxis, type Symmetry } from '../model/aids';
import { addGuide, moveGuide, removeGuide } from '../model/aids';
import { tapDown, tapMove, tapUp, type Taps } from '../model/taps';
import { pushStrokes, startGrid, warpPoint, warpStrokes, type Grid } from '../model/warp';
import { adjustShape, HOLD_MS, recognize, SHAPE_NAMES, shapePoints, type QuickShape } from '../model/quickshape';
import { FIT_VIEW, flipAt, pinch, rotateAt, screenToLocal, snapRotation, viewTransform, zoomAt, type View } from '../model/view';
import * as I from './Icons';
import { actionFor, displayKey, keyOf, type Keymap } from '../keys';

export type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'text' | 'eyedropper' | 'select' | 'liquify' | 'smudge' | 'blur' | 'camera';

export interface BrushSettings {
  color: string;
  size: number;
  eraserSize: number;
  /** Liquify: how wide an area moves with the pointer. */
  liquifySize?: number;
  /** Smudge and Blur: brush width and how strongly each dab works (0–1). */
  fxSize?: number;
  fxStrength?: number;
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
  /** Paper texture through the line, and how strongly (0–1). */
  grain: GrainKind | 'none';
  grainAmount: number;
  /** Rectangles and ellipses are filled instead of outlined. */
  fillShapes: boolean;
  /** Fill bucket: a flat colour, or a gradient dragged across the area. */
  fillMode: 'solid' | 'linear' | 'radial';
  /** Gradient end colour, unless it fades out to see-through. */
  color2: string;
  fadeOut: boolean;
  /** Text tool. */
  font: FontId;
  textSize: number;
  bold: boolean;
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
  /** Paint layers: the selected area's outline. */
  paintSelection: Vec[] | null;
  onPaintSelectionChange: (outline: Vec[] | null) => void;
  /** Lasso: bend the selection with a 3×3 grid of handles instead of moving it. */
  warp: boolean;
  /** Brush and eraser paint the active layer's mask instead of the layer. */
  maskEdit?: boolean;
  /** Apply an edit to the project as one undo step. */
  onCommit: (edit: (p: Project) => Project) => void;
  onPickColor: (color: string) => void;
  /** Space is held: dragging pans instead of drawing. */
  panKey: boolean;
  /** Called when a Space-drag pans, so letting go of Space doesn't toggle playback. */
  onPanned: () => void;
  /** During playback the scene is framed through the camera. */
  playing: boolean;
  /** Keyboard shortcuts, for the view keys. */
  keymap: Keymap;
  /** Mirror strokes and shapes across the canvas centre. */
  symmetry: Symmetry;
  /** Show rulers along the stage edges; guides are dragged out of them. */
  rulers: boolean;
  onRulersChange: (on: boolean) => void;
  /** Fingers draw. When false (an Apple Pencil is in use), one finger moves the canvas and only the pen draws. */
  touchDraws: boolean;
  /** Two-finger tap. */
  onUndo: () => void;
  /** Three-finger tap. */
  onRedo: () => void;
  /** Ctrl + mouse wheel: one step bigger or smaller for the current tool's size. False if the tool has no size. */
  onBrushSize?: (bigger: boolean) => boolean;
}

const RULER = 20; // ruler thickness, screen px

/** Navigation gestures: pan with one pointer, or pinch (zoom/rotate/pan) with two fingers. */
type Nav =
  | { type: 'pan'; pointerId: number; last: Vec }
  | { type: 'pinch'; ids: [number, number]; start: [Vec, Vec]; view: View };

type Gesture =
  | {
      type: 'stroke'; pointerId: number; stroke: Stroke; tip: Point; pointer: Point;
      /** Where the pen came to rest, and the timer that snaps the stroke into a QuickShape. */
      hold?: { at: Vec; timer: number };
      /** Snapped: the shape, and where the pen was when it snapped. */
      quick?: { shape: QuickShape; from: Vec; pressure: number };
    }
  | { type: 'shape'; pointerId: number; stroke: Stroke; start: Vec }
  | { type: 'gradient'; pointerId: number; stroke: Stroke; start: Vec; moved: boolean }
  | { type: 'lasso'; pointerId: number; points: Vec[] }
  | { type: 'move'; pointerId: number; start: Vec; matrix: Matrix }
  | { type: 'liquify'; pointerId: number; last: Vec; strokes?: Stroke[]; sheet?: HTMLCanvasElement; changed: boolean }
  | { type: 'warp'; pointerId: number; handle: number; grid: Grid }
  | { type: 'smear'; pointerId: number; mode: 'smudge' | 'blur'; last: Vec; sheet: HTMLCanvasElement; changed: boolean }
  | { type: 'scale'; pointerId: number; origin: Vec; corner: Vec; matrix: Matrix }
  | { type: 'camera'; pointerId: number; mode: 'move' | 'zoom'; start: Vec; base: CameraView; view: CameraView };

/** A guide being dragged out of a ruler (index null) or moved (index set). */
interface GuideDrag { pointerId: number; axis: GuideAxis; index: number | null; pos: number; onRuler: boolean }

const SHAPES: Tool[] = ['line', 'rect', 'ellipse'];

/** What a frame shows, in short: each layer's drawing there, and the camera while playing. */
function frameSignature(project: Project, frame: number, playing: boolean): string {
  let sig = '';
  for (const l of project.layers) {
    const i = celIndexAt(l, frame);
    sig += `${i >= 0 ? l.cels[i].drawingId : '-'}|`;
  }
  if (playing && hasCamera(project)) sig += JSON.stringify(cameraAt(project, frame));
  return sig;
}
const MIRRORED: Tool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse'];

/** A rectangle after a move/scale matrix. */
function movedRect(r: { x: number; y: number; width: number; height: number }, m: Matrix) {
  const a = apply(m, r.x, r.y);
  const b = apply(m, r.x + r.width, r.y + r.height);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}
const EDITS: Tool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'text', 'select', 'liquify', 'smudge', 'blur'];

/** The box around an outline. */
function outlineBox(pts: Vec[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** Drawing outside the frame is shown through this, so the frame's edge stays clear. */
const OUTSIDE_FRAME = 'rgba(42, 44, 49, 0.72)';

export function Stage({ project, frame, activeLayerId, tool, brush, onion, selection, onSelectionChange, paintSelection, onPaintSelectionChange, warp, maskEdit = false, onCommit, onPickColor, panKey, onPanned, playing, keymap, symmetry, rulers, onRulersChange, touchDraws, onUndo, onRedo, onBrushSize }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rafRef = useRef(0);
  const navRef = useRef<Nav | null>(null);
  /** Touch points currently down on the stage, in screen offsets from the stage centre. */
  const touchesRef = useRef(new Map<number, Vec>());
  const tapsRef = useRef<Taps | null>(null);
  const [display, setDisplay] = useState({ w: 640, h: 360 });
  const [view, setView] = useState<View>(FIT_VIEW);
  const [navigating, setNavigating] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** Lasso: what the pointer is over, for its cursor (a corner to resize, inside to move, else draw a loop). */
  const [selHover, setSelHover] = useState<'move' | 'nwse' | 'nesw' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setOverlayTick] = useState(0);
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const [guideDrag, setGuideDrag] = useState<GuideDrag | null>(null);
  /** A vanishing point being dragged. */
  const [vpDrag, setVpDrag] = useState<{ pointerId: number; index: number; pos: Vec } | null>(null);
  const persp = project.perspective?.on ? project.perspective : null;
  const [imageTick, setImageTick] = useState(0);
  /** Text being typed: where it goes, in project px. */
  const [textEdit, setTextEdit] = useState<{ x: number; y: number } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const layer = project.layers.find((l) => l.id === activeLayerId);
  const group = layer ? groupOf(project, layer) : null;
  const isRef = !!layer?.reference;
  const editingMask = !!maskEdit && !!layer && layer.mask !== undefined && !layer.reference;
  const blocked = !layer ? 'Pick a layer to draw on'
    : editingMask && EDITS.includes(tool) && tool !== 'brush' && tool !== 'eraser' ? 'You\'re painting the layer mask: the brush hides the layer, the eraser shows it again. Click Done in the layer settings to draw on the layer.'
    : isRef && tool !== 'select' ? 'This is a reference image: pick another layer to draw on. Use the Lasso tool to move or resize it.'
    : (tool === 'smudge' || tool === 'blur') && !layer.paint ? 'Smudge and Blur work on paint layers. Add one with the brush button in Layers.'
    : layer.locked ? 'This layer is locked' : group?.locked ? 'This layer\'s group is locked'
    : !layer.visible ? 'This layer is hidden' : group && !group.visible ? 'This layer\'s group is hidden' : null;
  const drawing = layer ? drawingAt(project, layer, frame) : null;
  // Paint layers: the selection is an area of pixels. While it's dragged, its pixels are on this sheet.
  const paintSel = layer?.paint && tool === 'select' ? paintSelection : null;
  const paintSheetRef = useRef<HTMLCanvasElement | null>(null);
  /** The warp grid's box: the selection's, grown so a flat line still gets three rows of handles. */
  const warpBox = (b: Box): Box => {
    const min = 60 / vs;
    const gx = Math.max(0, min - (b.x1 - b.x0)) / 2, gy = Math.max(0, min - (b.y1 - b.y0)) / 2;
    return { x0: b.x0 - gx, y0: b.y0 - gy, x1: b.x1 + gx, y1: b.y1 + gy };
  };
  /** The drawing with the selection bent through a warp grid, for showing or keeping. */
  const warped = (grid: Grid): Project | null => {
    if (paintSel && paintSheetRef.current) {
      return setPaint(project, activeLayerId, frame, livePaint(warpPaintRegion(paintSheetRef.current, paintSel, grid.box, (x, y) => warpPoint(grid, x, y))));
    }
    if (selection && drawing) return replaceStrokes(project, activeLayerId, frame, warpStrokes(drawing.strokes, selection, grid));
    return null;
  };
  /** On an alpha-locked layer, new lines and paint keep to what the drawing already has. */
  /** A stroke painted on a mask: only its shape counts, so it goes on solid. */
  const maskStroke = (s: Stroke): Stroke => ({ ...s, color: '#000000', atop: undefined, opacity: s.erase ? undefined : s.opacity });
  const lockStroke = (s: Stroke): Stroke => (layer?.alphaLock && !s.erase ? { ...s, atop: true } : s);
  const scale = display.w / project.width;
  /** Screen px per project px, including zoom. */
  const vs = scale * view.zoom;
  // The selected strokes' silhouette, outlined on the overlay along their real edges.
  const mask = useMemo(() => {
    if (tool !== 'select' || !selection || !drawing || layer?.reference) return null;
    const box = unionBoxes(selection.map((i) => (drawing.strokes[i] && !drawing.strokes[i].erase ? strokeBounds(drawing.strokes[i]) : null)));
    return box ? selectionMask(drawing.strokes, selection, box) : null;
  }, [tool, selection, drawing, layer?.reference]);

  // Start decoding paint layers' pixels early, so playback doesn't wait on them.
  useEffect(() => { void paintReady(project); }, [project.drawings]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };

  // Fit the canvas to the stage, keeping the project's aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      // Less margin around the canvas on a phone, where every pixel counts.
      const pad = Math.min(el.clientWidth, el.clientHeight) < 420 ? 16 : 48;
      const aw = Math.max(100, el.clientWidth - pad);
      const ah = Math.max(100, el.clientHeight - pad);
      const s = Math.min(aw / project.width, ah / project.height);
      setDisplay({ w: Math.floor(project.width * s), h: Math.floor(project.height * s) });
      setStageSize({ w: el.clientWidth, h: el.clientHeight });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // True when the last change to what's painted was only the frame number.
  const otherDeps = [project, onion, activeLayerId, selection, playing, symmetry, imageTick];
  const prevDeps = useRef(otherDeps);
  const sameExceptFrame = useRef(false);
  sameExceptFrame.current = otherDeps.every((d, i) => d === prevDeps.current[i]);
  prevDeps.current = otherDeps;

  // A second canvas over the stage, at screen resolution, that redraws line
  // layers from their vectors so they stay sharp at any zoom. The project-size
  // canvas under it is what shows while you zoom, pan or play; the sharp one
  // takes over once the view has been still for a moment.
  const sharpRef = useRef<HTMLCanvasElement>(null);
  const sharpOn = useRef(false);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const sharpView = useRef({ matrix: [1, 0, 0, 1, 0, 0] as Matrix, width: 1, height: 1 });
  {
    // Project px → sharp canvas px: the same placement as the canvas's CSS transform.
    const r = (view.rotation * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const fz = (view.flip ? -1 : 1) * view.zoom * scale;
    const z = view.zoom * scale;
    const toStage: Matrix = mulMatrix(
      [cos, sin, -sin, cos, stageSize.w / 2 + view.x, stageSize.h / 2 + view.y],
      [fz, 0, 0, z, -fz * project.width / 2, -z * project.height / 2],
    );
    sharpView.current = {
      matrix: mulMatrix([dpr, 0, 0, dpr, 0, 0], toStage),
      width: Math.max(1, Math.round(stageSize.w * dpr)),
      height: Math.max(1, Math.round(stageSize.h * dpr)),
    };
  }
  const showSharp = (on: boolean) => {
    sharpOn.current = on;
    if (sharpRef.current) sharpRef.current.style.visibility = on ? 'visible' : 'hidden';
    if (canvasRef.current) canvasRef.current.style.opacity = on ? '0' : '';
  };

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const g = gestureRef.current;
    let shown = project;
    if (g && (g.type === 'move' || g.type === 'scale')) {
      const ref = project.layers.find((l) => l.id === activeLayerId)?.reference;
      if (ref) shown = placeReference(project, activeLayerId, movedRect(ref, g.matrix));
      else if (paintSel && paintSheetRef.current) shown = setPaint(project, activeLayerId, frame, livePaint(movePaintRegion(paintSheetRef.current, paintSel, g.matrix)));
      else if (selection) shown = transformStrokes(project, activeLayerId, frame, selection, g.matrix);
    }
    if (g?.type === 'liquify' && g.changed) {
      shown = g.sheet ? setPaint(project, activeLayerId, frame, livePaint(g.sheet)) : replaceStrokes(project, activeLayerId, frame, g.strokes!);
    }
    if (g?.type === 'warp') shown = warped(g.grid) ?? shown;
    if (g?.type === 'smear' && g.changed) shown = setPaint(project, activeLayerId, frame, livePaint(g.sheet));
    const inProgress = g && (g.type === 'stroke' || g.type === 'shape' || g.type === 'gradient')
      ? symmetricStrokes(g.stroke, symmetry, project.width, project.height) : null;
    const live = inProgress && !editingMask ? { layerId: activeLayerId, strokes: inProgress.map(lockStroke) } : null;
    const liveMask = inProgress && editingMask ? { layerId: activeLayerId, strokes: inProgress.map(maskStroke) } : null;
    const showMask = editingMask && !playing ? activeLayerId : null;
    composeFrame(ctx, shown, frame, { paper: true, onion, live, liveMask, showMask, camera: playing, references: !playing });
    const sharp = sharpRef.current;
    if (sharpOn.current && sharp && !playing) {
      const v = sharpView.current;
      if (sharp.width !== v.width || sharp.height !== v.height) { sharp.width = v.width; sharp.height = v.height; }
      const sctx = sharp.getContext('2d')!;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, v.width, v.height);
      // The page and its shadow, as the stage canvas has in CSS.
      sctx.save();
      sctx.setTransform(...v.matrix);
      sctx.shadowColor = '#0000004d';
      sctx.shadowBlur = 30 * dpr;
      sctx.shadowOffsetY = 8 * dpr;
      sctx.fillStyle = PAPER;
      sctx.fillRect(0, 0, project.width, project.height);
      sctx.restore();
      composeFrame(sctx, shown, frame, { paper: true, onion, live, liveMask, showMask, references: true, view: v });
      // Outside the frame: drawing still shows, but faded, with a line on the frame's edge.
      sctx.save();
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      const inv = new DOMMatrix(v.matrix).inverse();
      const corners = [[0, 0], [v.width, 0], [v.width, v.height], [0, v.height]].map(([x, y]) => inv.transformPoint({ x, y }));
      sctx.setTransform(...v.matrix);
      sctx.beginPath();
      // The whole visible area (in project space, since the view may be rotated), minus the frame.
      corners.forEach((p, i) => (i ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
      sctx.closePath();
      sctx.rect(0, 0, project.width, project.height);
      sctx.fillStyle = OUTSIDE_FRAME;
      sctx.fill('evenodd');
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      const edge = [[0, 0], [project.width, 0], [project.width, project.height], [0, project.height]].map(([x, y]) => new DOMMatrix(v.matrix).transformPoint({ x, y }));
      sctx.beginPath();
      edge.forEach((p, i) => (i ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
      sctx.closePath();
      sctx.lineWidth = dpr;
      sctx.strokeStyle = '#00000059';
      sctx.stroke();
      sctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, frame, onion, activeLayerId, selection, paintSelection, tool, editingMask, playing, symmetry, imageTick]);

  // Repaint when a reference image finishes loading.
  useEffect(() => onImageLoad(() => setImageTick((t) => t + 1)), []);

  // Repaint when something shown changes. Stepping onto a frame that shows the
  // same drawings (a held drawing, or animation on twos) needs no repaint.
  const lastPaint = useRef<{ paint: typeof paint; sig: string; frame: number } | null>(null);
  useEffect(() => {
    const sig = frameSignature(project, frame, playing);
    const last = lastPaint.current;
    lastPaint.current = { paint, sig, frame };
    if (last && last.frame !== frame && last.sig === sig && !gestureRef.current && sameExceptFrame.current) return;
    paint();
  }, [paint, project, frame, playing]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // The sharp canvas only matches one view: hide it while the view moves, and
  // redraw it once things settle. Playback always uses the fast canvas.
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const sv = sharpView.current;
  const sharpKey = `${sv.matrix.join(',')}|${sv.width}x${sv.height}|${playing}`;
  useLayoutEffect(() => {
    showSharp(false);
    if (playing) return;
    const t = window.setTimeout(() => {
      sharpOn.current = true;
      paintRef.current();
      showSharp(true);
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharpKey]);

  // A new or opened animation starts fitted to the screen.
  useEffect(() => { setView(FIT_VIEW); }, [project.id]);

  // Wheel: zoom around the pointer. Sideways scrolling (trackpads) or Shift+wheel pans.
  // Ctrl + mouse wheel changes the brush size instead. A trackpad pinch also arrives as a
  // wheel event with Ctrl held, but in small steps, so pinching still zooms.
  const brushSizeRef = useRef(onBrushSize);
  brushSizeRef.current = onBrushSize;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const line = e.deltaMode === 1 ? 33 : 1;
      const mouseNotch = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      // One wheel notch is one size step. Tools without a size keep zooming.
      if ((e.ctrlKey || e.metaKey) && e.deltaY !== 0 && mouseNotch && brushSizeRef.current?.(e.deltaY < 0)) return;
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
      // Ctrl/Cmd with the zoom keys also zooms here, instead of zooming the whole page.
      const mod = e.ctrlKey || e.metaKey;
      const a = actionFor(keymap, keyOf({ key: e.key, shiftKey: e.shiftKey, altKey: false, ctrlKey: false, metaKey: false }));
      let next: ((v: View) => View) | null = null;
      if (a === 'view.zoomIn') next = (v) => zoomAt(v, 1.25);
      else if (a === 'view.zoomOut') next = (v) => zoomAt(v, 0.8);
      else if (a === 'view.fit') next = () => FIT_VIEW;
      else if (a === 'view.actual') next = (v) => zoomAt(v, 1 / scale / v.zoom);
      else if (mod) return;
      else if (a === 'view.rotateLeft') next = (v) => rotateAt(v, -15);
      else if (a === 'view.rotateRight') next = (v) => rotateAt(v, 15);
      else if (a === 'view.straighten') next = (v) => rotateAt(v, -v.rotation);
      else if (a === 'view.mirror') next = (v) => flipAt(v);
      if (!next) return;
      e.preventDefault();
      setView(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scale, keymap]);

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
      // A hand resting on the screen while the pencil draws: ignore it.
      if (!touchDraws && gestureRef.current) {
        e.stopPropagation();
        if (tapsRef.current) tapsRef.current.spoiled = true;
        return;
      }
      tapsRef.current = tapDown(tapsRef.current, touches.size, e.pointerId, at, e.timeStamp);
      touches.set(e.pointerId, at);
      if (touches.size < 2) {
        // Fingers only move the canvas: one finger pans (rulers, guides and typing still take fingers).
        if (touchDraws || (e.target as HTMLElement).closest('.stage-ruler, .ruler-corner, .guide-marker, .text-entry')) return;
        e.stopPropagation();
        if (navRef.current) return;
        navRef.current = { type: 'pan', pointerId: e.pointerId, last: at };
        e.currentTarget.setPointerCapture(e.pointerId);
        setNavigating(true);
        return;
      }
      e.stopPropagation();
      const n0 = navRef.current;
      // A second finger turns a one-finger pan into a pinch.
      if (touches.size > 2 || (n0 && !(n0.type === 'pan' && touches.has(n0.pointerId)))) return;
      const g = gestureRef.current;
      if (g && touches.has(g.pointerId)) cancelGesture();
      const ids = [...touches.keys()] as [number, number];
      navRef.current = { type: 'pinch', ids, start: [touches.get(ids[0])!, touches.get(ids[1])!], view };
      e.currentTarget.setPointerCapture(e.pointerId);
      setNavigating(true);
      return;
    }
    if (e.pointerType === 'pen') {
      // The pencil takes over from a palm that started panning.
      if (tapsRef.current) tapsRef.current.spoiled = true;
      const n = navRef.current;
      if (n?.type === 'pan' && touchesRef.current.has(n.pointerId)) {
        navRef.current = null;
        setNavigating(false);
      }
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
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, at);
      tapMove(tapsRef.current, e.pointerId, at);
    }
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
    const touches = touchesRef.current;
    if (touches.delete(e.pointerId)) {
      // The system cancels touches it decides are a palm: never a tap.
      if (e.type === 'pointercancel' && tapsRef.current) tapsRef.current.spoiled = true;
      const fingers = tapUp(tapsRef.current, touches.size, e.timeStamp);
      if (!touches.size) tapsRef.current = null;
      if (fingers === 2) onUndo();
      else if (fingers === 3) onRedo();
    }
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
    const ref = layer?.reference;
    const g0 = gestureRef.current;
    if (ref) {
      const r = g0 && (g0.type === 'move' || g0.type === 'scale') ? movedRect(ref, g0.matrix) : ref;
      return { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height };
    }
    if (!paintSel && (!selection || !drawing)) return null;
    const box = paintSel ? outlineBox(paintSel) : unionBoxes(selection!.map((i) => (drawing!.strokes[i] ? strokeBounds(drawing!.strokes[i]) : null)));
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
    composeFrame(ctx, project, frame, { paper: true, references: true });
    const [r, g, b] = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    onPickColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  };

  /** Default gradient for a click without a drag: top to bottom of the area. */
  const gradientFor = (spans: number[], from?: Vec, to?: Vec): Stroke['gradient'] => {
    const b = spansBox(spans)!;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const radial = brush.fillMode === 'radial';
    const f: Vec = from ?? (radial ? [cx, cy] : [cx, b.y0]);
    const t: Vec = to ?? (radial ? [b.x1, cy] : [cx, b.y1]);
    const end = brush.fadeOut ? `${brush.color.slice(0, 7)}00` : brush.color2;
    return { type: radial ? 'radial' : 'linear', from: f, to: t, colors: [brush.color, end] };
  };

  /** The text being typed becomes a stroke. */
  const commitText = () => {
    const t = textEdit;
    const el = textRef.current;
    // Enter and the blur that follows must not add the text twice.
    if (!el || el.dataset.done) { setTextEdit(null); return; }
    el.dataset.done = '1';
    const text = el.value.replace(/\s+$/, '');
    setTextEdit(null);
    if (!t || !text.trim()) return;
    const { w, h } = measureText(text, brush.font, brush.textSize, brush.bold);
    const stroke: Stroke = {
      kind: 'text', text, font: brush.font, bold: brush.bold || undefined, points: [[t.x, t.y, 0.5], [t.x + w, t.y + h, 0.5]],
      color: brush.color, size: brush.textSize, erase: false, smoothing: 0, simulatePressure: false, thinning: 0,
      ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
    };
    commitStrokes([stroke]);
  };

  /** Add strokes to the drawing here. On a paint layer they're baked into its pixels straight away. */
  const commitStrokes = (all: Stroke[]) => {
    if (editingMask && layer) {
      let mask: Paint | null;
      try {
        mask = bakePaint(layer.mask ?? undefined, all.map(maskStroke), project.width, project.height);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not paint the mask');
        paint();
        return;
      }
      onCommit((p) => updateLayer(p, activeLayerId, { mask }));
      return;
    }
    const strokes = all.map(lockStroke);
    if (!layer?.paint) {
      onCommit((p) => strokes.reduce((q, s) => addStroke(q, activeLayerId, frame, s), p));
      return;
    }
    // Bake once, here: the history update itself may run twice.
    let baked: Paint | null;
    try {
      baked = bakePaint(drawing?.paint, [...(drawing?.strokes ?? []), ...strokes], project.width, project.height);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not paint that');
      paint();
      return;
    }
    onCommit((p) => setPaint(p, activeLayerId, frame, baked));
  };

  const fillAt = (x: number, y: number, pointerId?: number) => {
    const { width: w, height: h } = project;
    // Walls are this drawing's lines only: earlier fills can be refilled.
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // On a paint layer the walls are its paint.
    const sheet = drawing?.paint ? paintSource(drawing.paint) : null;
    if (sheet && drawing?.paint) ctx.drawImage(sheet, drawing.paint.x, drawing.paint.y);
    for (const s of drawing?.strokes ?? []) if (s.kind !== 'fill') paintStroke(ctx, s);
    const spans = floodFillSpans(ctx.getImageData(0, 0, w, h).data, w, h, x, y);
    if (!spans) {
      flash('Click inside an area, not on a line');
      return;
    }
    const stroke: Stroke = {
      kind: 'fill', spans, points: [[x, y, 0.5]], color: brush.color, size: 0, erase: false, smoothing: 0, simulatePressure: false, thinning: 0,
      ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
      ...(brush.fillMode !== 'solid' ? { gradient: gradientFor(spans) } : {}),
    };
    if (brush.fillMode !== 'solid' && pointerId !== undefined) {
      // Drag to set the gradient's direction and length; a click uses the default.
      gestureRef.current = { type: 'gradient', pointerId, stroke, start: [x, y], moved: false };
      schedulePaint();
      return;
    }
    commitStrokes([stroke]);
  };

  /** Pull a point onto a nearby guide (within 8 screen px). */
  const snap = (pt: Vec): Vec => snapToGuides(pt, project.guides, 8 / vs);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gestureRef.current || vpDrag) return;
    const pt = toPoint(e, false);
    const [x, y] = pt;

    // Drag a vanishing point, with any tool.
    if (persp && !playing) {
      const r = 14 / vs;
      const index = persp.points.findIndex(([px, py]) => Math.hypot(px - x, py - y) <= r);
      if (index >= 0) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setVpDrag({ pointerId: e.pointerId, index, pos: persp.points[index] });
        return;
      }
    }

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
    if (tool === 'text') {
      // A click while typing finishes the text; the next click starts new text.
      if (textEdit) commitText();
      else setTextEdit({ x, y: y - brush.textSize * 0.6 });
      e.preventDefault();
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const id = e.pointerId;

    if (tool === 'fill') {
      fillAt(x, y, id);
      return;
    }

    if (tool === 'smudge' || tool === 'blur') {
      let sheet: HTMLCanvasElement;
      try { sheet = paintSheet(drawing?.paint, project.width, project.height); }
      catch (err) { flash((err as Error).message); return; }
      const g: Gesture = { type: 'smear', pointerId: id, mode: tool, last: [x, y], sheet, changed: false };
      gestureRef.current = g;
      if (tool === 'blur') { blurStep(sheet, [x, y], (brush.fxSize ?? 40) / 2, brush.fxStrength ?? 0.6); g.changed = true; schedulePaint(); }
      return;
    }

    if (tool === 'liquify') {
      let sheet: HTMLCanvasElement | undefined;
      if (layer?.paint) {
        try { sheet = paintSheet(drawing?.paint, project.width, project.height); }
        catch (err) { flash((err as Error).message); return; }
      } else if (!drawing?.strokes.length) {
        flash('Nothing here to liquify yet');
        return;
      }
      gestureRef.current = { type: 'liquify', pointerId: id, last: [x, y], strokes: sheet ? undefined : drawing!.strokes, sheet, changed: false };
      return;
    }

    if (tool === 'select') {
      const box = selectionBox();
      if (box && warp && !isRef) {
        const grid = startGrid(warpBox(box));
        const r = 12 / vs;
        // The nearest handle in reach.
        let handle = -1, best = Infinity;
        grid.pts.forEach(([hx, hy], i) => {
          const d = Math.hypot(hx - x, hy - y);
          if (d <= r * 1.4 && d < best) { best = d; handle = i; }
        });
        if (handle >= 0) {
          if (paintSel) {
            try { paintSheetRef.current = paintSheet(drawing?.paint, project.width, project.height); }
            catch (err) { flash((err as Error).message); return; }
          }
          gestureRef.current = { type: 'warp', pointerId: id, handle, grid };
          return;
        }
      }
      if (box) {
        const r = 12 / vs;
        const corners: Vec[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
        const hit = corners.findIndex(([cx, cy]) => Math.abs(cx - x) <= r && Math.abs(cy - y) <= r);
        const grab = hit >= 0 || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
        if (grab && paintSel) {
          try { paintSheetRef.current = paintSheet(drawing?.paint, project.width, project.height); }
          catch (err) { flash((err as Error).message); return; }
        }
        if (hit >= 0) {
          gestureRef.current = { type: 'scale', pointerId: id, corner: corners[hit], origin: corners[(hit + 2) % 4], matrix: [1, 0, 0, 1, 0, 0] };
          return;
        }
        if (grab) {
          gestureRef.current = { type: 'move', pointerId: id, start: [x, y], matrix: [1, 0, 0, 1, 0, 0] };
          return;
        }
      }
      if (isRef) {
        flash('Drag the picture to move it, or a corner to resize it');
        return;
      }
      onSelectionChange(null);
      onPaintSelectionChange(null);
      gestureRef.current = { type: 'lasso', pointerId: id, points: [[x, y]] };
      schedulePaint();
      return;
    }

    const erase = tool === 'eraser';
    if (SHAPES.includes(tool)) {
      const [sx, sy] = snap([x, y]);
      const sp: Point = [sx, sy, 0.5];
      gestureRef.current = {
        type: 'shape', pointerId: id, start: [sx, sy],
        stroke: {
          kind: tool as Stroke['kind'], points: [sp, sp], color: brush.color, size: brush.size, erase: false,
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
        ...(!erase && brush.grain !== 'none' && brush.grainAmount > 0 ? { grain: { kind: brush.grain, amount: brush.grainAmount } } : {}),
      },
    };
    if (!erase) armQuickShape([first[0], first[1]]);
    schedulePaint();
  };

  // QuickShape: hold the pen still at the end of a stroke and it snaps into a clean shape.
  const armQuickShape = (at: Vec) => {
    const g = gestureRef.current;
    if (!g || g.type !== 'stroke' || g.quick) return;
    if (g.hold) clearTimeout(g.hold.timer);
    const timer = window.setTimeout(() => {
      const cur = gestureRef.current;
      if (cur !== g || g.quick) return;
      // Include the stretch the stabilizer hasn't caught up with yet.
      const shape = recognize([...g.stroke.points, ...catchUp(g.tip, g.pointer)], 3 / vs);
      if (!shape) return;
      const pts = g.stroke.points;
      const pressure = g.stroke.simulatePressure ? 0.5 : pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
      g.quick = { shape, from: [g.pointer[0], g.pointer[1]], pressure };
      // Draw it with an even width, like the shape tools.
      g.stroke = { ...g.stroke, simulatePressure: false, points: shapePoints(shape, pressure) };
      flash(`${SHAPE_NAMES[shape.kind]}: keep holding and drag to adjust, or lift to finish`);
      schedulePaint();
    }, HOLD_MS);
    g.hold = { at, timer };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // The brush outline follows a mouse, or an Apple Pencil hovering over the screen; never a finger.
    // It's kept in screen px within the stage and drawn outside the zoomed canvas, so it stays sharp at any zoom.
    if (e.pointerType !== 'touch') {
      const r = wrapRef.current!.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    if (vpDrag && vpDrag.pointerId === e.pointerId) {
      const [x, y] = toPoint(e, false);
      setVpDrag({ ...vpDrag, pos: [x, y] });
      return;
    }
    const g = gestureRef.current;
    if (tool === 'select' && !g) {
      const box = selectionBox();
      let over: typeof selHover = null;
      if (box) {
        const [x, y] = toPoint(e, false);
        const r = 12 / vs;
        const corners: Vec[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
        const hit = corners.findIndex(([cx, cy]) => Math.abs(cx - x) <= r && Math.abs(cy - y) <= r);
        over = hit === 0 || hit === 2 ? 'nwse' : hit >= 0 ? 'nesw' : x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 ? 'move' : null;
      }
      if (over !== selHover) setSelHover(over);
    }
    if (!g || g.pointerId !== e.pointerId) return;
    const [x, y] = toPoint(e, false);

    if (g.type === 'stroke') {
      const pen = e.pointerType === 'pen' && brush.pressure;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const raw = events.length ? events.map((ev) => toPoint(ev, pen)) : [toPoint(e, pen)];
      // The eraser isn't stabilized: it should go exactly where you point.
      const amount = g.stroke.erase ? 0 : brush.stabilizer;
      g.pointer = raw.at(-1)!;
      if (g.quick) {
        const shape = adjustShape(g.quick.shape, g.quick.from, [g.pointer[0], g.pointer[1]]);
        g.stroke = { ...g.stroke, points: shapePoints(shape, g.quick.pressure) };
      } else {
        const pts = raw.map((pt) => (g.tip = amount ? stabilize(g.tip, pt, amount) : pt));
        g.stroke = { ...g.stroke, points: [...g.stroke.points, ...pts] };
        // Moving on restarts the wait for a hold.
        if (g.hold && Math.hypot(g.pointer[0] - g.hold.at[0], g.pointer[1] - g.hold.at[1]) * vs > 8) armQuickShape([g.pointer[0], g.pointer[1]]);
      }
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
      if (!e.shiftKey && persp && g.stroke.kind === 'line') [ex, ey] = snapPerspective([sx, sy], [ex, ey], persp);
      else if (!e.shiftKey) [ex, ey] = snap([ex, ey]);
      g.stroke = { ...g.stroke, points: [g.stroke.points[0], [ex, ey, 0.5]] };
    } else if (g.type === 'gradient') {
      if (Math.hypot(x - g.start[0], y - g.start[1]) * vs > 4) g.moved = true;
      if (g.moved) g.stroke = { ...g.stroke, gradient: gradientFor(g.stroke.spans!, g.start, [x, y]) };
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
    } else if (g.type === 'liquify') {
      const delta: Vec = [x - g.last[0], y - g.last[1]];
      if (Math.hypot(delta[0], delta[1]) > 0.3) {
        const radius = (brush.liquifySize ?? 80) / 2;
        if (g.sheet) {
          pushPixels(g.sheet, g.last, delta, radius);
          g.changed = true;
        } else {
          const out = pushStrokes(g.strokes!, g.last, delta, radius);
          if (out) { g.strokes = out; g.changed = true; }
        }
        g.last = [x, y];
      }
    } else if (g.type === 'smear') {
      const r = (brush.fxSize ?? 40) / 2, k = brush.fxStrength ?? 0.6;
      const d = Math.hypot(x - g.last[0], y - g.last[1]);
      if (d >= Math.max(1, r / 6)) {
        if (g.mode === 'smudge') smudgeStep(g.sheet, g.last, [x, y], r, k);
        else {
          // Dabs along the way, a quarter of the brush apart.
          const n = Math.max(1, Math.ceil(d / Math.max(1, r / 2)));
          for (let i = 1; i <= n; i++) blurStep(g.sheet, [g.last[0] + ((x - g.last[0]) * i) / n, g.last[1] + ((y - g.last[1]) * i) / n], r, k);
        }
        g.changed = true;
        g.last = [x, y];
      }
    } else if (g.type === 'warp') {
      g.grid = { ...g.grid, pts: g.grid.pts.map((p, i) => (i === g.handle ? [x, y] : p)) };
    } else if (g.type === 'lasso') {
      g.points.push([x, y]);
    } else if (g.type === 'move') {
      g.matrix = translate(x - g.start[0], y - g.start[1]);
    } else if (g.type === 'scale') {
      const [ox, oy] = g.origin;
      const [cx, cy] = g.corner;
      let sx = (x - ox) / (cx - ox || 1);
      let sy = (y - oy) / (cy - oy || 1);
      // Pictures keep their proportions unless Shift is held; strokes the other way round.
      if (e.shiftKey !== !!layer?.reference) sx = sy = Math.max(sx, sy);
      sx = Math.max(0.05, sx);
      sy = Math.max(0.05, sy);
      g.matrix = scaleAbout(sx, sy, ox, oy);
    }
    schedulePaint();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (vpDrag && vpDrag.pointerId === e.pointerId) {
      const { index, pos } = vpDrag;
      setVpDrag(null);
      onCommit((p) => (p.perspective ? { ...p, perspective: { ...p.perspective, points: p.perspective.points.map((q, i) => (i === index ? pos : q)) } } : p));
      return;
    }
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    cancelAnimationFrame(rafRef.current);

    if (g.type === 'stroke') {
      if (g.hold) clearTimeout(g.hold.timer);
      const tail = g.quick ? [] : catchUp(g.tip, g.pointer);
      const stroke = tail.length ? { ...g.stroke, points: [...g.stroke.points, ...tail] } : g.stroke;
      commitStrokes(symmetricStrokes(stroke, symmetry, project.width, project.height));
    } else if (g.type === 'shape') {
      const [a, b] = g.stroke.points;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) commitStrokes(symmetricStrokes(g.stroke, symmetry, project.width, project.height));
      else paint();
    } else if (g.type === 'gradient') {
      commitStrokes([g.stroke]);
    } else if (g.type === 'camera') {
      const v = g.view;
      if (v !== g.base) onCommit((p) => setCameraKey(p, frame, v));
      else paint();
      setOverlayTick((t) => t + 1);
    } else if (g.type === 'smear') {
      if (!g.changed) paint();
      else {
        const next = encodePaint(g.sheet, project.width, project.height);
        onCommit((p) => setPaint(p, activeLayerId, frame, next));
      }
    } else if (g.type === 'liquify') {
      if (!g.changed) paint();
      else if (g.sheet) {
        const next = encodePaint(g.sheet, project.width, project.height);
        onCommit((p) => setPaint(p, activeLayerId, frame, next));
      } else {
        const strokes = g.strokes!;
        onCommit((p) => replaceStrokes(p, activeLayerId, frame, strokes));
      }
    } else if (g.type === 'warp') {
      const grid = g.grid;
      const sheet = paintSheetRef.current;
      paintSheetRef.current = null;
      if (paintSel && sheet) {
        const next = encodePaint(warpPaintRegion(sheet, paintSel, grid.box, (x, y) => warpPoint(grid, x, y)), project.width, project.height);
        onCommit((p) => setPaint(p, activeLayerId, frame, next));
        onPaintSelectionChange(paintSel.map(([px, py]) => warpPoint(grid, px, py)));
      } else if (selection && drawing) {
        const strokes = warpStrokes(drawing.strokes, selection, grid);
        onCommit((p) => replaceStrokes(p, activeLayerId, frame, strokes));
      } else paint();
      setOverlayTick((t) => t + 1);
    } else if (g.type === 'lasso' && layer?.paint) {
      // An area of pixels: the loop itself, if it encloses anything.
      const b = outlineBox(g.points);
      onPaintSelectionChange(g.points.length > 2 && (b.x1 - b.x0) * vs > 4 && (b.y1 - b.y0) * vs > 4 ? g.points : null);
      setOverlayTick((t) => t + 1);
    } else if (g.type === 'lasso') {
      const strokes = drawing?.strokes ?? [];
      let hits = strokesInLasso(strokes, g.points);
      if (!hits.length && g.points.length < 6) {
        // A click: pick the topmost stroke under the pointer. Lines show above fills, so try them first.
        const [x, y] = g.points[0];
        for (const fills of [false, true]) {
          for (let i = strokes.length - 1; i >= 0 && !hits.length; i--) {
            if ((strokes[i].kind === 'fill') !== fills || strokes[i].erase) continue;
            const b = strokeBounds(strokes[i]);
            if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) hits = [i];
          }
        }
      }
      onSelectionChange(hits.length ? hits : null);
      setOverlayTick((t) => t + 1);
    } else if (layer?.reference || selection || paintSel) {
      const m = g.matrix;
      const ref = layer?.reference;
      const sheet = paintSheetRef.current;
      paintSheetRef.current = null;
      if (m[0] !== 1 || m[3] !== 1 || m[4] !== 0 || m[5] !== 0) {
        if (ref) onCommit((p) => placeReference(p, activeLayerId, movedRect(ref, m)));
        else if (paintSel && sheet) {
          const moved = encodePaint(movePaintRegion(sheet, paintSel, m), project.width, project.height);
          onCommit((p) => setPaint(p, activeLayerId, frame, moved));
          onPaintSelectionChange(paintSel.map(([px, py]) => apply(m, px, py)));
        }
        else if (selection) onCommit((p) => transformStrokes(p, activeLayerId, frame, selection, m));
      } else {
        paint();
      }
    }
  };

  // Guides: drag one out of a ruler, drag its marker to move it, drop it back on the ruler to remove it.
  const guideAt = (e: React.PointerEvent, axis: GuideAxis): GuideDrag['pos'] => {
    const [lx, ly] = toLocal(e);
    return Math.round((axis === 'x' ? lx : ly) / scale);
  };
  const overRuler = (e: React.PointerEvent, axis: GuideAxis) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return axis === 'x' ? e.clientX - r.left < RULER : e.clientY - r.top < RULER;
  };
  const startGuide = (e: React.PointerEvent, axis: GuideAxis, index: number | null) => {
    if (e.button !== 0 || panKey) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setGuideDrag({ pointerId: e.pointerId, axis, index, pos: index === null ? guideAt(e, axis) : project.guides![axis][index], onRuler: true });
  };
  const moveGuideDrag = (e: React.PointerEvent) => {
    const d = guideDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    setGuideDrag({ ...d, pos: guideAt(e, d.axis), onRuler: overRuler(e, d.axis) });
  };
  const endGuideDrag = (e: React.PointerEvent) => {
    const d = guideDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    setGuideDrag(null);
    const pos = guideAt(e, d.axis);
    if (overRuler(e, d.axis)) {
      if (d.index !== null) onCommit((p) => removeGuide(p, d.axis, d.index!));
    } else if (d.index === null) {
      onCommit((p) => addGuide(p, d.axis, pos));
    } else if (pos !== project.guides?.[d.axis][d.index]) {
      onCommit((p) => moveGuide(p, d.axis, d.index!, pos));
    }
  };
  const guideHandlers = { onPointerMove: moveGuideDrag, onPointerUp: endGuideDrag, onPointerCancel: () => setGuideDrag(null) };

  const kh = (id: keyof Keymap) => (keymap[id] ? displayKey(keymap[id]) : 'no key');
  const g = gestureRef.current;
  const box = tool === 'select' ? selectionBox() : null;
  const guides = project.guides;
  const axes = symmetry !== 'off' && MIRRORED.includes(tool) && !playing;
  const straight = view.rotation === 0;
  // Ruler mapping (only while the view isn't rotated): project px → stage px.
  const sgn = view.flip ? -1 : 1;
  const toSX = (x: number) => stageSize.w / 2 + view.x + sgn * (x * scale - display.w / 2) * view.zoom;
  const toSY = (y: number) => stageSize.h / 2 + view.y + (y * scale - display.h / 2) * view.zoom;
  const ticks = (len: number, to: (v: number) => number) => {
    const step = rulerStep(vs);
    const minor = step / (String(step)[0] === '2' ? 4 : 5);
    const a = (0 - to(0)) / (to(1) - to(0));
    const b = (len - to(0)) / (to(1) - to(0));
    const out: { v: number; at: number; major: boolean }[] = [];
    for (let k = Math.ceil(Math.min(a, b) / minor); k <= Math.floor(Math.max(a, b) / minor); k++) {
      const v = Math.round(k * minor * 1000) / 1000;
      out.push({ v, at: to(v), major: Math.abs(v / step - Math.round(v / step)) < 1e-6 });
    }
    return out;
  };
  // The camera's frame: shown while the camera tool is on, or faintly whenever the camera moves.
  const camView = g?.type === 'camera' ? g.view : !playing && (tool === 'camera' || hasCamera(project)) ? cameraAt(project, frame) : null;
  const camCorners = camView ? cameraCorners(camView, project.width, project.height) : null;
  const camActive = tool === 'camera';
  const showBrushCursor = (tool === 'brush' || tool === 'eraser' || tool === 'liquify' || tool === 'smudge' || tool === 'blur') && cursor && !blocked && !panKey && !navigating;
  const cursorSize = (tool === 'eraser' ? brush.eraserSize : tool === 'liquify' ? brush.liquifySize ?? 80 : tool === 'smudge' || tool === 'blur' ? brush.fxSize ?? 40 : brush.size) * scale * view.zoom;
  const canvasClass = tool === 'camera' ? 'camera' : tool === 'eyedropper' ? 'pick' : blocked && EDITS.includes(tool) ? 'blocked' : tool === 'fill' ? 'fill' : tool === 'text' ? 'text' : tool === 'select' ? `select${selHover ? ` ${selHover}` : ''}` : 'draw';
  const hs = 10 / vs; // handle size in project px

  return (
    <div
      className={`stage${rulers && !playing ? ' with-rulers' : ''}${panKey ? ' pan' : ''}${navigating ? ' grabbing' : ''}`}
      ref={wrapRef}
      onPointerDownCapture={onNavDown}
      onPointerMove={onNavMove}
      onPointerUp={onNavUp}
      onPointerCancel={onNavUp}
    >
      <canvas ref={sharpRef} className="sharp" aria-hidden="true" style={{ width: stageSize.w, height: stageSize.h }} />
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
        {(box || camCorners || guides || guideDrag || axes || (persp && !playing) || g?.type === 'lasso' || (g?.type === 'stroke' && brush.stabilizer > 0 && !g.stroke.erase)) && (
          <svg className="overlay" viewBox={`0 0 ${project.width} ${project.height}`} aria-hidden="true">
            {axes && (
              <g className="symmetry-axes" stroke="#c45bd6" strokeWidth={1.2 / vs} strokeDasharray={`${10 / vs} ${6 / vs}`}>
                {symmetry !== 'y' && <line x1={project.width / 2} y1={0} x2={project.width / 2} y2={project.height} />}
                {symmetry !== 'x' && <line x1={0} y1={project.height / 2} x2={project.width} y2={project.height / 2} />}
              </g>
            )}
            {persp && !playing && (() => {
              const pts = persp.points.map((p, i) => (vpDrag?.index === i ? vpDrag.pos : p));
              const far = 4 * (project.width + project.height);
              return (
                <g className="perspective" stroke="#f08c00" strokeWidth={1 / vs}>
                  {pts.length === 2
                    ? <line x1={pts[0][0] - (pts[1][0] - pts[0][0]) * 50} y1={pts[0][1] - (pts[1][1] - pts[0][1]) * 50} x2={pts[1][0] + (pts[1][0] - pts[0][0]) * 50} y2={pts[1][1] + (pts[1][1] - pts[0][1]) * 50} strokeWidth={1.5 / vs} />
                    : <line x1={-far} y1={pts[0][1]} x2={far} y2={pts[0][1]} strokeWidth={1.5 / vs} />}
                  {pts.map(([px, py], i) => (
                    <g key={i} opacity={0.35}>
                      {Array.from({ length: 36 }, (_, k) => {
                        const a = (k / 36) * Math.PI * 2;
                        return <line key={k} x1={px} y1={py} x2={px + Math.cos(a) * far} y2={py + Math.sin(a) * far} />;
                      })}
                    </g>
                  ))}
                  {pts.map(([px, py], i) => <circle key={`h${i}`} className="vp-handle" cx={px} cy={py} r={7 / vs} fill="#fff" strokeWidth={2 / vs} />)}
                </g>
              );
            })()}
            {!playing && (guides || guideDrag) && (
              <g className="guides" stroke="#22b8cf" strokeWidth={1 / vs}>
                {guides?.x.map((x, i) => !(guideDrag?.axis === 'x' && guideDrag.index === i) && <line key={`x${i}`} x1={x} y1={-1e5} x2={x} y2={1e5} />)}
                {guides?.y.map((y, i) => !(guideDrag?.axis === 'y' && guideDrag.index === i) && <line key={`y${i}`} x1={-1e5} y1={y} x2={1e5} y2={y} />)}
                {guideDrag && !guideDrag.onRuler && (guideDrag.axis === 'x'
                  ? <line x1={guideDrag.pos} y1={-1e5} x2={guideDrag.pos} y2={1e5} strokeDasharray={`${4 / vs} ${3 / vs}`} />
                  : <line x1={-1e5} y1={guideDrag.pos} x2={1e5} y2={guideDrag.pos} strokeDasharray={`${4 / vs} ${3 / vs}`} />)}
              </g>
            )}
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
            {g?.type === 'gradient' && g.moved && g.stroke.gradient && (
              <g>
                <line x1={g.stroke.gradient.from[0]} y1={g.stroke.gradient.from[1]} x2={g.stroke.gradient.to[0]} y2={g.stroke.gradient.to[1]} stroke="#f0a43a" strokeWidth={1.5 / vs} />
                <circle cx={g.stroke.gradient.from[0]} cy={g.stroke.gradient.from[1]} r={4 / vs} fill="#fff" stroke="#f0a43a" strokeWidth={1.5 / vs} />
                <circle cx={g.stroke.gradient.to[0]} cy={g.stroke.gradient.to[1]} r={4 / vs} fill="#f0a43a" />
              </g>
            )}
            {g?.type === 'lasso' && (
              <polyline points={g.points.map((p) => p.join(',')).join(' ')} fill="rgba(240,164,58,0.08)" stroke="#f0a43a" strokeWidth={1.5 / vs} strokeDasharray={`${5 / vs} ${4 / vs}`} />
            )}
            {box && paintSel && g?.type !== 'warp' && (
              <polygon
                points={paintSel.map((p) => p.join(',')).join(' ')}
                transform={g && (g.type === 'move' || g.type === 'scale') ? `matrix(${g.matrix.join(' ')})` : undefined}
                fill="none" stroke="#f0a43a" strokeWidth={1.5 / vs} strokeDasharray={`${5 / vs} ${4 / vs}`}
              />
            )}
            {box && mask && g?.type !== 'warp' && (
              // The selection's own edges: a rim just outside the selected strokes.
              <g transform={g && (g.type === 'move' || g.type === 'scale') ? `matrix(${g.matrix.join(' ')})` : undefined}>
                <filter id="selection-edge" x={mask.x - 8} y={mask.y - 8} width={mask.width + 16} height={mask.height + 16} filterUnits="userSpaceOnUse">
                  <feMorphology in="SourceAlpha" operator="dilate" radius={3 / vs} result="outer" />
                  <feMorphology in="SourceAlpha" operator="dilate" radius={2 / vs} result="inner" />
                  <feFlood floodColor="#fff" />
                  <feComposite in2="outer" operator="in" result="halo" />
                  <feFlood floodColor="#f0a43a" />
                  <feComposite in2="inner" operator="in" result="edge" />
                  <feMerge><feMergeNode in="halo" /><feMergeNode in="edge" /></feMerge>
                  <feComposite in2="SourceAlpha" operator="out" />
                </filter>
                <image className="selection-edge" href={mask.url} x={mask.x} y={mask.y} width={mask.width} height={mask.height} filter="url(#selection-edge)" />
              </g>
            )}
            {box && warp && !isRef && (() => {
              const grid = g?.type === 'warp' ? g.grid : startGrid(warpBox(box));
              const p = grid.pts;
              const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8]];
              return (
                <g className="warp-grid">
                  {lines.map((l, i) => (
                    <polyline key={i} points={l.map((k) => p[k].join(',')).join(' ')} fill="none" stroke="#f0a43a" strokeWidth={1 / vs} strokeDasharray={`${4 / vs} ${3 / vs}`} />
                  ))}
                  {p.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={hs / 2} fill="#fff" stroke="#f0a43a" strokeWidth={1.5 / vs} />)}
                </g>
              );
            })()}
            {box && !(warp && !isRef) && (
              <g>
                <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="none" stroke="#f0a43a" strokeWidth={(mask || paintSel ? 1 : 1.5) / vs} strokeOpacity={mask || paintSel ? 0.45 : 1} strokeDasharray={`${6 / vs} ${4 / vs}`} />
                {[[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([cx, cy], i) => (
                  <rect key={i} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#f0a43a" strokeWidth={1.5 / vs} />
                ))}
              </g>
            )}
          </svg>
        )}
        {textEdit && (
          <textarea
            ref={textRef} className="text-entry" autoFocus rows={1} spellCheck={false} aria-label="Text"
            placeholder="Type, then Enter"
            style={{
              left: textEdit.x * scale, top: textEdit.y * scale, color: brush.color, opacity: brush.opacity,
              font: fontCss(brush.font, brush.textSize * scale, brush.bold), lineHeight: LINE_HEIGHT,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
              if (e.key === 'Escape') setTextEdit(null);
            }}
            onBlur={commitText}
          />
        )}
      </div>
      {showBrushCursor && cursorSize > 4 && (
        <div
          className="brush-cursor"
          style={{ width: cursorSize, height: cursorSize, left: cursor.x - cursorSize / 2, top: cursor.y - cursorSize / 2 }}
        />
      )}
      {rulers && !playing && (
        <>
          <div
            className={`stage-ruler top${straight ? '' : ' off'}`} {...guideHandlers}
            title={straight ? 'Drag down onto the canvas to add a guide. Drag a guide back here to remove it.' : `Straighten the view (${kh('view.straighten')}) to read the rulers. You can still drag guides out.`}
            onPointerDown={(e) => startGuide(e, 'y', null)}
          >
            {straight && (
              <svg width={stageSize.w} height={RULER} aria-hidden="true">
                {ticks(stageSize.w, toSX).map((t) => (
                  <g key={t.v}>
                    <line x1={t.at} x2={t.at} y1={t.major ? 4 : 14} y2={RULER} />
                    {t.major && <text x={t.at + 3} y={11}>{t.v}</text>}
                  </g>
                ))}
              </svg>
            )}
            {straight && guides?.x.map((x, i) => (
              <span
                key={i} className="guide-marker x" style={{ left: toSX(x) }} title={`Guide at x ${x}. Drag to move it, drag it back onto the ruler or double-click to remove it.`}
                onPointerDown={(e) => startGuide(e, 'x', i)} onDoubleClick={() => onCommit((p) => removeGuide(p, 'x', i))}
              />
            ))}
          </div>
          <div
            className={`stage-ruler left${straight ? '' : ' off'}`} {...guideHandlers}
            title={straight ? 'Drag right onto the canvas to add a guide. Drag a guide back here to remove it.' : `Straighten the view (${kh('view.straighten')}) to read the rulers. You can still drag guides out.`}
            onPointerDown={(e) => startGuide(e, 'x', null)}
          >
            {straight && (
              <svg width={RULER} height={stageSize.h} aria-hidden="true">
                {ticks(stageSize.h, toSY).map((t) => (
                  <g key={t.v}>
                    <line y1={t.at} y2={t.at} x1={t.major ? 4 : 14} x2={RULER} />
                    {t.major && <text transform={`translate(11 ${t.at + 3}) rotate(-90)`}>{t.v}</text>}
                  </g>
                ))}
              </svg>
            )}
            {straight && guides?.y.map((y, i) => (
              <span
                key={i} className="guide-marker y" style={{ top: toSY(y) }} title={`Guide at y ${y}. Drag to move it, drag it back onto the ruler or double-click to remove it.`}
                onPointerDown={(e) => startGuide(e, 'y', i)} onDoubleClick={() => onCommit((p) => removeGuide(p, 'y', i))}
              />
            ))}
          </div>
          <div className="ruler-corner" title={`Hide the rulers (${kh('rulers.toggle')})`} onClick={() => onRulersChange(false)}>×</div>
        </>
      )}
      {note && <div className="stage-note" role="status">{note}</div>}
      <div className="view-controls" role="group" aria-label="View">
        <button className="icon-btn" aria-label="Zoom out" title={`Zoom out (${kh('view.zoomOut')}, or scroll the mouse wheel)`} onClick={() => setView((v) => zoomAt(v, 0.8))}><I.Minus /></button>
        <button className="zoom-value" title={`Zoom level. Click for actual size, 1 pixel per pixel (${kh('view.actual')})`} onClick={() => setView((v) => zoomAt(v, 1 / scale / v.zoom))}>{Math.round(vs * 100)}%</button>
        <button className="icon-btn" aria-label="Zoom in" title={`Zoom in (${kh('view.zoomIn')}, or scroll the mouse wheel)`} onClick={() => setView((v) => zoomAt(v, 1.25))}><I.Plus /></button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Rotate left" title={`Rotate the view 15° left (${kh('view.rotateLeft')}). On a touch screen, twist two fingers.`} onClick={() => setView((v) => rotateAt(v, -15))}><I.RotateLeft /></button>
        {view.rotation !== 0 && (
          <button className="zoom-value" title={`Rotation of the view. Click to straighten it (${kh('view.straighten')})`} onClick={() => setView((v) => rotateAt(v, -v.rotation))}>{Math.round(view.rotation)}°</button>
        )}
        <button className="icon-btn" aria-label="Rotate right" title={`Rotate the view 15° right (${kh('view.rotateRight')})`} onClick={() => setView((v) => rotateAt(v, 15))}><I.RotateRight /></button>
        <button className={`icon-btn${view.flip ? ' on' : ''}`} aria-label="Mirror view" aria-pressed={view.flip} title={`Mirror the view left to right to check your drawing with fresh eyes (${kh('view.mirror')}). The drawing itself doesn't change.`} onClick={() => setView((v) => flipAt(v))}><I.Mirror /></button>
        <button className={`icon-btn${rulers ? ' on' : ''}`} aria-label="Rulers and guides" aria-pressed={rulers} title={`Show rulers to drag guides out of (${kh('rulers.toggle')}). Shapes snap to guides.`} onClick={() => onRulersChange(!rulers)}><I.Ruler /></button>
        <span className="sep" />
        <button className="btn small" title={`Fit the whole canvas on screen and straighten it (${kh('view.fit')}). Pan with Space+drag, the middle mouse button or two fingers.`} onClick={() => setView(FIT_VIEW)}>Fit</button>
      </div>
    </div>
  );
}
