import { useEffect, useRef, useState } from 'react';
import { GRAINS, matchingPreset, type BrushPreset } from '../model/brushes';
import type { GrainKind, Point, Stroke } from '../model/project';
import { paintStroke } from '../render/render';
import type { BrushSettings } from './Stage';

interface Props {
  brush: BrushSettings;
  onChange: (patch: Partial<BrushSettings>) => void;
  /** The user's saved brushes. */
  saved: BrushPreset[];
  onSave: (brushes: BrushPreset[]) => void;
  onClose: () => void;
}

const W = 340, H = 140;

/** An S-shaped test line that presses harder in the middle. */
function previewPoints(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    pts.push([30 + t * (W - 60), H / 2 + Math.sin(t * Math.PI * 2) * 34, 0.2 + 0.8 * Math.sin(t * Math.PI)]);
  }
  return pts;
}

/** Everything a brush is made of, in one place: size, flow, steadiness, edge and paper grain. Save it as your own brush. */
export function BrushEditor({ brush, onChange, saved, onSave, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = matchingPreset(brush, saved);
  const [name, setName] = useState(current?.custom ? current.name : '');

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s: Stroke = {
      points: previewPoints(), color: brush.color, size: brush.size, erase: false, smoothing: brush.smoothing,
      simulatePressure: false, thinning: brush.pressure ? brush.thinning : 0,
      ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
      ...(brush.softness > 0 ? { softness: brush.softness } : {}),
      ...(brush.grain !== 'none' && brush.grainAmount > 0 ? { grain: { kind: brush.grain, amount: brush.grainAmount } } : {}),
    };
    paintStroke(ctx, s, true);
  }, [brush]);

  const slider = (label: string, help: string, key: 'opacity' | 'smoothing' | 'stabilizer' | 'thinning' | 'softness' | 'grainAmount', disabled = false) => (
    <label className="row" title={help}>
      {label}
      <span className="row-input">
        <input type="range" min={0} max={100} disabled={disabled} value={Math.round(brush[key] * 100)} onChange={(e) => onChange({ [key]: Number(e.target.value) / 100 })} />
        <span className="value">{Math.round(brush[key] * 100)}%</span>
      </span>
    </label>
  );

  const fields = (): Omit<BrushPreset, 'id' | 'name' | 'help'> => ({
    size: brush.size, opacity: brush.opacity, smoothing: brush.smoothing, stabilizer: brush.stabilizer,
    thinning: brush.pressure ? brush.thinning : 0, softness: brush.softness, grain: brush.grain, grainAmount: brush.grainAmount, custom: true,
  });
  const trimmed = name.trim();
  const saveNew = () => {
    if (!trimmed) return;
    onSave([...saved, { id: `b${Date.now().toString(36)}`, name: trimmed, help: 'your brush', ...fields() }]);
  };
  const editing = saved.find((b) => b.custom && b.name === trimmed);
  const update = () => editing && onSave(saved.map((b) => (b.id === editing.id ? { ...b, ...fields() } : b)));

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog brush-editor" role="dialog" aria-label="Brush editor">
        <div className="dialog-head">
          <h2>Brush</h2>
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        <div className="dialog-body">
          <div>
            <canvas ref={canvas} className="brush-preview" style={{ width: W, height: H }} aria-label="Brush preview" />
            <div className="presets brush-list" role="group" aria-label="Your brushes">
              {saved.length === 0 && <span className="hint">Brushes you save show up next to the presets.</span>}
              {saved.map((b) => (
                <span key={b.id} className="saved-brush">
                  <span>{b.name}</span>
                  <button className="btn small" title={`Delete ${b.name}`} aria-label={`Delete ${b.name}`} onClick={() => onSave(saved.filter((x) => x.id !== b.id))}>✕</button>
                </span>
              ))}
            </div>
          </div>
          <div className="dialog-form">
            <label className="row" title="Width of the line in pixels">
              Size
              <span className="row-input">
                <input type="range" min={1} max={60} value={brush.size} onChange={(e) => onChange({ size: Number(e.target.value) })} />
                <span className="value">{brush.size} px</span>
              </span>
            </label>
            {slider('Opacity', 'How solid the colour is', 'opacity')}
            {slider('Smoothing', 'Evens out shaky lines', 'smoothing')}
            {slider('Stabilizer', 'The line trails the pointer and ignores small wobbles', 'stabilizer')}
            <label className="row" title="Lines get thicker when you press harder">
              Pressure
              <input type="checkbox" checked={brush.pressure} onChange={(e) => onChange({ pressure: e.target.checked, thinning: e.target.checked && !brush.thinning ? 0.6 : brush.thinning })} />
            </label>
            {slider('Pressure amount', 'How much pressure changes the width', 'thinning', !brush.pressure)}
            {slider('Soft edge', 'Blurs the edge of the line', 'softness')}
            <label className="row" title="Paper texture that shows through the line">
              Grain
              <select value={brush.grain} onChange={(e) => onChange({ grain: e.target.value as GrainKind | 'none', grainAmount: brush.grainAmount || 0.5 })}>
                {GRAINS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            {slider('Grain amount', 'How much of the texture shows', 'grainAmount', brush.grain === 'none')}
          </div>
        </div>
        <div className="dialog-foot">
          <input type="text" placeholder="Brush name" aria-label="Brush name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {editing && <button className="btn" onClick={update}>Update {editing.name}</button>}
          <button className="btn primary" disabled={!trimmed || !!editing} onClick={saveNew}>Save as new brush</button>
        </div>
      </div>
    </div>
  );
}
