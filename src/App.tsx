import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportDialog } from './components/ExportDialog';
import * as I from './components/Icons';
import { LayersPanel, type OnionState } from './components/LayersPanel';
import { Stage, type BrushSettings, type Tool } from './components/Stage';
import { Timeline, type FrameAction } from './components/Timeline';
import { commit, initHistory, redo, undo, type History } from './model/history';
import * as P from './model/project';
import { loadCurrentProject, readProjectFile, saveCurrentProject, saveProjectFile } from './storage';

const SWATCHES = ['#1a1a1a', '#6b6f78', '#e5534b', '#f08a3a', '#f2c94c', '#6faf6a', '#5b8fd9', '#9b6fd6', '#ffffff'];

export default function App() {
  const [history, setHistory] = useState<History<P.Project>>(() => initHistory(P.createProject()));
  const [loaded, setLoaded] = useState(false);
  const project = history.present;
  const [activeLayerId, setActiveLayerId] = useState(() => history.present.layers.at(-1)!.id);
  const [frame, setFrame] = useState(0);
  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState<BrushSettings>({ color: '#1a1a1a', size: 6, eraserSize: 24, smoothing: 0.5, pressure: true });
  const [onion, setOnion] = useState<OnionState>({ enabled: true, before: 1, after: 1 });
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseRef = useRef<P.Project | null>(null);

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
    loadCurrentProject().then((saved) => {
      if (saved) {
        setHistory(initHistory(saved));
        setActiveLayerId(saved.layers.at(-1)!.id);
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => saveCurrentProject(project).catch(() => {}), 400);
    return () => window.clearTimeout(id);
  }, [project, loaded]);

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

  const onFrameAction = useCallback((action: FrameAction, layerId: string, f: number) => {
    setPlaying(false);
    setActiveLayerId(layerId);
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
  }, [apply, project]);

  const onMoveCel = useCallback((layerId: string, from: number, to: number) => {
    const r = P.moveCel(project, layerId, from, to);
    apply(() => r.project);
    setActiveLayerId(layerId);
    setFrame(r.frame);
  }, [apply, project]);

  const onStroke = useCallback((stroke: P.Stroke) => apply((p) => P.addStroke(p, activeLayerId, frame, stroke)), [apply, activeLayerId, frame]);

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
      if (mod) return;
      if (key === ' ') { e.preventDefault(); togglePlay(); }
      else if (key === 'arrowright' || key === '.') { e.preventDefault(); goTo(frame + 1); }
      else if (key === 'arrowleft' || key === ',') { e.preventDefault(); goTo(frame - 1); }
      else if (key === 'home') goTo(0);
      else if (key === 'end') goTo(length - 1);
      else if (key === 'b') setTool('brush');
      else if (key === 'e') setTool('eraser');
      else if (key === 'n') newDrawing();
      else if (key === 'd') duplicate();
      else if (key === 'o') setOnion((o) => ({ ...o, enabled: !o.enabled }));
      else if (key === '[') setBrush((b) => (tool === 'eraser' ? { ...b, eraserSize: Math.max(2, b.eraserSize - 2) } : { ...b, size: Math.max(1, b.size - 1) }));
      else if (key === ']') setBrush((b) => (tool === 'eraser' ? { ...b, eraserSize: Math.min(120, b.eraserSize + 2) } : { ...b, size: Math.min(60, b.size + 1) }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exporting, frame, length, tool, togglePlay, goTo, newDrawing, duplicate]);

  const newProject = () => {
    setMenuOpen(false);
    if (!window.confirm('Start a new animation? The current one will be replaced. Save it to a file first if you want to keep it.')) return;
    const p = P.createProject();
    setHistory(initHistory(p));
    setActiveLayerId(p.layers.at(-1)!.id);
    setFrame(0);
  };

  const openFile = async (file: File) => {
    try {
      const p = await readProjectFile(file);
      setHistory(initHistory(p));
      setActiveLayerId(p.layers.at(-1)!.id);
      setFrame(0);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open that file.');
    }
  };

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
        <div className="spacer" />
        <div className="transport">
          <button className="icon-btn" aria-label="First frame" title="First frame (Home)" onClick={() => goTo(0)}><I.First /></button>
          <button className="icon-btn" aria-label="Previous frame" title="Previous frame (←)" onClick={() => goTo(frame - 1)}><I.Prev /></button>
          <button className="icon-btn play" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" onClick={togglePlay}>{playing ? <I.Pause /> : <I.Play />}</button>
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
              <button onClick={() => { setMenuOpen(false); fileInput.current?.click(); }} title="Open an animation saved with Save to file">Open from file…</button>
              <button onClick={() => { setMenuOpen(false); saveProjectFile(project); }} title="Download this animation as a file you can back up or open later. It also saves automatically in this browser.">Save to file</button>
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
        <span className="tool-name">{isEraser ? 'Eraser' : 'Brush'}</span>
        <label title={isEraser ? 'Width of the eraser in pixels ([ and ] to change)' : 'Width of the line in pixels ([ and ] to change)'}>Size
          <input
            type="range" min={1} max={isEraser ? 120 : 60} value={size}
            onChange={(e) => setBrush((b) => (isEraser ? { ...b, eraserSize: Number(e.target.value) } : { ...b, size: Number(e.target.value) }))}
          />
          <span className="value">{size} px</span>
        </label>
        {!isEraser && (
          <>
            <label title="Evens out shaky lines. Higher values give smoother curves but follow the pen less closely.">Smoothing
              <input type="range" min={0} max={100} value={Math.round(brush.smoothing * 100)} onChange={(e) => setBrush((b) => ({ ...b, smoothing: Number(e.target.value) / 100 }))} />
              <span className="value">{Math.round(brush.smoothing * 100)}%</span>
            </label>
            <label title="Lines get thicker when you press harder with a pen or tablet. With a mouse it imitates pressure from drawing speed. Untick for an even line width."><input type="checkbox" checked={brush.pressure} onChange={(e) => setBrush((b) => ({ ...b, pressure: e.target.checked }))} /> Pressure</label>
            <div className="swatches" role="group" aria-label="Colour">
              Colour
              {SWATCHES.map((c) => (
                <button key={c} className={`swatch${brush.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} title="Brush colour" onClick={() => setBrush((b) => ({ ...b, color: c }))} />
              ))}
              <input className="color-input" type="color" aria-label="Custom colour" title="Pick any colour" value={brush.color} onChange={(e) => setBrush((b) => ({ ...b, color: e.target.value }))} />
            </div>
          </>
        )}
      </div>

      <div className="workspace">
        <nav className="tool-rail" aria-label="Tools">
          <button className={`icon-btn${tool === 'brush' ? ' on' : ''}`} aria-label="Brush" aria-pressed={tool === 'brush'} title="Brush (B)" onClick={() => setTool('brush')}><I.Brush /></button>
          <button className={`icon-btn${tool === 'eraser' ? ' on' : ''}`} aria-label="Eraser" aria-pressed={tool === 'eraser'} title="Eraser (E)" onClick={() => setTool('eraser')}><I.Eraser /></button>
          <div className="rail-sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={() => setHistory(undo)}><I.Undo /></button>
          <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => setHistory(redo)}><I.Redo /></button>
        </nav>

        <Stage project={project} frame={frame} activeLayerId={activeLayerId} tool={tool} brush={brush} onion={onion$} onStroke={onStroke} />

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
        onMoveCel={onMoveCel}
      />

      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
    </div>
  );
}
