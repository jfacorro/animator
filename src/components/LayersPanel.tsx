import { useEffect, useRef, useState } from 'react';
import { drawingAt, layerLength, type Layer, type Project } from '../model/project';
import { drawingBitmap, PAPER } from '../render/render';
import * as I from './Icons';
import { useLayerDrag } from './useLayerDrag';

export interface OnionState {
  enabled: boolean;
  before: number;
  after: number;
}

interface Props {
  project: Project;
  frame: number;
  activeLayerId: string;
  onion: OnionState;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  /** Drag a layer into a gap in the stack, counted bottom to top. */
  onMoveTo: (id: string, gap: number) => void;
  onUpdate: (id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity'>>, record?: boolean) => void;
  onOnionChange: (onion: OnionState) => void;
}

export function LayersPanel(props: Props) {
  const { project, activeLayerId, onion } = props;
  const active = project.layers.find((l) => l.id === activeLayerId);
  const topFirst = [...project.layers].reverse();
  const index = project.layers.findIndex((l) => l.id === activeLayerId);
  const drag = useLayerDrag(project.layers.length, props.onMoveTo);

  return (
    <aside className="layers" aria-label="Layers">
      <div className="panel-head">
        <span className="panel-title">Layers</span>
        <button className="icon-btn sm" aria-label="Add layer" title="Add layer" onClick={props.onAdd}><I.Plus /></button>
      </div>
      <div className="layer-list">
        {topFirst.map((layer, i) => (
          <LayerRow key={layer.id} layer={layer} {...props} dragProps={drag.rowProps(layer.id)} dragClass={drag.rowClass(layer.id, i)} />
        ))}
      </div>
      <div className="layer-actions">
        <button className="icon-btn sm" aria-label="Move layer up" title="Move layer up" disabled={index >= project.layers.length - 1} onClick={() => props.onMove(activeLayerId, 1)}><I.Up /></button>
        <button className="icon-btn sm" aria-label="Move layer down" title="Move layer down" disabled={index <= 0} onClick={() => props.onMove(activeLayerId, -1)}><I.Down /></button>
        <div className="spacer" />
        <button className="icon-btn sm" aria-label="Delete layer" title="Delete layer" disabled={project.layers.length <= 1} onClick={() => props.onRemove(activeLayerId)}><I.Trash /></button>
      </div>
      {active && (
        <div className="panel-section">
          <label className="row" title="How see-through the selected layer is">
            Opacity
            <input
              type="range" min={0} max={100} value={Math.round(active.opacity * 100)}
              onChange={(e) => props.onUpdate(active.id, { opacity: Number(e.target.value) / 100 }, false)}
              onPointerUp={(e) => props.onUpdate(active.id, { opacity: Number((e.target as HTMLInputElement).value) / 100 }, true)}
              onKeyUp={(e) => props.onUpdate(active.id, { opacity: Number((e.target as HTMLInputElement).value) / 100 }, true)}
            />
            <span className="value">{Math.round(active.opacity * 100)}%</span>
          </label>
        </div>
      )}
      <div className="panel-section">
        <label className="row" title="Show nearby drawings faintly while you draw, to help with spacing">
          <span className="panel-title" style={{ color: 'var(--text)' }}>Onion skin</span>
          <input type="checkbox" checked={onion.enabled} onChange={(e) => props.onOnionChange({ ...onion, enabled: e.target.checked })} />
        </label>
        <label className="row" title="How many earlier drawings to show, in red">
          <span><i className="dot" style={{ background: 'var(--onion-before)' }} />Drawings before</span>
          <select value={onion.before} onChange={(e) => props.onOnionChange({ ...onion, before: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="row" title="How many later drawings to show, in blue">
          <span><i className="dot" style={{ background: 'var(--onion-after)' }} />Drawings after</span>
          <select value={onion.after} onChange={(e) => props.onOnionChange({ ...onion, after: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="muted" style={{ fontSize: 11.5 }}>Shows on the selected layer only.</span>
      </div>
    </aside>
  );
}

function LayerRow({ layer, project, frame, activeLayerId, onSelect, onUpdate, dragProps, dragClass }: Props & { layer: Layer; dragProps: object; dragClass: string }) {
  const [renaming, setRenaming] = useState(false);
  const drawings = layer.cels.filter((c) => c.drawingId).length;
  const length = layerLength(layer);
  const meta = `${drawings} drawing${drawings === 1 ? '' : 's'} · ${length} frame${length === 1 ? '' : 's'}`;
  const isActive = layer.id === activeLayerId;

  return (
    <div
      {...dragProps}
      className={`layer-row${isActive ? ' active' : ''}${layer.visible ? '' : ' hidden'}${dragClass}`}
      title="Click to draw on this layer. Drag it up or down to change the stacking order."
      onClick={() => onSelect(layer.id)}
      aria-current={isActive}
    >
      <button
        className="icon-btn sm" aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={layer.visible ? 'Hide this layer' : 'Show this layer'}
        onClick={(e) => { e.stopPropagation(); onUpdate(layer.id, { visible: !layer.visible }); }}
      >
        {layer.visible ? <I.Eye /> : <I.EyeOff />}
      </button>
      <Thumb project={project} layer={layer} frame={frame} />
      <div className="layer-text">
        {renaming ? (
          <input
            className="layer-rename" type="text" defaultValue={layer.name} autoFocus aria-label="Layer name"
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { onUpdate(layer.id, { name: e.target.value.trim() || layer.name }); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <div className="layer-name" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{layer.name}</div>
        )}
        <div className="layer-meta">{meta}</div>
      </div>
      <button
        className="icon-btn sm" aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        title={layer.locked ? 'Unlock this layer' : 'Lock this layer so it can\'t be drawn on or edited'}
        style={layer.locked ? { color: 'var(--accent)' } : undefined}
        onClick={(e) => { e.stopPropagation(); onUpdate(layer.id, { locked: !layer.locked }); }}
      >
        {layer.locked ? <I.Lock /> : <I.Unlock />}
      </button>
    </div>
  );
}

function Thumb({ project, layer, frame }: { project: Project; layer: Layer; frame: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = drawingAt(project, layer, frame);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = ref.current!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (drawing?.strokes.length) ctx.drawImage(drawingBitmap(drawing, project.width, project.height), 0, 0, w, h);
  }, [drawing, project.width, project.height]);
  return <canvas ref={ref} className="layer-thumb" width={104} height={60} aria-hidden="true" />;
}
