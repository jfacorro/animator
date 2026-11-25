import { useEffect, useMemo, useState } from 'react';
import {
  adjustPixels, adjustStrokes, NO_ADJUST, pixelColours, recolourPixels, recolourStrokes, strokeColours, type Adjust,
} from '../model/adjust';
import { drawingAt, type Drawing, type Project } from '../model/project';
import { encodePaint, livePaint, paintReady, paintSheet } from '../render/render';

interface Props {
  project: Project;
  layerId: string;
  frame: number;
  /** Selected strokes on a line layer: only they change. */
  selection: number[] | null;
  /** The current colour: what Recolour starts out turning colours into. */
  color: string;
  /** Show the result on the canvas without keeping it (null shows the drawing as it is). */
  onPreview: (p: Project | null) => void;
  onApply: (p: Project) => void;
  onClose: () => void;
}

type Mode = 'hsb' | 'recolour';

/** Hue, saturation and brightness, or Recolour, for the current drawing or the whole layer. */
export function AdjustDialog({ project, layerId, frame, selection, color, onPreview, onApply, onClose }: Props) {
  const layer = project.layers.find((l) => l.id === layerId);
  const current = layer ? drawingAt(project, layer, frame) : null;
  const [mode, setMode] = useState<Mode>('hsb');
  const [adj, setAdj] = useState<Adjust>(NO_ADJUST);
  const [wholeLayer, setWholeLayer] = useState(false);
  const [tolerance, setTolerance] = useState(0.15);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const W = project.width, H = project.height;
  const only = selection && !wholeLayer && !layer?.paint ? selection : null;

  /** The colours in the current drawing, for Recolour to pick from. */
  const colours = useMemo(() => {
    if (!current) return [];
    if (!current.paint) return strokeColours(only ? current.strokes.filter((_, i) => only.includes(i)) : current.strokes);
    try {
      const sheet = paintSheet(current.paint, W, H);
      return pixelColours(sheet.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data);
    } catch { return []; }
  }, [current, only?.join(), W, H]); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(color.toLowerCase());
  const source = from && colours.includes(from) ? from : colours[0] ?? null;

  const changed = mode === 'hsb' ? adj.hue !== 0 || adj.saturation !== 0 || adj.brightness !== 0 : !!source && source !== to;

  /** One drawing with the change made. Paint comes back as a live sheet (for showing) or encoded (for keeping). */
  const change = (d: Drawing, keep: boolean): Drawing => {
    if (d.paint) {
      const sheet = paintSheet(d.paint, W, H);
      const ctx = sheet.getContext('2d', { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, W, H);
      if (mode === 'hsb') adjustPixels(img.data, adj);
      else if (source) recolourPixels(img.data, source, to, tolerance);
      ctx.putImageData(img, 0, 0);
      const paint = keep ? encodePaint(sheet, W, H) : livePaint(sheet);
      return paint ? { ...d, paint } : { id: d.id, strokes: [] };
    }
    const strokes = mode === 'hsb' ? adjustStrokes(d.strokes, adj, only) : source ? recolourStrokes(d.strokes, source, to, tolerance, only) : d.strokes;
    return { ...d, strokes };
  };

  const result = (keep: boolean): Project => {
    if (!layer) return project;
    // The preview shows the current drawing; the whole layer changes when it's applied.
    const ids = wholeLayer && keep ? [...new Set(layer.cels.map((c) => c.drawingId).filter((id): id is string => !!id))] : current ? [current.id] : [];
    const drawings = { ...project.drawings };
    for (const id of ids) if (drawings[id]) drawings[id] = change(drawings[id], keep);
    return { ...project, drawings };
  };

  // Live preview, a moment after the sliders stop.
  useEffect(() => {
    if (!changed) { onPreview(null); return; }
    const t = window.setTimeout(() => {
      try { onPreview(result(false)); setError(null); } catch (e) { setError((e as Error).message); }
    }, 40);
    return () => window.clearTimeout(t);
  }, [mode, adj, source, tolerance, to, changed, wholeLayer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setBusy(true);
    try {
      if (wholeLayer) await paintReady(project);
      onApply(result(true));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const slider = (label: string, key: keyof Adjust, min: number, max: number, scale: number, unit: string) => (
    <label className="row">
      {label}
      <span className="row-input">
        <input type="range" min={min} max={max} value={Math.round(adj[key] * scale)} aria-label={label} onChange={(e) => setAdj((a) => ({ ...a, [key]: Number(e.target.value) / scale }))} />
        <span className="value">{Math.round(adj[key] * scale)}{unit}</span>
      </span>
    </label>
  );

  return (
    <div className="backdrop side" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog adjust" role="dialog" aria-label="Adjust colours">
        <div className="dialog-head">
          <h2>Adjust colours</h2>
          <div className="segmented" role="group" aria-label="Adjustment">
            <button className={`btn small${mode === 'hsb' ? ' on' : ''}`} aria-pressed={mode === 'hsb'} onClick={() => setMode('hsb')}>Hue, saturation, brightness</button>
            <button className={`btn small${mode === 'recolour' ? ' on' : ''}`} aria-pressed={mode === 'recolour'} onClick={() => setMode('recolour')}>Recolour</button>
          </div>
        </div>
        <div className="dialog-form adjust-body">
          {!current && <p className="hint">There's no drawing on this frame of the layer.</p>}
          {mode === 'hsb' ? (
            <>
              {slider('Hue', 'hue', -180, 180, 1, '°')}
              {slider('Saturation', 'saturation', -100, 100, 100, '%')}
              {slider('Brightness', 'brightness', -100, 100, 100, '%')}
              <button className="link-btn" disabled={!changed} onClick={() => setAdj(NO_ADJUST)}>Reset</button>
            </>
          ) : (
            <>
              <div className="colour-section">
                <span>Change this colour</span>
                <div className="swatch-row" role="group" aria-label="Colours in the drawing">
                  {colours.length ? colours.map((c) => (
                    <button key={c} className={`swatch${c === source ? ' on' : ''}`} style={{ background: c }} aria-label={`Recolour ${c}`} title={c} onClick={() => setFrom(c)} />
                  )) : <span className="hint">No colours here yet.</span>}
                </div>
              </div>
              <label className="row">
                To this colour
                <input className="color-input" type="color" aria-label="New colour" value={to} onChange={(e) => setTo(e.target.value.toLowerCase())} />
              </label>
              <label className="row" title="How different a colour can be and still change: raise it to take shading and soft edges along">
                Tolerance
                <span className="row-input">
                  <input type="range" min={0} max={60} value={Math.round(tolerance * 100)} aria-label="Tolerance" onChange={(e) => setTolerance(Number(e.target.value) / 100)} />
                  <span className="value">{Math.round(tolerance * 100)}%</span>
                </span>
              </label>
            </>
          )}
          <label className="row" title="Change every drawing in this layer, not only the one on this frame. The preview shows this frame.">
            Every drawing in this layer
            <input type="checkbox" checked={wholeLayer} onChange={(e) => setWholeLayer(e.target.checked)} />
          </label>
          {only && !wholeLayer && <p className="hint">Only the selected lines change.</p>}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!changed || !current || busy} onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
