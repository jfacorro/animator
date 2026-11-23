import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportDialog } from './components/ExportDialog';
import * as I from './components/Icons';
import { LayersPanel, type OnionState } from './components/LayersPanel';
import { Stage, type BrushSettings, type Tool } from './components/Stage';
import { Timeline, type FrameAction } from './components/Timeline';
import { commit, initHistory, redo, undo, type History } from './model/history';
import { scaleAbout, strokeBounds, translate, unionBoxes } from './model/geometry';
import * as P from './model/project';
import { matchingPreset, PRESETS, type BrushPreset } from './model/brushes';
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
  { id: 'eyedropper', name: 'Eyedropper', key: 'i', help: 'pick a colour from the canvas', Icon: I.Dropper },
  { id: 'select', name: 'Lasso select', key: 's', help: 'select strokes to move, resize, flip or delete', Icon: I.Lasso },
];
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));
const COLOUR_TOOLS: Tool[] = ['brush', 'line', 'rect', 'ellipse', 'fill', 'eyedropper'];

const DEFAULT_PALETTE = ['#1a1a1a', '#6b6f78', '#e5534b', '#f08a3a', '#f2c94c', '#6faf6a', '#5b8fd9', '#9b6fd6', '#ffffff'];
const PALETTE_KEY = 'animator:palette';
const BRUSH_KEY = 'animator:brush';
const MAX_PALETTE = 24;

const INK = PRESETS.find((p) => p.id === 'ink')!;
const DEFAULT_BRUSH: BrushSettings = {
  color: '#1a1a1a', eraserSize: 24, pressure: true, fillShapes: false,
  size: INK.size, opacity: INK.opacity, smoothing: INK.smoothing, stabilizer: INK.stabilizer, thinning: INK.thinning, softness: INK.softness,
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
  const preset = matchingPreset(brush);
  const usePreset = (p: BrushPreset) => setBrush((b) => ({
    ...b, size: p.size, opacity: p.opacity, smoothing: p.smoothing, stabilizer: p.stabilizer, thinning: p.thinning, softness: p.softness, pressure: p.thinning > 0,
  }));
  const [selection, setSelection] = useState<number[] | null>(null);
  const [onion, setOnion] = useState<OnionState>({ enabled: true, before: 1, after: 1 });
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
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
  const spacePanned = useRef(false);
  /** Selection to keep after a paste, instead of clearing it when the drawing or tool changes. */
  const keepSelection = useRef<number[] | null>(null);

  const length = P.sceneLength(project);

  /** Change the project. `record: false` previews a change (e.g. while dragging a slider) without an undo step. */
  const apply = useCallback((fn: (p: P.Project) => P.Project, record = true) => {
    setHistory((h) => {
      const next = fn(h.present);
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
          if (f + 1 < length) return f + 1;
          if (loop) return 0;
          setPlaying(false);
          return f;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project.fps, length, loop]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && frame >= length - 1) setFrame(0);
      return !p;
    });
  }, [frame, length]);

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

  const flipSelection = useCallback(() => {
    if (!selection || !activeDrawing) return;
    const box = unionBoxes(selection.map((i) => (activeDrawing.strokes[i] ? strokeBounds(activeDrawing.strokes[i]) : null)));
    if (!box) return;
    apply((p) => P.transformStrokes(p, activeLayerId, frame, selection, scaleAbout(-1, 1, (box.x0 + box.x1) / 2, 0)));
  }, [apply, activeLayerId, frame, selection, activeDrawing]);


  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  /** Copy the selected strokes, or the whole drawing when nothing is selected. */
  const copyStrokes = useCallback((layerId: string, f: number, indices: number[] | null) => {
    const layer = project.layers.find((l) => l.id === layerId);
    const d = layer ? P.drawingAt(project, layer, f) : null;
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
    if (layer.locked || !layer.visible) { notify(layer.locked ? 'This layer is locked' : 'This layer is hidden'); return; }
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
    () => (onion.enabled && !playing && (onion.before || onion.after) ? { layerId: activeLayerId, before: onion.before, after: onion.after } : null),
    [onion, playing, activeLayerId],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (exporting || t.closest('input, select, textarea')) return;
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
      if (key === ' ') {
        e.preventDefault();
        if (!e.repeat) { spacePanned.current = false; setSpaceHeld(true); }
      }
      else if (key === 'arrowright' || key === '.') { e.preventDefault(); goTo(frame + 1); }
      else if (key === 'arrowleft' || key === ',') { e.preventDefault(); goTo(frame - 1); }
      else if (key === 'home') goTo(0);
      else if (key === 'end') goTo(length - 1);
      else if (selection && (key === 'delete' || key === 'backspace')) { e.preventDefault(); deleteSelection(); }
      else if (selection && key === 'escape') setSelection(null);
      else if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
      else if (key === 'n') newDrawing();
      else if (key === 'd') duplicate();
      else if (key === 'o') setOnion((o) => ({ ...o, enabled: !o.enabled }));
      else if (key === '[') setBrush((b) => (tool === 'eraser' ? { ...b, eraserSize: Math.max(2, b.eraserSize - 2) } : { ...b, size: Math.max(1, b.size - 1) }));
      else if (key === ']') setBrush((b) => (tool === 'eraser' ? { ...b, eraserSize: Math.min(120, b.eraserSize + 2) } : { ...b, size: Math.min(60, b.size + 1) }));
    };
    // Space plays on release, unless it was held to pan the canvas.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || exporting) return;
      e.preventDefault();
      setSpaceHeld((held) => {
        if (held && !spacePanned.current) togglePlay();
        return false;
      });
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [exporting, frame, length, tool, togglePlay, goTo, newDrawing, duplicate, selection, deleteSelection, copyStrokes, pasteStrokes, activeLayerId, activeLayer, apply]);

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

  const fileLinked = linked && linked.projectId === project.id ? linked : null;

  const isEraser = tool === 'eraser';
  const size = isEraser ? brush.eraserSize : brush.size;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><I.Logo /> Animator</div>
        <input
          className="project-name" type="text" aria-label="Animation name" title="Name of this animation, used for exported files" value={project.name}
          onChange={(e) => apply((p) => ({ ...p, name: e.target.value }), false)}
          onBlur={(e) => apply((p) => ({ ...p, name: e.target.value.trim() || 'Untitled animation' }))}
        />
        {fileLinked && (
          fileStatus === 'paused' ? (
            <button className="file-status paused" title={`Auto-save to ${fileLinked.handle.name} is paused until you allow it again. Your work is still saved in this browser.`} onClick={resumeFileSave}>Resume saving to file</button>
          ) : (
            <span className={`file-status ${fileStatus}`} title={`Every change saves to ${fileLinked.handle.name} automatically`}>
              {fileStatus === 'saving' ? 'Saving…' : fileStatus === 'error' ? `Couldn't save to ${fileLinked.handle.name}` : `Saved to ${fileLinked.handle.name}`}
            </span>
          )
        )}
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
          <button className={`btn small${loop ? ' on' : ''}`} style={{ marginLeft: 6 }} aria-pressed={loop} title="Start again from the first frame when playback reaches the end" onClick={() => setLoop((l) => !l)}>Loop</button>
        </div>
        <div className="spacer" />
        <button className={`btn${onion.enabled ? ' on' : ''}`} aria-pressed={onion.enabled} title="Show the previous drawings in red and the next ones in blue, faintly, while you draw (O)" onClick={() => setOnion((o) => ({ ...o, enabled: !o.enabled }))}>
          <span className="onion-dots"><i style={{ background: 'var(--onion-before)' }} /><i style={{ background: 'var(--onion-after)' }} /></span>
          Onion skin
        </button>
        <div className="menu">
          <button className="icon-btn" aria-label="File menu" title="New, open and save animations" aria-expanded={menuOpen} onClick={() => setMenuOpen((m) => !m)}><I.More /></button>
          {menuOpen && (
            <div className="menu-list" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={newProject} title="Start a blank animation, replacing the current one">New animation</button>
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
            ref={fileInput} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }}
          />
        </div>
        <button className="btn primary" title="Export the animation as a GIF" onClick={() => { setPlaying(false); setExporting(true); }}>Export</button>
      </header>

      <div className="tool-options">
        <span className="tool-name">{TOOLS.find((t) => t.id === tool)?.name}</span>
        {tool === 'brush' && (
          <div className="presets" role="group" aria-label="Brush presets">
            {PRESETS.map((p) => (
              <button key={p.id} className={`btn small${preset?.id === p.id ? ' on' : ''}`} aria-pressed={preset?.id === p.id} title={`${p.name}: ${p.help}`} onClick={() => usePreset(p)}>{p.name}</button>
            ))}
            {!preset && <span className="hint" title="You've changed the settings of a preset">Custom</span>}
          </div>
        )}
        {(tool === 'brush' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse') && !(brush.fillShapes && (tool === 'rect' || tool === 'ellipse')) && (
          <label title={isEraser ? 'Width of the eraser in pixels ([ and ] to change)' : 'Width of the line in pixels ([ and ] to change)'}>Size
            <input
              type="range" min={1} max={isEraser ? 120 : 60} value={size}
              onChange={(e) => setBrush((b) => (isEraser ? { ...b, eraserSize: Number(e.target.value) } : { ...b, size: Number(e.target.value) }))}
            />
            <span className="value">{size} px</span>
          </label>
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
        {(tool === 'brush' || tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'fill') && (
          <label title="How solid the colour is. Lower values let lines and colours underneath show through.">Opacity
            <input type="range" min={5} max={100} value={Math.round(brush.opacity * 100)} onChange={(e) => setBrush((b) => ({ ...b, opacity: Number(e.target.value) / 100 }))} />
            <span className="value">{pct(brush.opacity)}</span>
          </label>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label title="Fill the shape with colour instead of drawing its outline"><input type="checkbox" checked={brush.fillShapes} onChange={(e) => setBrush((b) => ({ ...b, fillShapes: e.target.checked }))} /> Filled</label>
        )}
        {(tool === 'line' || tool === 'rect' || tool === 'ellipse') && <span className="hint">Hold Shift for {tool === 'line' ? '45° angles' : tool === 'rect' ? 'a square' : 'a circle'}</span>}
        {tool === 'fill' && <span className="hint">Click inside a closed area of the selected layer. The fill goes under your lines.</span>}
        {tool === 'eyedropper' && <span className="hint">Click the canvas to pick its colour. Alt+click does the same with any drawing tool.</span>}
        {tool === 'select' && !selection && <span className="hint">Draw a loop around strokes, or click one, to select them</span>}
        {tool === 'select' && selection && (
          <>
            <span className="hint">{selection.length} selected · drag to move · drag a corner to resize (Shift keeps proportions)</span>
            <button className="btn small" title="Mirror the selection left to right" onClick={flipSelection}>Flip</button>
            <button className="btn small" title="Copy the selection, slightly offset" onClick={duplicateSelection}>Duplicate</button>
            <button className="btn small" title="Copy the selection to paste it into another frame or layer (Ctrl+C, then Ctrl+V)" onClick={() => copyStrokes(activeLayerId, frame, selection)}>Copy</button>
            <button className="btn small" title="Delete the selected strokes (Delete)" onClick={deleteSelection}>Delete</button>
            <button className="btn small" title="Clear the selection (Esc)" onClick={() => setSelection(null)}>Deselect</button>
          </>
        )}
        {COLOUR_TOOLS.includes(tool) && (
          <div className="swatches" role="group" aria-label="Colour">
            Colour
            {palette.map((c) => (
              <button
                key={c} className={`swatch${brush.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`}
                title={`${c}. Right-click to remove it from the palette.`}
                onClick={() => setBrush((b) => ({ ...b, color: c }))}
                onContextMenu={(e) => { e.preventDefault(); setPalette((p) => (p.length > 1 ? p.filter((x) => x !== c) : p)); }}
              />
            ))}
            <input className="color-input" type="color" aria-label="Custom colour" title="Pick any colour" value={brush.color} onChange={(e) => setBrush((b) => ({ ...b, color: e.target.value }))} />
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
      </div>

      <div className="workspace">
        <nav className="tool-rail" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} aria-label={t.name} aria-pressed={tool === t.id}
              title={`${t.name} (${t.key.toUpperCase()}): ${t.help}`} onClick={() => setTool(t.id)}
            >
              <t.Icon />
            </button>
          ))}
          <div className="rail-sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={() => setHistory(undo)}><I.Undo /></button>
          <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => setHistory(redo)}><I.Redo /></button>
        </nav>

        <Stage
          project={project} frame={frame} activeLayerId={activeLayerId} tool={tool} brush={brush} onion={onion$}
          selection={selection} onSelectionChange={setSelection} onCommit={onCommit}
          panKey={spaceHeld} onPanned={() => { spacePanned.current = true; }}
          onPickColor={(color) => {
            setBrush((b) => ({ ...b, color }));
            if (tool === 'eyedropper') setTool('brush');
          }}
        />

        <LayersPanel
          project={project}
          frame={frame}
          activeLayerId={activeLayerId}
          onion={onion}
          onSelect={setActiveLayerId}
          onAdd={() => {
            const r = P.addLayer(project, `Layer ${project.layers.length + 1}`, activeLayerId);
            apply(() => r.project);
            setActiveLayerId(r.layerId);
          }}
          onRemove={(id) => apply((p) => P.removeLayer(p, id))}
          onMove={(id, delta) => apply((p) => P.moveLayer(p, id, delta))}
          onMoveTo={(id, gap) => apply((p) => P.moveLayerToGap(p, id, gap))}
          onUpdate={(id, patch, record = true) => apply((p) => P.updateLayer(p, id, patch), record)}
          onOnionChange={setOnion}
        />
      </div>

      <Timeline
        project={project}
        frame={frame}
        activeLayerId={activeLayerId}
        playing={playing}
        onSelect={(layerId, f) => { setActiveLayerId(layerId); goTo(f); }}
        onSelectFrame={goTo}
        onHold={(h) => apply((p) => P.setHoldAt(p, activeLayerId, frame, h))}
        onHoldToEnd={() => apply((p) => P.holdToEnd(p, activeLayerId, frame))}
        onNewDrawing={newDrawing}
        onDuplicate={duplicate}
        onDelete={() => apply((p) => P.deleteCelAt(p, activeLayerId, frame))}
        onFrameAction={onFrameAction}
        canPaste={!!clipboard}
        onMoveCel={onMoveCel}
        onUpdateLayer={(id, patch) => apply((p) => P.updateLayer(p, id, patch))}
        onMoveLayerTo={(id, gap) => apply((p) => P.moveLayerToGap(p, id, gap))}
      />

      {toast && <div className="toast" role="status">{toast}</div>}
      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
    </div>
  );
}
