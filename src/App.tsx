import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportDialog } from './components/ExportDialog';
import * as I from './components/Icons';
import { DEFAULT_ONION, LayersPanel, type OnionState } from './components/LayersPanel';
import { Splitter } from './components/Splitter';
import { addReferenceLayer, defaultPerspective, referenceGotDrawings, type Symmetry } from './model/aids';
import { readImageFile } from './images';
import { actionFor, displayKey, keyOf, loadKeymap, type ActionId, type Keymap } from './keys';
import { useLongPress } from './components/longPress';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { nextFrame, PLAY_MODES, type PlayMode } from './model/playback';
import { encodePaint, FONTS, movePaintRegion, paintSheet } from './render/render';
import { Stage, type BrushSettings, type Tool } from './components/Stage';
import { Timeline, type FrameAction } from './components/Timeline';
import { commit, initHistory, redo, undo, type History } from './model/history';
import { scaleAbout, strokeBounds, translate, unionBoxes } from './model/geometry';
import * as P from './model/project';
import { groupLayer, isLocked, isShown, moveGroupToGap, removeGroup, ungroup, updateGroup } from './model/groups';
import { cameraAt, hasCamera, keyAt, removeCameraKey, setCameraKey } from './model/camera';
import { readAudioFile, useAudioPlayback } from './audio';
import { matchingPreset, PRESETS, validBrush, type BrushPreset } from './model/brushes';
import { BrushEditor } from './components/BrushEditor';
import { BrushSample } from './components/BrushSample';
import { AdjustDialog } from './components/AdjustDialog';
import { ReferenceWindow } from './components/ReferenceWindow';
import { TimelapseDialog } from './components/TimelapseDialog';
import { recordChange } from './timelapse';
import { ColourPicker } from './components/ColourPicker';
import { HARMONIES, remember, type Harmony } from './model/colour';
import {
  canSaveToFile, filePermission, loadCurrentProject, loadLinkedFile, pickOpenFile, pickSaveFile, readProjectFile, rememberLinkedFile,
  saveCurrentProject, saveProjectFile, writeProjectFile, type LinkedFile,
} from './storage';

type FileStatus = 'saved' | 'saving' | 'paused' | 'error';

const TOOLS: { id: Tool; name: string; key: string; help: string; Icon: () => React.JSX.Element }[] = [
  { id: 'brush', name: 'Brush', key: 'b', help: 'draw freehand lines', Icon: I.Brush },
  { id: 'eraser', name: 'Eraser', key: 'e', help: 'erase parts of the current drawing', Icon: I.Eraser },
  { id: 'line', name: 'Line', key: 'l', help: 'draw straight lines', Icon: I.Line },
  { id: 'rect', name: 'Rectangle', key: 'r', help: 'draw rectangles', Icon: I.Rect },
  { id: 'ellipse', name: 'Ellipse', key: 'c', help: 'draw ellipses and circles', Icon: I.Ellipse },
  { id: 'fill', name: 'Fill', key: 'g', help: 'fill a closed area with colour', Icon: I.Bucket },
  { id: 'text', name: 'Text', key: 't', help: 'click the canvas and type. Enter finishes, Shift+Enter starts a new line', Icon: I.Text },
  { id: 'eyedropper', name: 'Eyedropper', key: 'i', help: 'pick a colour from the canvas', Icon: I.Dropper },
  { id: 'select', name: 'Lasso select', key: 's', help: 'select strokes to move, resize, flip or delete', Icon: I.Lasso },
  { id: 'liquify', name: 'Liquify', key: 'w', help: 'push lines or paint around, like a finger in wet paint, to nudge a pose or squash and stretch', Icon: I.Liquify },
  { id: 'smudge', name: 'Smudge', key: 'u', help: 'drag colours into each other on a paint layer, like a finger in wet paint', Icon: I.Smudge },
  { id: 'blur', name: 'Blur', key: 'j', help: 'soften paint under the brush on a paint layer', Icon: I.Blur },
  { id: 'camera', name: 'Camera', key: 'k', help: 'frame the shot: pan, zoom and rotate the camera, keyed over time', Icon: I.Camera },
];
const COLOUR_TOOLS: Tool[] = ['brush', 'line', 'rect', 'ellipse', 'fill', 'text', 'eyedropper'];
const KEYS_KEY = 'animator:keys';

const DEFAULT_PALETTE = ['#1a1a1a', '#6b6f78', '#e5534b', '#f08a3a', '#f2c94c', '#6faf6a', '#5b8fd9', '#9b6fd6', '#ffffff'];
const PALETTE_KEY = 'animator:palette';
const RECENT_KEY = 'animator:recent-colours';
const HARMONY_KEY = 'animator:harmony';
const BRUSH_KEY = 'animator:brush';
const BRUSHES_KEY = 'animator:brushes';
const ONION_KEY = 'animator:onion';
const SCRUB_KEY = 'animator:scrub';
const PANELS_KEY = 'animator:panels';
const FINGERS_KEY = 'animator:fingers';
const PEN_SEEN_KEY = 'animator:pen-seen';

/** What a finger does on the canvas. 'auto' draws until an Apple Pencil (or other pen) is used, then moves the canvas. */
type Fingers = 'auto' | 'draw' | 'navigate';

interface Panels {
  /** Width of the left panel with the current tool's settings. */
  options: number;
  layers: number;
  timeline: number;
  /** The bar of tools under the top bar. */
  hideTools: boolean;
  hideLayers: boolean;
  hideTimeline: boolean;
  /** The left panel with the current tool's settings. */
  hideOptions: boolean;
}
const DEFAULT_PANELS: Panels = { options: 230, layers: 280, timeline: 220, hideTools: false, hideLayers: false, hideTimeline: false, hideOptions: false };
/** A phone, or a small window: start with the layers panel hidden and a short timeline. */
const smallScreen = () => typeof window !== 'undefined' && (window.innerWidth < 760 || window.innerHeight < 520);
const COMPACT_PANELS: Partial<Panels> = { options: 170, layers: 220, timeline: 110, hideLayers: true };
const PANEL_LIMITS = { options: [110, 420], layers: [200, 560], timeline: [110, 640] } as const;
const clampPanel = (k: keyof typeof PANEL_LIMITS, v: number) => Math.round(Math.min(PANEL_LIMITS[k][1], Math.max(PANEL_LIMITS[k][0], v)));
const MAX_PALETTE = 24;

const INK = PRESETS.find((p) => p.id === 'ink')!;
const DEFAULT_BRUSH: BrushSettings = {
  color: '#1a1a1a', eraserSize: 24, liquifySize: 80, fxSize: 40, fxStrength: 0.6, pressure: true, fillShapes: false,
  fillMode: 'solid', color2: '#ffffff', fadeOut: true, font: 'sans', textSize: 48, bold: false,
  size: INK.size, opacity: INK.opacity, smoothing: INK.smoothing, stabilizer: INK.stabilizer, thinning: INK.thinning, softness: INK.softness,
  grain: 'none', grainAmount: 0,
};

/** Per-browser preferences: the palette and the last brush. Storage can be blocked, so every access is guarded. */
function loadPref<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v !== null && valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not saved; fine */ }
}
const AIDS_KEY = 'animator:aids';
const SYMMETRY: { id: Symmetry; name: string }[] = [
  { id: 'off', name: 'Off' }, { id: 'x', name: 'Left–right' }, { id: 'y', name: 'Top–bottom' }, { id: 'xy', name: 'Both' },
];
/** The size each tool's [ and ] change, and its range. */
type SizeKey = 'size' | 'eraserSize' | 'liquifySize' | 'fxSize' | 'textSize';
const SIZED: Partial<Record<Tool, { key: SizeKey; min: number; max: number }>> = {
  brush: { key: 'size', min: 1, max: 60 },
  line: { key: 'size', min: 1, max: 60 },
  rect: { key: 'size', min: 1, max: 60 },
  ellipse: { key: 'size', min: 1, max: 60 },
  eraser: { key: 'eraserSize', min: 1, max: 120 },
  liquify: { key: 'liquifySize', min: 10, max: 400 },
  smudge: { key: 'fxSize', min: 4, max: 300 },
  blur: { key: 'fxSize', min: 4, max: 300 },
  text: { key: 'textSize', min: 8, max: 240 },
};
/** One step smaller or bigger: 1 px for thin sizes, about a tenth for big ones, so every range takes a similar number of presses. */
function stepSize(v: number, r: { min: number; max: number }, bigger: boolean): number {
  const step = Math.max(1, Math.round(v * 0.1));
  return Math.min(r.max, Math.max(r.min, bigger ? v + step : v - step));
}
const isHex = (c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function App() {
  const [history, setHistory] = useState<History<P.Project>>(() => initHistory(P.createProject()));
  const [loaded, setLoaded] = useState(false);
  const project = history.present;
  const [activeLayerId, setActiveLayerId] = useState(() => history.present.layers.at(-1)!.id);
  const [frame, setFrame] = useState(0);
  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState<BrushSettings>(() => {
    const saved = loadPref<Partial<BrushSettings>>(BRUSH_KEY, {}, (v) => typeof v === 'object');
    const merged = { ...DEFAULT_BRUSH, ...saved };
    return Object.keys(DEFAULT_BRUSH).every((k) => typeof merged[k as keyof BrushSettings] === typeof DEFAULT_BRUSH[k as keyof BrushSettings]) ? merged : DEFAULT_BRUSH;
  });
  const [palette, setPalette] = useState<string[]>(() => loadPref(PALETTE_KEY, DEFAULT_PALETTE, (v) => Array.isArray(v) && v.length > 0 && v.every(isHex)));
  useEffect(() => { savePref(BRUSH_KEY, brush); }, [brush]);
  useEffect(() => { savePref(PALETTE_KEY, palette); }, [palette]);
  /** Colour disc: where it opens, the harmony shown, and the colours picked lately. */
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [harmonyKind, setHarmonyKind] = useState<Harmony>(() => loadPref(HARMONY_KEY, 'complementary' as Harmony, (v) => HARMONIES.some((h) => h.id === v)));
  useEffect(() => { savePref(HARMONY_KEY, harmonyKind); }, [harmonyKind]);
  const [recentColours, setRecentColours] = useState<string[]>(() => loadPref(RECENT_KEY, [] as string[], (v) => Array.isArray(v) && v.every(isHex)));
  useEffect(() => { savePref(RECENT_KEY, recentColours); }, [recentColours]);
  // A colour joins the recent ones once it has been kept for a moment (not every step of a drag on the disc).
  useEffect(() => {
    const t = window.setTimeout(() => setRecentColours((r) => (r[0] === brush.color.toLowerCase() ? r : remember(r, brush.color))), 700);
    return () => window.clearTimeout(t);
  }, [brush.color]);
  /** Brushes the user saved in the brush editor. */
  const [savedBrushes, setSavedBrushes] = useState<BrushPreset[]>(() => {
    const list = loadPref<unknown[]>(BRUSHES_KEY, [], Array.isArray);
    return list.map(validBrush).filter((b): b is BrushPreset => !!b);
  });
  useEffect(() => { savePref(BRUSHES_KEY, savedBrushes); }, [savedBrushes]);
  const [brushEditor, setBrushEditor] = useState(false);
  /** Adjust colours: open, and the change shown on the canvas before it's applied. */
  const [adjusting, setAdjusting] = useState(false);
  /** Painting the active layer's mask. */
  const [maskEdit, setMaskEdit] = useState(false);
  /** The floating reference window. */
  const [refWindow, setRefWindow] = useState(false);
  useEffect(() => { setMaskEdit(false); }, [activeLayerId]);
  const [adjustPreview, setAdjustPreview] = useState<P.Project | null>(null);
  const preset = matchingPreset(brush, savedBrushes);
  const usePreset = (p: BrushPreset) => setBrush((b) => ({
    ...b, size: p.size, opacity: p.opacity, smoothing: p.smoothing, stabilizer: p.stabilizer, thinning: p.thinning, softness: p.softness, pressure: p.thinning > 0,
    grain: p.grain ?? 'none', grainAmount: p.grainAmount ?? 0,
  }));
  const [selection, setSelection] = useState<number[] | null>(null);
  /** Paint layers: the outline of the selected area. */
  const [paintSel, setPaintSel] = useState<[number, number][] | null>(null);
  /** Lasso: bend the selection with a grid of handles instead of moving it. */
  const [warp, setWarp] = useState(false);
  const hasSelection = !!selection || !!paintSel;
  useEffect(() => { if (!hasSelection) setWarp(false); }, [hasSelection]);
  /** A group row selected in the Layers panel (its opacity and blend show there). */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [onion, setOnion] = useState<OnionState>(() => ({ ...DEFAULT_ONION, ...loadPref<Partial<OnionState>>(ONION_KEY, {}, (v) => typeof v === 'object') }));
  useEffect(() => { savePref(ONION_KEY, onion); }, [onion]);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>('loop');
  const playDir = useRef<1 | -1>(1);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseRef = useRef<P.Project | null>(null);
  /** The file on disk this animation auto-saves to, once one has been chosen with Save to file. */
  const [linked, setLinked] = useState<LinkedFile | null>(null);
  const [fileStatus, setFileStatus] = useState<FileStatus>('saved');
  const lastWritten = useRef<P.Project | null>(null);
  /** Strokes copied with Ctrl+C or the frame menu. */
  const [clipboard, setClipboard] = useState<P.Stroke[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  /** Space is held. Tapping it plays; holding it and dragging pans the canvas. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** Same as spaceHeld, readable right away in key handlers. */
  const spaceDown = useRef(false);
  const spacePanned = useRef(false);
  /** Selection to keep after a paste, instead of clearing it when the drawing or tool changes. */
  const keepSelection = useRef<number[] | null>(null);

  /** Drawing aids kept in this browser: symmetry and rulers. */
  const [aids, setAids] = useState<{ symmetry: Symmetry; rulers: boolean }>(() => {
    const v = loadPref<{ symmetry?: unknown; rulers?: unknown }>(AIDS_KEY, {}, (x) => typeof x === 'object');
    return { symmetry: SYMMETRY.some((m) => m.id === v.symmetry) ? (v.symmetry as Symmetry) : 'off', rulers: v.rulers === true };
  });
  useEffect(() => { savePref(AIDS_KEY, aids); }, [aids]);
  const imageInput = useRef<HTMLInputElement>(null);
  const addReference = async (file: File) => {
    try {
      const image = await readImageFile(file, project.width, project.height);
      apply((p) => addReferenceLayer(p, file.name.replace(/\.[^.]+$/, '') || 'Reference', image).project);
      notify('Reference added at the bottom. Select its layer and use the Lasso tool to move or resize it.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not add that picture.');
    }
  };
  const notifyRef = useRef<(text: string) => void>(() => {});
  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap(loadPref<unknown>(KEYS_KEY, null, () => true)));
  useEffect(() => { savePref(KEYS_KEY, keymap); }, [keymap]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fingers, setFingers] = useState<Fingers>(() => loadPref<Fingers>(FINGERS_KEY, 'auto', (v) => v === 'auto' || v === 'draw' || v === 'navigate'));
  useEffect(() => { savePref(FINGERS_KEY, fingers); }, [fingers]);
  const [penSeen, setPenSeen] = useState(() => loadPref(PEN_SEEN_KEY, false, (v) => typeof v === 'boolean'));
  useEffect(() => {
    if (penSeen) return;
    const onPen = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      setPenSeen(true);
      savePref(PEN_SEEN_KEY, true);
    };
    window.addEventListener('pointerdown', onPen, true);
    return () => window.removeEventListener('pointerdown', onPen, true);
  }, [penSeen]);
  const touchDraws = fingers === 'draw' || (fingers === 'auto' && !penSeen);
  const holdSwatch = useLongPress();
  /** A tool's shortcut, for tooltips: ' (B)', or nothing when it has no key. */
  const keyHint = (id: ActionId) => (keymap[id] ? ` (${displayKey(keymap[id])})` : '');

  const length = P.sceneLength(project);
  const [panels, setPanels] = useState<Panels>(() => {
    const p: Panels = { ...DEFAULT_PANELS, ...(smallScreen() ? COMPACT_PANELS : {}), ...loadPref<Partial<Panels>>(PANELS_KEY, {}, (v) => typeof v === 'object') };
    // Sizes saved before the limits changed are brought back inside them.
    for (const k of Object.keys(PANEL_LIMITS) as (keyof typeof PANEL_LIMITS)[]) p[k] = clampPanel(k, Number(p[k]) || DEFAULT_PANELS[k]);
    return p;
  });
  useEffect(() => { savePref(PANELS_KEY, panels); }, [panels]);
  /** Panel size when a resize drag started. */
  const panelStart = useRef<Panels | null>(null);
  const resizePanel = (k: 'options' | 'layers' | 'timeline') => (grow: number, done: boolean) => {
    if (!panelStart.current) panelStart.current = panels;
    const base = panelStart.current[k];
    setPanels((p) => ({ ...p, [k]: clampPanel(k, base + grow) }));
    if (done) panelStart.current = null;
  };
  const togglePanel = (k: 'hideTools' | 'hideLayers' | 'hideTimeline' | 'hideOptions') => setPanels((p) => ({ ...p, [k]: !p[k] }));
  const [scrub, setScrub] = useState(() => loadPref(SCRUB_KEY, true, (v) => typeof v === 'boolean'));
  useEffect(() => { savePref(SCRUB_KEY, scrub); }, [scrub]);
  useAudioPlayback(project, frame, playing, scrub);
  const audioInput = useRef<HTMLInputElement>(null);
  const addAudio = async (file: File) => {
    try {
      const audio = await readAudioFile(file);
      apply((p) => ({ ...p, audio }));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not add that sound.');
    }
  };

  /** Change the project. `record: false` previews a change (e.g. while dragging a slider) without an undo step. */
  const apply = useCallback((fn: (p: P.Project) => P.Project, record = true) => {
    setHistory((h) => {
      const next = fn(h.present);
      // Reference images never hold drawings: refuse edits that would give them some.
      if (next !== h.present && referenceGotDrawings(next) && !referenceGotDrawings(h.present)) {
        queueMicrotask(() => notifyRef.current('This is a reference image. Pick another layer to draw or add frames on.'));
        return h;
      }
      if (!record) {
        if (!baseRef.current) baseRef.current = h.present;
        return { ...h, present: next };
      }
      const base = baseRef.current;
      baseRef.current = null;
      if (base) return commit({ ...h, present: base }, next);
      return commit(h, next);
    });
  }, []);

  // Load the last project from the browser, then autosave every change.
  useEffect(() => {
    Promise.all([loadCurrentProject(), loadLinkedFile()]).then(async ([saved, file]) => {
      if (saved) {
        setHistory(initHistory(saved));
        setActiveLayerId(saved.layers.at(-1)!.id);
        lastWritten.current = saved;
        if (file && file.projectId === saved.id) {
          setLinked(file);
          // After a reload the browser asks again before writing to the file.
          setFileStatus((await filePermission(file, false).catch(() => false)) ? 'saved' : 'paused');
        }
      }
      setLoaded(true);
    });
  }, []);

  // Timelapse: a picture of the frame after each change to the same animation (not on load or open).
  const timelapsePrev = useRef<P.Project | null>(null);
  useEffect(() => {
    const prev = timelapsePrev.current;
    timelapsePrev.current = project;
    if (loaded && prev && prev !== project && prev.id === project.id) recordChange(project, frame);
  }, [project, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [timelapse, setTimelapse] = useState(false);

  // Auto-save to the linked file too, a moment after each change.
  useEffect(() => {
    if (!linked || linked.projectId !== project.id || fileStatus === 'paused' || project === lastWritten.current) return;
    const id = window.setTimeout(async () => {
      setFileStatus('saving');
      try {
        await writeProjectFile(linked, project);
        lastWritten.current = project;
        setFileStatus('saved');
      } catch (err) {
        setFileStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'paused' : 'error');
      }
    }, 800);
    return () => window.clearTimeout(id);
  }, [project, linked, fileStatus]);

  const linkFile = useCallback((file: LinkedFile | null, written: P.Project | null) => {
    setLinked(file);
    lastWritten.current = written;
    setFileStatus('saved');
    rememberLinkedFile(file);
  }, []);
  // Save at once after a quiet spell, then at most every 400 ms while changes keep coming (slider drags).
  const lastSave = useRef(0);
  useEffect(() => {
    if (!loaded) return;
    const save = () => { lastSave.current = performance.now(); saveCurrentProject(project).catch(() => {}); };
    const wait = 400 - (performance.now() - lastSave.current);
    if (wait <= 0) { save(); return; }
    const id = window.setTimeout(save, wait);
    return () => window.clearTimeout(id);
  }, [project, loaded]);
  // Save straight away when the tab is hidden or closed, so the last stroke isn't lost.
  const latest = useRef(project);
  latest.current = project;
  useEffect(() => {
    if (!loaded) return;
    const flush = () => { saveCurrentProject(latest.current).catch(() => {}); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loaded]);

  // Keep the selected layer valid after undo or layer deletion.
  useEffect(() => {
    if (!project.layers.some((l) => l.id === activeLayerId)) setActiveLayerId(project.layers.at(-1)!.id);
  }, [project, activeLayerId]);

  // Playback.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const step = 1000 / project.fps;
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      while (acc >= step) {
        acc -= step;
        setFrame((f) => {
          const n = nextFrame(f, length, playMode, playDir.current);
          playDir.current = n.dir;
          if (n.stop) setPlaying(false);
          return n.frame;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project.fps, length, playMode]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      playDir.current = 1;
      if (!p && frame >= length - 1 && playMode !== 'pingpong') setFrame(0);
      return !p;
    });
  }, [frame, length, playMode]);

  const goTo = useCallback((f: number) => {
    setPlaying(false);
    setFrame(Math.max(0, f));
  }, []);

  const newDrawing = useCallback(() => {
    const r = P.insertDrawingAfter(project, activeLayerId, frame);
    apply(() => r.project);
    setFrame(r.frame);
    setPlaying(false);
  }, [apply, activeLayerId, frame, project]);

  const duplicate = useCallback(() => {
    const r = P.duplicateCelAt(project, activeLayerId, frame);
    apply(() => r.project);
    setFrame(r.frame);
  }, [apply, activeLayerId, frame, project]);

  const onMoveCel = useCallback((layerId: string, from: number, to: number) => {
    const r = P.moveCel(project, layerId, from, to);
    apply(() => r.project);
    setActiveLayerId(layerId);
    setFrame(r.frame);
  }, [apply, project]);

  const onCommit = useCallback((edit: (p: P.Project) => P.Project) => apply(edit), [apply]);

  // A selection belongs to one drawing: drop it when the drawing, tool or history changes under it.
  const activeLayer = project.layers.find((l) => l.id === activeLayerId);
  const activeDrawing = activeLayer ? P.drawingAt(project, activeLayer, frame) : null;
  const activeDrawingId = activeDrawing?.id;
  const strokeCount = activeDrawing?.strokes.length ?? 0;
  useEffect(() => {
    setSelection(keepSelection.current);
    keepSelection.current = null;
    setPaintSel(null);
  }, [activeDrawingId, tool]);
  useEffect(() => { keepSelection.current = null; });
  useEffect(() => {
    setSelection((sel) => (sel && sel.every((i) => i < strokeCount) ? sel : null));
  }, [strokeCount]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    apply((p) => P.deleteStrokes(p, activeLayerId, frame, selection));
    setSelection(null);
  }, [apply, activeLayerId, frame, selection]);

  const duplicateSelection = useCallback(() => {
    if (!selection) return;
    // Copies land slightly offset so they're easy to see and drag.
    const r = P.duplicateStrokes(project, activeLayerId, frame, selection);
    apply(() => P.transformStrokes(r.project, activeLayerId, frame, r.indices, translate(16, 16)));
    setSelection(r.indices);
  }, [apply, activeLayerId, frame, project, selection]);

  /** Paint layers: move, copy or remove the selected area's pixels in one step. */
  const editPaintArea = useCallback((m: [number, number, number, number, number, number], opts: { keep?: boolean; remove?: boolean }) => {
    if (!paintSel || !activeLayer?.paint) return;
    try {
      const sheet = paintSheet(activeDrawing?.paint, project.width, project.height);
      const next = encodePaint(movePaintRegion(sheet, paintSel, m, opts), project.width, project.height);
      apply((p) => P.setPaint(p, activeLayerId, frame, next));
      setPaintSel(opts.remove ? null : paintSel.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));
    } catch (err) {
      notifyRef.current((err as Error).message);
    }
  }, [paintSel, activeLayer, activeDrawing, project.width, project.height, apply, activeLayerId, frame]);
  const paintAreaCentre = () => {
    const xs = (paintSel ?? []).map((p) => p[0]);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };

  const flipSelection = useCallback(() => {
    if (!selection || !activeDrawing) return;
    const box = unionBoxes(selection.map((i) => (activeDrawing.strokes[i] ? strokeBounds(activeDrawing.strokes[i]) : null)));
    if (!box) return;
    apply((p) => P.transformStrokes(p, activeLayerId, frame, selection, scaleAbout(-1, 1, (box.x0 + box.x1) / 2, 0)));
  }, [apply, activeLayerId, frame, selection, activeDrawing]);


  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), Math.max(1800, text.length * 45));
  }, []);
  notifyRef.current = notify;

  /** Copy the selected strokes, or the whole drawing when nothing is selected. */
  const copyStrokes = useCallback((layerId: string, f: number, indices: number[] | null) => {
    const layer = project.layers.find((l) => l.id === layerId);
    const d = layer ? P.drawingAt(project, layer, f) : null;
    if (d?.paint) { notify('Paint drawings can\'t be copied yet. Use Duplicate to repeat one.'); return false; }
    const strokes = d ? (indices ? indices.map((i) => d.strokes[i]).filter(Boolean) : d.strokes) : [];
    if (!strokes.length) { notify('Nothing to copy here'); return false; }
    setClipboard(strokes);
    notify(indices ? `Copied ${strokes.length} stroke${strokes.length > 1 ? 's' : ''}` : 'Copied drawing');
    return true;
  }, [project, notify]);

  /** Paste the clipboard on top of the drawing at a frame, then select it so it can be moved. */
  const pasteStrokes = useCallback((layerId: string, f: number) => {
    if (!clipboard) { notify('Copy a drawing or a selection first (Ctrl+C)'); return; }
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer) return;
    if (isLocked(project, layer) || !isShown(project, layer)) { notify(isLocked(project, layer) ? 'This layer is locked' : 'This layer is hidden'); return; }
    const r = P.pasteStrokes(project, layerId, f, clipboard);
    apply(() => r.project);
    setActiveLayerId(layerId);
    setFrame(f);
    keepSelection.current = r.indices;
    setSelection(r.indices);
    setTool('select');
    notify('Pasted. Drag to move it.');
  }, [apply, clipboard, project, notify]);

  const onFrameAction = useCallback((action: FrameAction, layerId: string, f: number) => {
    setPlaying(false);
    setActiveLayerId(layerId);
    if (action === 'copy') { copyStrokes(layerId, f, null); return; }
    if (action === 'paste') { pasteStrokes(layerId, f); return; }
    if (action === 'clear') { apply((p) => P.clearCelAt(p, layerId, f)); setFrame(f); return; }
    if (action === 'delete') {
      const layer = project.layers.find((l) => l.id === layerId);
      const i = layer ? P.celIndexAt(layer, f) : -1;
      apply((p) => P.deleteCelAt(p, layerId, f));
      // Stay on the start of the drawing that slid into this spot.
      setFrame(layer && i >= 0 ? P.celStart(layer, i) : f);
      return;
    }
    const r =
      action === 'duplicate' ? P.duplicateCelAt(project, layerId, f)
      : action === 'insert-left' ? P.insertDrawing(project, layerId, f, 'before')
      : P.insertDrawing(project, layerId, f, 'after'); // insert-right, new-here
    apply(() => r.project);
    setFrame(r.frame);
  }, [apply, project, copyStrokes, pasteStrokes]);

  const onion$ = useMemo(
    () => (onion.enabled && !playing && (onion.before || onion.after) ? {
      layerId: onion.allLayers ? null : activeLayerId, before: onion.before, after: onion.after,
      opacity: onion.opacity, beforeColor: onion.beforeColor, afterColor: onion.afterColor,
    } : null),
    [onion, playing, activeLayerId],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (exporting || shortcutsOpen || brushEditor || adjusting || timelapse) return;
      // Space still plays after clicking a button, slider or checkbox: let go of its focus
      // so the browser doesn't also press or toggle it.
      const textField = t.closest('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=color]):not([type=radio])');
      if (e.key === ' ' && !textField && t.closest('button, input')) t.blur();
      else if (t.closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); setHistory((h) => (e.shiftKey ? redo(h) : undo(h))); return; }
      if (mod && key === 'y') { e.preventDefault(); setHistory(redo); return; }
      if (mod && (key === 'c' || key === 'x')) {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        const sel = tool === 'select' ? selection : null;
        if (copyStrokes(activeLayerId, frame, sel) && key === 'x') {
          if (activeLayer?.locked) return;
          if (sel) deleteSelection();
          else apply((p) => P.clearCelAt(p, activeLayerId, frame));
        }
        return;
      }
      if (mod && key === 'v') { e.preventDefault(); pasteStrokes(activeLayerId, frame); return; }
      if (mod) return;
      if (key === 'tab' && !e.shiftKey) {
        e.preventDefault();
        setPanels((p) => {
          const anyShown = !p.hideTools || !p.hideLayers || !p.hideTimeline || !p.hideOptions;
          return { ...p, hideTools: anyShown, hideLayers: anyShown, hideTimeline: anyShown, hideOptions: anyShown };
        });
        return;
      }
      if (key === '?') { setShortcutsOpen(true); return; }
      const action = actionFor(keymap, keyOf(e));
      if (action === 'rulers.toggle') { setAids((a) => ({ ...a, rulers: !a.rulers })); return; }
      if (action === 'symmetry.next') {
        setAids((a) => {
          const next = SYMMETRY[(SYMMETRY.findIndex((m) => m.id === a.symmetry) + 1) % SYMMETRY.length];
          notify(`Symmetry: ${next.name.toLowerCase()}`);
          return { ...a, symmetry: next.id };
        });
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        if (!e.repeat) { spacePanned.current = false; spaceDown.current = true; setSpaceHeld(true); }
      }
      else if (key === 'arrowright' || action === 'frame.next') { e.preventDefault(); goTo(frame + 1); }
      else if (key === 'arrowleft' || action === 'frame.prev') { e.preventDefault(); goTo(frame - 1); }
      else if (key === 'home') goTo(0);
      else if (key === 'end') goTo(length - 1);
      else if (selection && (key === 'delete' || key === 'backspace')) { e.preventDefault(); deleteSelection(); }
      else if (paintSel && tool === 'select' && (key === 'delete' || key === 'backspace')) { e.preventDefault(); editPaintArea([1, 0, 0, 1, 0, 0], { remove: true }); }
      else if (paintSel && key === 'escape') setPaintSel(null);
      else if (tool === 'camera' && (key === 'delete' || key === 'backspace') && keyAt(project, frame)) { e.preventDefault(); apply((p) => removeCameraKey(p, frame)); }
      else if (selection && key === 'escape') setSelection(null);
      else if (action?.startsWith('tool.')) setTool(action.slice(5) as Tool);
      else if (action === 'frame.new') newDrawing();
      else if (action === 'frame.duplicate') duplicate();
      else if (action === 'onion.toggle') setOnion((o) => ({ ...o, enabled: !o.enabled }));
      else if (action === 'brush.smaller' || action === 'brush.bigger') {
        const sz = SIZED[tool];
        if (sz) setBrush((b) => ({ ...b, [sz.key]: stepSize(b[sz.key] ?? sz.min, sz, action === 'brush.bigger') }));
      }
    };
    // Space plays on release, unless it was held to pan the canvas.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || exporting) return;
      e.preventDefault();
      // Not inside a state updater: React may run those twice, which would play and pause at once.
      const held = spaceDown.current;
      spaceDown.current = false;
      setSpaceHeld(false);
      if (held && !spacePanned.current) togglePlay();
    };
    const onBlur = () => { spaceDown.current = false; setSpaceHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [exporting, frame, length, tool, togglePlay, goTo, newDrawing, duplicate, selection, deleteSelection, copyStrokes, pasteStrokes, activeLayerId, activeLayer, apply, project, notify, keymap, shortcutsOpen, brushEditor, adjusting, timelapse, paintSel, editPaintArea]);

  const newProject = () => {
    setMenuOpen(false);
    if (!window.confirm('Start a new animation? The current one will be replaced. Save it to a file first if you want to keep it.')) return;
    const p = P.createProject();
    linkFile(null, null);
    setHistory(initHistory(p));
    setActiveLayerId(p.layers.at(-1)!.id);
    setFrame(0);
  };

  const openFile = async (file: File) => {
    try {
      const p = await readProjectFile(file);
      linkFile(null, null);
      setHistory(initHistory(p));
      setActiveLayerId(p.layers.at(-1)!.id);
      setFrame(0);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open that file.');
    }
  };

  const psdInput = useRef<HTMLInputElement>(null);
  /** A Photoshop file becomes a new animation, each of its layers a paint layer. */
  const openPsd = async (file: File) => {
    if (!window.confirm('Open this PSD as a new animation? The current one will be replaced. Save it to a file first if you want to keep it.')) return;
    try {
      const { importPsd } = await import('./export/psd');
      const p = await importPsd(file);
      linkFile(null, null);
      setHistory(initHistory(p));
      setActiveLayerId(p.layers.at(-1)!.id);
      setFrame(0);
    } catch (err) {
      window.alert(err instanceof Error ? `Could not open that PSD: ${err.message}` : 'Could not open that PSD.');
    }
  };

  /** Open with the file picker where possible, so later changes auto-save back to that file. */
  const openProject = async () => {
    setMenuOpen(false);
    if (!canSaveToFile()) { fileInput.current?.click(); return; }
    try {
      const r = await pickOpenFile();
      if (!r) return;
      setHistory(initHistory(r.project));
      setActiveLayerId(r.project.layers.at(-1)!.id);
      setFrame(0);
      linkFile({ handle: r.handle, projectId: r.project.id }, r.project);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open that file.');
    }
  };

  /** Choose a file to save to; from then on every change auto-saves to it. */
  const saveAs = async () => {
    setMenuOpen(false);
    if (!canSaveToFile()) { saveProjectFile(project); return; }
    try {
      const file = await pickSaveFile(project);
      if (!file) return;
      await writeProjectFile(file, project);
      linkFile(file, project);
      notify(`Saved. Changes now save to ${file.handle.name} automatically.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save the file.');
    }
  };

  const resumeFileSave = async () => {
    if (!linked) return;
    if (await filePermission(linked, true).catch(() => false)) {
      lastWritten.current = null; // write the latest version straight away
      setFileStatus('saved');
    }
  };

  const addLineLayer = () => {
    const r = P.addLayer(project, `Layer ${project.layers.length + 1}`, activeLayerId);
    apply(() => r.project);
    setActiveLayerId(r.layerId);
  };
  const addPaintLayer = () => {
    const r = P.addLayer(project, `Paint ${project.layers.filter((l) => l.paint).length + 1}`, activeLayerId, { paint: true });
    apply(() => r.project);
    setActiveLayerId(r.layerId);
  };

  const fileLinked = linked && linked.projectId === project.id ? linked : null;

  const isEraser = tool === 'eraser';
  const size = isEraser ? brush.eraserSize : brush.size;
  const liquifySize = brush.liquifySize ?? 80;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><I.Logo /> <span className="brand-name">Animator</span></div>
        <input
          className="project-name" type="text" aria-label="Animation name" title="Name of this animation, used for exported files" value={project.name}
          onChange={(e) => apply((p) => ({ ...p, name: e.target.value }), false)}
          onBlur={(e) => apply((p) => ({ ...p, name: e.target.value.trim() || 'Untitled animation' }))}
        />
        {fileLinked && (() => {
          const name = fileLinked.handle.name;
          const icon = fileStatus === 'saving' ? <I.Spinner /> : fileStatus === 'error' ? <I.Warning /> : fileStatus === 'paused' ? <I.PauseSmall /> : <I.Check />;
          const state = fileStatus === 'saving' ? 'Saving…' : fileStatus === 'error' ? "Couldn't save" : fileStatus === 'paused' ? 'Auto-save paused' : 'Saved';
          const body = (
            <>
              <span className="save-icon" role="img" aria-label={state}>{icon}</span>
              <span className="file-name">{name}</span>
            </>
          );
          return fileStatus === 'paused' ? (
            <button className="file-status paused" title={`Auto-save to ${name} is paused. Click to allow it again. Your work is still saved in this browser.`} onClick={resumeFileSave}>{body}</button>
          ) : (
            <span className={`file-status ${fileStatus}`} role="status" title={`${state}. Every change saves to ${name} automatically.`}>{body}</span>
          );
        })()}
        <div className="spacer" />
        <div className="transport">
          <button className="icon-btn" aria-label="First frame" title="First frame (Home)" onClick={() => goTo(0)}><I.First /></button>
          <button className="icon-btn" aria-label="Previous frame" title="Previous frame (←)" onClick={() => goTo(frame - 1)}><I.Prev /></button>
          <button className="icon-btn play" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (tap Space). Hold Space and drag to move around the canvas." onClick={togglePlay}>{playing ? <I.Pause /> : <I.Play />}</button>
          <button className="icon-btn" aria-label="Next frame" title="Next frame (→)" onClick={() => goTo(frame + 1)}><I.Next /></button>
          <button className="icon-btn" aria-label="Last frame" title="Last frame (End)" onClick={() => goTo(length - 1)}><I.Last /></button>
          <span className="frame-count">Frame <strong>{frame + 1}</strong> <span className="muted">/ {length}</span></span>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Playback speed in frames per second. 12 fps is common for hand-drawn animation.">Speed
            <select value={project.fps} onChange={(e) => apply((p) => ({ ...p, fps: Number(e.target.value) }))}>
              {[6, 8, 12, 15, 24].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </label>
          <select className="play-mode" style={{ marginLeft: 6 }} aria-label="Playback" title={PLAY_MODES.find((m) => m.id === playMode)?.help} value={playMode} onChange={(e) => setPlayMode(e.target.value as PlayMode)}>
            {PLAY_MODES.map((m) => <option key={m.id} value={m.id} title={m.help}>{m.name}</option>)}
          </select>
        </div>
        <div className="spacer" />
        <button className={`btn${onion.enabled ? ' on' : ''}`} aria-pressed={onion.enabled} title="Show the previous and next drawings faintly while you draw (O). Set how many, their colours and strength in the Layers panel." onClick={() => setOnion((o) => ({ ...o, enabled: !o.enabled }))}>
          <span className="onion-dots"><i style={{ background: onion.beforeColor }} /><i style={{ background: onion.afterColor }} /></span>
          Onion skin
        </button>
        <div className="menu">
          <button className="icon-btn" aria-label="File menu" title="New, open and save animations" aria-expanded={menuOpen} onClick={() => setMenuOpen((m) => !m)}><I.More /></button>
          {menuOpen && (
            <div className="menu-list" onMouseLeave={() => { if (document.activeElement?.tagName !== 'SELECT') setMenuOpen(false); }}>
              <button onClick={newProject} title="Start a blank animation, replacing the current one">New animation</button>
              <button onClick={() => { setMenuOpen(false); audioInput.current?.click(); }} title="Add a sound (MP3, WAV…) to time the animation to, for example dialogue for lip-sync. It's saved inside the animation.">{project.audio ? 'Replace sound…' : 'Add sound…'}</button>
              <button onClick={() => { setMenuOpen(false); imageInput.current?.click(); }} title="Add a picture to trace over, as a see-through layer. It shows on every frame and is never exported.">Add reference image…</button>
              <button onClick={() => { setMenuOpen(false); setPlaying(false); setTimelapse(true); }} title="Replay how this animation was drawn, and save it as a video">Timelapse…</button>
              <button onClick={() => { setMenuOpen(false); setRefWindow((v) => !v); }} title="A small window that floats over the canvas: the whole frame as it will look, or a picture to look at while you draw">{refWindow ? 'Hide reference window' : 'Reference window'}</button>
              <button onClick={() => { setMenuOpen(false); setPlaying(false); setAdjusting(true); }} title="Hue, saturation and brightness, or Recolour one colour, for the current drawing or the whole layer">Adjust colours…</button>
              <button onClick={() => { setMenuOpen(false); setShortcutsOpen(true); }} title="See and change the keyboard shortcuts (?)">Keyboard shortcuts…</button>
              <label className="menu-row" title="For iPad and touch screens. With a pencil, a finger moves and zooms the canvas so a resting hand doesn't draw. Two-finger tap undoes, three-finger tap redoes.">
                Fingers
                <select value={fingers} onChange={(e) => setFingers(e.target.value as Fingers)}>
                  <option value="auto">{penSeen ? 'Auto (move the canvas)' : 'Auto (draw until a pencil is used)'}</option>
                  <option value="draw">Draw</option>
                  <option value="navigate">Move the canvas</option>
                </select>
              </label>
              <button onClick={() => { setMenuOpen(false); psdInput.current?.click(); }} title="Open a Photoshop file (PSD, also from Procreate) as a new animation: each of its layers becomes a paint layer">Open PSD…</button>
              <button onClick={openProject} title={canSaveToFile() ? 'Open an animation file. Changes then save back to it automatically.' : 'Open an animation saved with Save to file'}>Open from file…</button>
              {canSaveToFile() ? (
                <>
                  <button onClick={saveAs} title="Choose where to save this animation. After that, every change saves to that file automatically.">{fileLinked ? 'Save as…' : 'Save to file…'}</button>
                  {fileLinked && <button onClick={() => { setMenuOpen(false); linkFile(null, null); }} title="Keep the file as it is now and stop saving changes to it">Stop auto-saving to {fileLinked.handle.name}</button>}
                </>
              ) : (
                <button onClick={saveAs} title="Download this animation as a file you can back up or open later. It also saves automatically in this browser. (Auto-saving to a file needs Chrome or Edge.)">Save to file</button>
              )}
            </div>
          )}
          <input
            ref={audioInput} type="file" accept="audio/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addAudio(f); e.target.value = ''; }}
          />
          <input
            ref={imageInput} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addReference(f); e.target.value = ''; }}
          />
          <input
            ref={psdInput} type="file" accept=".psd,image/vnd.adobe.photoshop" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openPsd(f); e.target.value = ''; }}
          />
          <input
            ref={fileInput} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }}
          />
        </div>
        <button className="btn primary" title="Export the animation as a GIF" onClick={() => { setPlaying(false); setExporting(true); }}>Export</button>
      </header>

      {!panels.hideTools && <nav className="tool-bar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} aria-label={t.name} aria-pressed={tool === t.id}
            title={`${t.name}${keyHint(`tool.${t.id}` as ActionId)}: ${t.help}`} onClick={() => setTool(t.id)}
          >
            <t.Icon />
          </button>
        ))}
        <div className="rail-sep" />
        <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={() => setHistory(undo)}><I.Undo /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => setHistory(redo)}><I.Redo /></button>
      </nav>}
      <Splitter side="top" label="the tools" collapsed={panels.hideTools} onToggle={() => togglePanel('hideTools')} />

      <div className="workspace">
      {!panels.hideOptions && <div className="tool-options" role="region" aria-label="Tool settings" style={{ width: panels.options }}>
        <span className="tool-name">{TOOLS.find((t) => t.id === tool)?.name}{tool === 'brush' && <span className="muted" title={preset ? undefined : "You've changed the settings of a preset"}> · {preset?.name ?? 'Custom'}</span>}</span>
        {tool === 'brush' && (
          <div className="presets" role="group" aria-label="Brush presets">
            {[...PRESETS, ...savedBrushes].map((p) => (
              <button key={p.id} className={`brush-btn${preset?.id === p.id ? ' on' : ''}`} aria-label={p.name} aria-pressed={preset?.id === p.id} title={`${p.name}: ${p.help}`} onClick={() => usePreset(p)}><BrushSample brush={p} /></button>
            ))}
            <button className="brush-btn" aria-label="Edit brush" title="Brush editor: every setting, paper grain, and saving your own brushes" onClick={() => setBrushEditor(true)}><I.Sliders /></button>
          </div>
        )}
        {(tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse') && !(brush.fillShapes && (tool === 'rect' || tool === 'ellipse')) && (
          <label title={isEraser ? 'Width of the eraser in pixels ([ and ], or Ctrl + mouse wheel, to change)' : 'Width of the line in pixels ([ and ], or Ctrl + mouse wheel, to change)'}>Size
            <input
              type="range" min={1} max={isEraser ? 120 : 60} value={size}
              onChange={(e) => setBrush((b) => (isEraser ? { ...b, eraserSize: Number(e.target.value) } : { ...b, size: Number(e.target.value) }))}
            />
            <span className="value">{size} px</span>
          </label>
        )}
        {(tool === 'smudge' || tool === 'blur') && (
          <>
            <label title="Width of the brush ([ and ] to change)">Size
              <input type="range" min={4} max={300} value={brush.fxSize ?? 40} onChange={(e) => setBrush((b) => ({ ...b, fxSize: Number(e.target.value) }))} />
              <span className="value">{brush.fxSize ?? 40} px</span>
            </label>
            <label title={tool === 'smudge' ? 'How far each stroke drags the colour' : 'How much each pass softens the paint'}>Strength
              <input type="range" min={5} max={100} value={Math.round((brush.fxStrength ?? 0.6) * 100)} onChange={(e) => setBrush((b) => ({ ...b, fxStrength: Number(e.target.value) / 100 }))} />
              <span className="value">{pct(brush.fxStrength ?? 0.6)}</span>
            </label>
            {!activeLayer?.paint && <span className="hint">Works on paint layers</span>}
          </>
        )}
        {tool === 'liquify' && (
          <>
            <label title="How wide an area moves with the pointer ([ and ] to change)">Size
              <input type="range" min={10} max={400} value={liquifySize} onChange={(e) => setBrush((b) => ({ ...b, liquifySize: Number(e.target.value) }))} />
              <span className="value">{liquifySize} px</span>
            </label>
            <span className="hint">{activeLayer?.paint ? 'Drag to push the paint around' : 'Drag to push lines around: bend a pose, squash and stretch'}</span>
          </>
        )}
        {tool === 'brush' && (
          <>
            <label title="Evens out shaky lines. Higher values give smoother curves but follow the pen less closely.">Smoothing
              <input type="range" min={0} max={100} value={Math.round(brush.smoothing * 100)} onChange={(e) => setBrush((b) => ({ ...b, smoothing: Number(e.target.value) / 100 }))} />
              <span className="value">{Math.round(brush.smoothing * 100)}%</span>
            </label>
            <label title="Steadies the line: it trails behind the pointer and ignores small wobbles. Higher values are steadier but lag more.">Stabilizer
              <input type="range" min={0} max={100} value={Math.round(brush.stabilizer * 100)} onChange={(e) => setBrush((b) => ({ ...b, stabilizer: Number(e.target.value) / 100 }))} />
              <span className="value">{pct(brush.stabilizer)}</span>
            </label>
            <label title="Blurs the edge of the line. 0% is crisp.">Soft edge
              <input type="range" min={0} max={100} value={Math.round(brush.softness * 100)} onChange={(e) => setBrush((b) => ({ ...b, softness: Number(e.target.value) / 100 }))} />
              <span className="value">{pct(brush.softness)}</span>
            </label>
            <label title="Lines get thicker when you press harder with a pen or tablet. With a mouse it imitates pressure from drawing speed. Untick for an even line width."><input type="checkbox" checked={brush.pressure} onChange={(e) => setBrush((b) => ({ ...b, pressure: e.target.checked, thinning: e.target.checked && !b.thinning ? 0.6 : b.thinning }))} /> Pressure</label>
          </>
        )}
        {(tool === 'brush' || tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'fill' || tool === 'text') && (
          <label title="How solid the colour is. Lower values let lines and colours underneath show through.">Opacity
            <input type="range" min={5} max={100} value={Math.round(brush.opacity * 100)} onChange={(e) => setBrush((b) => ({ ...b, opacity: Number(e.target.value) / 100 }))} />
            <span className="value">{pct(brush.opacity)}</span>
          </label>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label title="Fill the shape with colour instead of drawing its outline"><input type="checkbox" checked={brush.fillShapes} onChange={(e) => setBrush((b) => ({ ...b, fillShapes: e.target.checked }))} /> Filled</label>
        )}
        {(tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse') && (
          <label title="Mirror what you draw across the middle of the canvas (Y to switch)">Symmetry
            <select value={aids.symmetry} onChange={(e) => setAids((a) => ({ ...a, symmetry: e.target.value as Symmetry }))}>
              {SYMMETRY.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        {(tool === 'line' || tool === 'brush') && (
          <label title="Perspective guide: lines drawn with the line tool run towards the vanishing points (or straight up, or level). Drag the white dots to move the points.">Perspective
            <select
              value={project.perspective?.on ? String(project.perspective.points.length) : 'off'}
              onChange={(e) => {
                const v = e.target.value;
                apply((p) => {
                  if (v === 'off') return p.perspective ? { ...p, perspective: { ...p.perspective, on: false } } : p;
                  const n = v === '1' ? 1 : 2;
                  return { ...p, perspective: p.perspective?.points.length === n ? { ...p.perspective, on: true } : defaultPerspective(n, p.width, p.height) };
                });
              }}
            >
              <option value="off">Off</option>
              <option value="1">1-point</option>
              <option value="2">2-point</option>
            </select>
          </label>
        )}
        {(tool === 'line' || tool === 'rect' || tool === 'ellipse') && <span className="hint">Hold Shift for {tool === 'line' ? '45° angles' : tool === 'rect' ? 'a square' : 'a circle'}</span>}
        {tool === 'fill' && (
          <>
            <label title="A flat colour, or a gradient: drag inside the area to set its direction (linear) or its size (radial)">Fill
              <select value={brush.fillMode} onChange={(e) => setBrush((b) => ({ ...b, fillMode: e.target.value as BrushSettings['fillMode'] }))}>
                <option value="solid">Solid</option>
                <option value="linear">Linear gradient</option>
                <option value="radial">Radial gradient</option>
              </select>
            </label>
            {brush.fillMode !== 'solid' && (
              <>
                <label title="Fade the gradient out to see-through, instead of ending in a second colour"><input type="checkbox" checked={brush.fadeOut} onChange={(e) => setBrush((b) => ({ ...b, fadeOut: e.target.checked }))} /> Fade out</label>
                {!brush.fadeOut && (
                  <label title="The colour the gradient ends in">To
                    <input className="color-input" type="color" aria-label="Gradient end colour" value={brush.color2} onChange={(e) => setBrush((b) => ({ ...b, color2: e.target.value }))} />
                  </label>
                )}
              </>
            )}
            <span className="hint">{brush.fillMode === 'solid' ? 'Click inside a closed area of the selected layer. The fill goes under your lines.' : 'Drag inside a closed area from where the colour starts to where it ends. A click fills top to bottom.'}</span>
          </>
        )}
        {tool === 'text' && (
          <>
            <label title="Typeface">Font
              <select value={brush.font} onChange={(e) => setBrush((b) => ({ ...b, font: e.target.value as BrushSettings['font'] }))}>
                {Object.entries(FONTS).map(([id, f]) => <option key={id} value={id} style={{ fontFamily: f.css }}>{f.name}</option>)}
              </select>
            </label>
            <label title="Size of the letters in pixels ([ and ] to change)">Size
              <input type="range" min={8} max={240} value={brush.textSize} onChange={(e) => setBrush((b) => ({ ...b, textSize: Number(e.target.value) }))} />
              <span className="value">{brush.textSize} px</span>
            </label>
            <label title="Bold letters"><input type="checkbox" checked={brush.bold} onChange={(e) => setBrush((b) => ({ ...b, bold: e.target.checked }))} /> Bold</label>
            <span className="hint">Click the canvas and type. Enter finishes, Shift+Enter adds a line. Move or resize text with the Lasso.</span>
          </>
        )}
        {tool === 'eyedropper' && <span className="hint">Click the canvas to pick its colour. Alt+click does the same with any drawing tool.</span>}
        {tool === 'select' && activeLayer?.reference && <span className="hint">Reference image: drag it to move it, drag a corner to resize it (Shift lets the proportions change)</span>}
        {tool === 'select' && !selection && !activeLayer?.reference && !activeLayer?.paint && <span className="hint">Draw a loop around strokes, or click one, to select them</span>}
        {tool === 'select' && activeLayer?.paint && !paintSel && <span className="hint">Draw a loop around the paint you want to move</span>}
        {tool === 'select' && activeLayer?.paint && paintSel && (
          <>
            <span className="hint">Area selected · drag to move · drag a corner to resize (Shift keeps proportions)</span>
            <button className={`btn small${warp ? ' on' : ''}`} aria-pressed={warp} title="Warp: bend the selection by dragging the handles of a grid over it" onClick={() => setWarp((w) => !w)}>Warp</button>
            <button className="btn small" title="Mirror the selected paint left to right" onClick={() => { const cx = paintAreaCentre(); editPaintArea([-1, 0, 0, 1, 2 * cx, 0], {}); }}>Flip</button>
            <button className="btn small" title="Copy the selected paint, slightly offset" onClick={() => editPaintArea([1, 0, 0, 1, 16, 16], { keep: true })}>Duplicate</button>
            <button className="btn small" title="Erase the selected paint (Delete)" onClick={() => editPaintArea([1, 0, 0, 1, 0, 0], { remove: true })}>Delete</button>
            <button className="btn small" title="Clear the selection (Esc)" onClick={() => setPaintSel(null)}>Deselect</button>
          </>
        )}
        {tool === 'select' && selection && (
          <>
            <span className="hint">{selection.length} selected · drag to move · drag a corner to resize (Shift keeps proportions)</span>
            <button className={`btn small${warp ? ' on' : ''}`} aria-pressed={warp} title="Warp: bend the selection by dragging the handles of a grid over it" onClick={() => setWarp((w) => !w)}>Warp</button>
            <button className="btn small" title="Mirror the selection left to right" onClick={flipSelection}>Flip</button>
            <button className="btn small" title="Copy the selection, slightly offset" onClick={duplicateSelection}>Duplicate</button>
            <button className="btn small" title="Copy the selection to paste it into another frame or layer (Ctrl+C, then Ctrl+V)" onClick={() => copyStrokes(activeLayerId, frame, selection)}>Copy</button>
            <button className="btn small" title="Delete the selected strokes (Delete)" onClick={deleteSelection}>Delete</button>
            <button className="btn small" title="Clear the selection (Esc)" onClick={() => setSelection(null)}>Deselect</button>
          </>
        )}
        {tool === 'camera' && (() => {
          const view = cameraAt(project, frame);
          const key = keyAt(project, frame);
          const setView = (patch: Partial<typeof view>, record = true) => apply((p) => setCameraKey(p, frame, { ...cameraAt(p, frame), ...patch }), record);
          return (
            <>
              <label title="How close the camera is. 100% shows the whole canvas.">Zoom
                <input type="range" min={-100} max={200} value={Math.round(Math.log2(view.zoom) * 100)}
                  onChange={(e) => setView({ zoom: Math.pow(2, Number(e.target.value) / 100) }, false)}
                  onPointerUp={(e) => setView({ zoom: Math.pow(2, Number((e.target as HTMLInputElement).value) / 100) })} />
                <span className="value">{Math.round(view.zoom * 100)}%</span>
              </label>
              <label title="Tilt the camera">Rotation
                <input type="range" min={-180} max={180} value={Math.round(view.rotation)}
                  onChange={(e) => setView({ rotation: Number(e.target.value) }, false)}
                  onPointerUp={(e) => setView({ rotation: Number((e.target as HTMLInputElement).value) })} />
                <span className="value">{Math.round(view.rotation)}°</span>
              </label>
              {key ? (
                <button className="btn small" title="Remove the camera key on this frame (Delete)" onClick={() => apply((p) => removeCameraKey(p, frame))}>Delete key</button>
              ) : (
                <button className="btn small" title="Keep the camera where it is at this frame, as a key" onClick={() => apply((p) => setCameraKey(p, frame, cameraAt(p, frame)))}>Add key</button>
              )}
              {hasCamera(project) && (
                <button className="btn small" title="Remove every camera key so the whole canvas shows again" onClick={() => apply((p) => ({ ...p, camera: undefined }))}>Reset camera</button>
              )}
              <span className="hint">Drag the blue frame to move it, a corner to zoom. Changes add a key on this frame. To remove a key: Delete here, or right-click its diamond in the timeline.</span>
            </>
          );
        })()}
        {COLOUR_TOOLS.includes(tool) && (
          <div className="swatches" role="group" aria-label="Colour">
            Colour
            {palette.map((c) => (
              <button
                key={c} className={`swatch${brush.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`}
                title={`${c}. Right-click or press and hold to remove it from the palette.`}
                {...holdSwatch.bind(() => setPalette((p) => (p.length > 1 ? p.filter((x) => x !== c) : p)))}
                onClick={() => setBrush((b) => ({ ...b, color: c }))}
                onContextMenu={(e) => { e.preventDefault(); if (!holdSwatch.justFired()) setPalette((p) => (p.length > 1 ? p.filter((x) => x !== c) : p)); }}
              />
            ))}
            <button
              className="color-input colour-toggle" aria-label="Colour disc" aria-expanded={!!picker} title="Colour disc: pick any colour, see harmonies and recent colours"
              style={{ background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)` }}
              onClick={(e) => { if (picker) { setPicker(null); return; } const r = e.currentTarget.getBoundingClientRect(); setPicker({ x: r.right + 10, y: r.top - 120 }); }}
            />
            <button
              className="icon-btn sm" aria-label="Add colour to palette" disabled={palette.includes(brush.color.toLowerCase()) || palette.length >= MAX_PALETTE}
              title={palette.includes(brush.color.toLowerCase()) ? 'This colour is already in the palette' : 'Save the current colour in the palette. The palette is kept in this browser for all your animations.'}
              onClick={() => setPalette((p) => [...p, brush.color.toLowerCase()])}
            ><I.Plus /></button>
            {palette.join() !== DEFAULT_PALETTE.join() && (
              <button className="link-btn" title="Go back to the starting colours" onClick={() => { if (window.confirm('Reset the palette to the starting colours?')) setPalette(DEFAULT_PALETTE); }}>Reset</button>
            )}
          </div>
        )}
      </div>}
      <Splitter side="left" label="the tool settings" collapsed={panels.hideOptions} onResize={resizePanel('options')} onToggle={() => togglePanel('hideOptions')} />


        <Stage
          project={adjustPreview ?? project} frame={frame} activeLayerId={activeLayerId} tool={tool} brush={brush} onion={onion$}
          selection={selection} onSelectionChange={setSelection} paintSelection={paintSel} onPaintSelectionChange={setPaintSel} warp={warp} maskEdit={maskEdit} onCommit={onCommit}
          panKey={spaceHeld} onPanned={() => { spacePanned.current = true; }} playing={playing}
          keymap={keymap} symmetry={aids.symmetry} rulers={aids.rulers} onRulersChange={(rulers) => setAids((a) => ({ ...a, rulers }))}
          touchDraws={touchDraws} onUndo={() => setHistory(undo)} onRedo={() => setHistory(redo)}
          onBrushSize={(bigger) => {
            const sz = SIZED[tool];
            if (!sz) return false;
            setBrush((b) => ({ ...b, [sz.key]: stepSize(b[sz.key] ?? sz.min, sz, bigger) }));
            return true;
          }}
          onPickColor={(color) => {
            setBrush((b) => ({ ...b, color }));
            if (tool === 'eyedropper') setTool('brush');
          }}
        />

        <Splitter side="right" label="the layers panel" collapsed={panels.hideLayers} onResize={resizePanel('layers')} onToggle={() => togglePanel('hideLayers')} />
        {!panels.hideLayers && <div className="layers-wrap" style={{ width: panels.layers }}><LayersPanel
          project={project}
          frame={frame}
          activeLayerId={activeLayerId}
          onion={onion}
          maskEdit={maskEdit} onMaskEdit={(on) => { setMaskEdit(on); if (on && tool !== 'eraser') setTool('brush'); }}
          onSelect={setActiveLayerId}
          onAdd={addLineLayer}
          onAddPaint={addPaintLayer}
          onRemove={(id) => apply((p) => P.removeLayer(p, id))}
          onMove={(id, delta) => apply((p) => P.moveLayer(p, id, delta))}
          onDrop={(id, kind, drop) => apply((p) => (kind === 'group' ? moveGroupToGap(p, id, drop.gap) : P.moveLayerToGap(p, id, drop.gap, drop.group)))}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onUpdateGroup={(id, patch, record = true) => apply((p) => updateGroup(p, id, patch), record)}
          onGroup={(layerId) => {
            const r = groupLayer(project, layerId);
            apply(() => r.project);
            setSelectedGroupId(r.groupId);
          }}
          onUngroup={(id) => { apply((p) => ungroup(p, id)); setSelectedGroupId(null); }}
          onRemoveGroup={(id) => { apply((p) => removeGroup(p, id)); setSelectedGroupId(null); }}
          onUpdate={(id, patch, record = true) => apply((p) => P.updateLayer(p, id, patch), record)}
          onOnionChange={setOnion}
          onAddReference={() => imageInput.current?.click()}
          playing={playing}
        /></div>}
      </div>

      <Splitter side="bottom" label="the timeline" collapsed={panels.hideTimeline} onResize={resizePanel('timeline')} onToggle={() => togglePanel('hideTimeline')} />
      {!panels.hideTimeline && <div className="timeline-wrap" style={{ height: panels.timeline }}><Timeline
        project={project}
        frame={frame}
        activeLayerId={activeLayerId}
        playing={playing}
        onSelect={(layerId, f) => { setActiveLayerId(layerId); setSelectedGroupId(null); goTo(f); }}
        onSelectFrame={goTo}
        onHold={(h) => apply((p) => P.setHoldAt(p, activeLayerId, frame, h))}
        onHoldToEnd={() => apply((p) => P.holdToEnd(p, activeLayerId, frame))}
        onNewDrawing={newDrawing}
        onDuplicate={duplicate}
        onDelete={() => apply((p) => P.deleteCelAt(p, activeLayerId, frame))}
        onFrameAction={onFrameAction}
        canPaste={!!clipboard}
        showCamera={tool === 'camera' || hasCamera(project)}
        scrub={scrub}
        onScrubChange={setScrub}
        onAudioChange={(patch, record = true) => apply((p) => (p.audio ? { ...p, audio: { ...p.audio, ...patch } } : p), record)}
        onRemoveAudio={() => apply((p) => ({ ...p, audio: null }))}
        onAddAudio={() => audioInput.current?.click()}
        onRemoveCameraKey={(f) => apply((p) => removeCameraKey(p, f))}
        onMoveCel={onMoveCel}
        onUpdateLayer={(id, patch) => apply((p) => P.updateLayer(p, id, patch))}
        onMoveLayerTo={(id, gap, group) => apply((p) => P.moveLayerToGap(p, id, gap, group))}
        onAddLayer={addLineLayer}
        onAddPaintLayer={addPaintLayer}
      /></div>}

      {toast && <div className="toast" role="status">{toast}</div>}
      {shortcutsOpen && <ShortcutsDialog keymap={keymap} onChange={setKeymap} onClose={() => setShortcutsOpen(false)} />}
      {picker && (
        <div className="colour-popover" style={{ left: Math.max(8, Math.min(picker.x, window.innerWidth - 248)), top: Math.max(8, Math.min(picker.y, window.innerHeight - 470)) }}>
          <ColourPicker
            color={brush.color} onChange={(c) => setBrush((b) => ({ ...b, color: c }))} recent={recentColours}
            harmonyKind={harmonyKind} onHarmonyChange={setHarmonyKind} onClose={() => setPicker(null)}
          />
        </div>
      )}
      {timelapse && <TimelapseDialog project={project} onClose={() => setTimelapse(false)} />}
      {refWindow && <ReferenceWindow project={project} frame={frame} onClose={() => setRefWindow(false)} />}
      {adjusting && (
        <AdjustDialog
          project={project} layerId={activeLayerId} frame={frame} selection={selection} color={brush.color}
          onPreview={setAdjustPreview} onApply={(p) => onCommit(() => p)} onClose={() => { setAdjusting(false); setAdjustPreview(null); }}
        />
      )}
      {brushEditor && (
        <BrushEditor
          brush={brush} saved={savedBrushes} onSave={setSavedBrushes}
          onChange={(patch) => setBrush((b) => ({ ...b, ...patch }))} onClose={() => setBrushEditor(false)}
        />
      )}
      {exporting && <ExportDialog project={project} frame={frame} pingPong={playMode === 'pingpong'} onClose={() => setExporting(false)} />}
    </div>
  );
}
