import { useEffect, useRef, useState } from 'react';
import { drawingAt, isBlank, layerLength, type Layer, type LayerGroup, type Project } from '../model/project';
import { BLEND_MODES } from '../model/groups';
import { drawingBitmap, loadedImage, onImageLoad, PAPER } from '../render/render';
import * as I from './Icons';
import { layerDrops, useLayerDrag, type DragKind, type Drop } from './useLayerDrag';

export interface OnionState {
  enabled: boolean;
  before: number;
  after: number;
  /** Strength of the nearest onion skin, 0–1. */
  opacity: number;
  /** Show onion skins on every unlocked visible layer, not only the selected one. */
  allLayers: boolean;
  beforeColor: string;
  afterColor: string;
}

export const DEFAULT_ONION: OnionState = { enabled: true, before: 1, after: 1, opacity: 0.45, allLayers: false, beforeColor: '#e5534b', afterColor: '#4c8df0' };

interface Props {
  project: Project;
  /** Painting the active layer's mask instead of the layer. */
  maskEdit: boolean;
  onMaskEdit: (on: boolean) => void;
  frame: number;
  activeLayerId: string;
  onion: OnionState;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Add a paint layer: drawing on it makes pixels, like a paint app. */
  onAddPaint: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  /** Drag a layer or group to a spot in the stack. */
  onDrop: (id: string, kind: DragKind, drop: Drop) => void;
  onUpdate: (id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'clip' | 'alphaLock' | 'everyFrame' | 'mask' | 'maskOff'>>, record?: boolean) => void;
  /** The selected group, when a group row was clicked (its settings show below). */
  selectedGroupId: string | null;
  onSelectGroup: (id: string | null) => void;
  onUpdateGroup: (id: string, patch: Partial<Omit<LayerGroup, 'id'>>, record?: boolean) => void;
  onGroup: (layerId: string) => void;
  onUngroup: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onOnionChange: (onion: OnionState) => void;
  onAddReference: () => void;
  /** While playing, thumbnails stay on the frame playback started from. */
  playing?: boolean;
}

export function LayersPanel(props: Props) {
  const { project, activeLayerId, onion, selectedGroupId } = props;
  const active = project.layers.find((l) => l.id === activeLayerId);
  const group = selectedGroupId ? project.groups?.[selectedGroupId] ?? null : null;
  const index = project.layers.findIndex((l) => l.id === activeLayerId);
  const drag = useLayerDrag(props.onDrop);
  const stillFrame = useRef(props.frame);
  if (!props.playing) stillFrame.current = props.frame;
  const thumbFrame = stillFrame.current;

  // Rows top first, with a header above each group's layers.
  const rows: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (let i = project.layers.length - 1; i >= 0; i--) {
    const layer = project.layers[i];
    const g = layer.groupId ? project.groups?.[layer.groupId] : undefined;
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      const first = project.layers.findIndex((l) => l.groupId === g.id);
      const below: Drop = g.collapsed ? { gap: first, group: null } : { gap: i + 1, group: g.id };
      rows.push(
        <GroupRow
          key={`g:${g.id}`} group={g} selected={g.id === selectedGroupId} {...props}
          dragProps={drag.rowProps(`g:${g.id}`, g.id, 'group', { gap: i + 1, group: null }, below)} dragClass={drag.rowClass(`g:${g.id}`)}
        />,
      );
    }
    if (g?.collapsed) continue;
    const d = layerDrops(i, layer.groupId);
    rows.push(
      <LayerRow
        key={layer.id} layer={layer} inGroup={!!g} groupHidden={!!g && !g.visible} {...props} frame={thumbFrame}
        dragProps={drag.rowProps(layer.id, layer.id, 'layer', d.above, d.below)} dragClass={drag.rowClass(layer.id)}
      />,
    );
  }

  const opacityTarget = group
    ? { value: group.opacity, set: (v: number, record: boolean) => props.onUpdateGroup(group.id, { opacity: v }, record), what: 'group' }
    : active ? { value: active.opacity, set: (v: number, record: boolean) => props.onUpdate(active.id, { opacity: v }, record), what: 'layer' } : null;
  const blend = group ? group.blend ?? 'normal' : active?.blend ?? 'normal';
  const isBottom = index === 0 || (active?.groupId && project.layers[index - 1]?.groupId !== active.groupId);

  return (
    <aside className="layers" aria-label="Layers">
      <div className="panel-head">
        <span className="panel-title">Layers</span>
        <span className="head-btns">
          <button className="icon-btn sm" aria-label="Add reference image" title="Add a picture to trace over. It shows on every frame, is never exported, and can't be drawn on." onClick={props.onAddReference}><I.Image /></button>
          <button className="icon-btn sm" aria-label="Add paint layer" title="Add a paint layer above the selected one. What you draw on it becomes pixels, like in a paint app: good for colour, shading and texture, and the eraser really removes paint. Lines can't be selected or moved one by one." onClick={props.onAddPaint}><I.PaintLayer /></button>
          <button className="icon-btn sm" aria-label="Add layer" title="Add a line layer above the selected one. Every line stays editable: select, move and resize it with the Lasso." onClick={props.onAdd}><I.Plus /></button>
        </span>
      </div>
      <div className="layer-list">{rows}</div>
      <div className="layer-actions">
        <button className="icon-btn sm" aria-label="Move layer up" title="Move layer up" disabled={!!group || index >= project.layers.length - 1} onClick={() => props.onMove(activeLayerId, 1)}><I.Up /></button>
        <button className="icon-btn sm" aria-label="Move layer down" title="Move layer down" disabled={!!group || index <= 0} onClick={() => props.onMove(activeLayerId, -1)}><I.Down /></button>
        {group ? (
          <button className="btn small" title="Dissolve the group and keep its layers" onClick={() => props.onUngroup(group.id)}>Ungroup</button>
        ) : active && !active.groupId ? (
          <button className="btn small" title="Put the selected layer in a new group. Drag other layers into it, or add layers while one of its layers is selected." onClick={() => props.onGroup(active.id)}>Group</button>
        ) : active?.groupId ? (
          <button className="btn small" title="Take the selected layer out of its group" onClick={() => props.onDrop(active.id, 'layer', { gap: index + 1, group: null })}>Leave group</button>
        ) : null}
        <div className="spacer" />
        {group ? (
          <button className="icon-btn sm" aria-label="Delete group" title="Delete the group and its layers" disabled={project.layers.every((l) => l.groupId === group.id)}
            onClick={() => { if (window.confirm(`Delete ${group.name} and its layers?`)) props.onRemoveGroup(group.id); }}><I.Trash /></button>
        ) : (
          <button className="icon-btn sm" aria-label="Delete layer" title="Delete layer" disabled={!project.layers.some((l) => l.id !== activeLayerId && !l.reference)} onClick={() => props.onRemove(activeLayerId)}><I.Trash /></button>
        )}
      </div>
      {opacityTarget && (
        <div className="panel-section">
          <div className="muted section-label">{group ? group.name : active?.name}</div>
          <label className="row" title={`How see-through the selected ${opacityTarget.what} is`}>
            Opacity
            <input
              type="range" min={0} max={100} value={Math.round(opacityTarget.value * 100)}
              onChange={(e) => opacityTarget.set(Number(e.target.value) / 100, false)}
              onPointerUp={(e) => opacityTarget.set(Number((e.target as HTMLInputElement).value) / 100, true)}
              onKeyUp={(e) => opacityTarget.set(Number((e.target as HTMLInputElement).value) / 100, true)}
            />
            <span className="value">{Math.round(opacityTarget.value * 100)}%</span>
          </label>
          <label className="row" title="How the colours mix with what's underneath. Multiply darkens (good for shadows), Screen and Add lighten (light and glows), Overlay adds contrast.">
            Blend
            <select
              value={blend}
              onChange={(e) => {
                const b = e.target.value as NonNullable<Layer['blend']>;
                if (group) props.onUpdateGroup(group.id, { blend: b });
                else if (active) props.onUpdate(active.id, { blend: b });
              }}
            >
              {BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {!group && active && !active.reference && (
            <label className="row" title={isBottom ? 'There is no layer below this one to clip to' : 'Clipping mask: only show this layer where the layer below it has paint. Great for shading and colour inside the lines.'}>
              Clip to layer below
              <input type="checkbox" disabled={!!isBottom && !active.clip} checked={!!active.clip} onChange={(e) => props.onUpdate(active.id, { clip: e.target.checked })} />
            </label>
          )}
          {!group && active && !active.reference && (
            <label className="row" title="Foreground or background: this layer's first drawing shows on every frame, and gets no onion skin. Good for a set, a sky or a frame around the shot.">
              Same on every frame
              <input type="checkbox" checked={!!active.everyFrame} onChange={(e) => props.onUpdate(active.id, { everyFrame: e.target.checked })} />
            </label>
          )}
          {!group && active && !active.reference && (
            <label className="row" title={active.paint ? 'Alpha lock: new paint only goes where this layer already has paint, so you can shade and recolour without going over the edges. The eraser still erases.' : 'Alpha lock: new lines only show where this drawing already has lines or fills. Lines drawn with it stay clipped to what is under them, so select both when you move them.'}>
              Alpha lock
              <input type="checkbox" checked={!!active.alphaLock} onChange={(e) => props.onUpdate(active.id, { alphaLock: e.target.checked })} />
            </label>
          )}
          {!group && active && !active.reference && (active.mask === undefined ? (
            <div className="row">
              Mask
              <button className="btn small" title="Add a layer mask: paint on it to hide parts of this layer without erasing them, erase to bring them back" onClick={() => { props.onUpdate(active.id, { mask: null, maskOff: false }); props.onMaskEdit(true); }}>Add mask</button>
            </div>
          ) : (
            <div className="row mask-row">
              <label title="Use the mask. Untick to see the whole layer while keeping the mask.">
                <input type="checkbox" checked={!active.maskOff} onChange={(e) => props.onUpdate(active.id, { maskOff: !e.target.checked })} /> Mask
              </label>
              <span className="mask-actions">
                <button className={`btn small${props.maskEdit ? ' on' : ''}`} aria-pressed={props.maskEdit} title={props.maskEdit ? 'Back to drawing on the layer' : 'Paint the mask: the brush hides the layer, the eraser shows it again'} onClick={() => props.onMaskEdit(!props.maskEdit)}>{props.maskEdit ? 'Done' : 'Paint mask'}</button>
                <button className="btn small" title="Delete the mask: the whole layer shows again" onClick={() => { props.onMaskEdit(false); props.onUpdate(active.id, { mask: undefined, maskOff: undefined }); }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="panel-section">
        <label className="row" title="Show nearby drawings faintly while you draw, to help with spacing">
          <span className="panel-title" style={{ color: 'var(--text)' }}>Onion skin</span>
          <input type="checkbox" checked={onion.enabled} onChange={(e) => props.onOnionChange({ ...onion, enabled: e.target.checked })} />
        </label>
        <div className="row" title="How many earlier drawings to show. Click the colour dot to change their colour.">
          <span className="onion-label">
            <input type="color" className="dot-input" aria-label="Colour of earlier drawings" value={onion.beforeColor} onChange={(e) => props.onOnionChange({ ...onion, beforeColor: e.target.value })} />
            Drawings before
          </span>
          <select aria-label="Drawings before" value={onion.before} onChange={(e) => props.onOnionChange({ ...onion, before: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="row" title="How many later drawings to show. Click the colour dot to change their colour.">
          <span className="onion-label">
            <input type="color" className="dot-input" aria-label="Colour of later drawings" value={onion.afterColor} onChange={(e) => props.onOnionChange({ ...onion, afterColor: e.target.value })} />
            Drawings after
          </span>
          <select aria-label="Drawings after" value={onion.after} onChange={(e) => props.onOnionChange({ ...onion, after: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <label className="row" title="How strong the nearest onion skin is. Further ones fade out.">
          Strength
          <input type="range" min={10} max={100} value={Math.round(onion.opacity * 100)} onChange={(e) => props.onOnionChange({ ...onion, opacity: Number(e.target.value) / 100 })} />
          <span className="value">{Math.round(onion.opacity * 100)}%</span>
        </label>
        <label className="row" title="Show onion skins on every visible layer that isn't locked, instead of only the selected layer">
          All layers
          <input type="checkbox" checked={onion.allLayers} onChange={(e) => props.onOnionChange({ ...onion, allLayers: e.target.checked })} />
        </label>
        <span className="muted" style={{ fontSize: 11.5 }}>{onion.allLayers ? 'Shows on every unlocked layer.' : 'Shows on the selected layer only.'}</span>
      </div>
    </aside>
  );
}

function LayerRow({ layer, project, frame, activeLayerId, selectedGroupId, onSelect, onSelectGroup, onUpdate, dragProps, dragClass, inGroup, groupHidden }: Props & { layer: Layer; dragProps: object; dragClass: string; inGroup: boolean; groupHidden: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const drawings = layer.cels.filter((c) => c.drawingId).length;
  const length = layerLength(layer);
  const meta = layer.reference ? 'Reference image · not exported' : `${drawings} drawing${drawings === 1 ? '' : 's'} · ${length} frame${length === 1 ? '' : 's'}`;
  const isActive = layer.id === activeLayerId && !selectedGroupId;

  return (
    <div
      {...dragProps}
      className={`layer-row${isActive ? ' active' : ''}${layer.visible && !groupHidden ? '' : ' hidden'}${inGroup ? ' in-group' : ''}${layer.clip ? ' clipped' : ''}${dragClass}`}
      title={layer.reference ? 'A picture to trace over. Select it and use the Lasso tool to move or resize it. Drag it up or down to change the stacking order.' : 'Click to draw on this layer. Drag it up or down to change the stacking order.'}
      onClick={() => { onSelectGroup(null); onSelect(layer.id); }}
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
        <div className="layer-meta">{layer.paint ? 'Paint · ' : ''}{layer.blend && layer.blend !== 'normal' ? `${BLEND_MODES.find((m) => m.id === layer.blend)?.name} · ` : ''}{meta}</div>
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
  const ref$ = layer.reference;
  const [loads, setLoads] = useState(0);
  useEffect(() => (ref$ ? onImageLoad(() => setLoads((n) => n + 1)) : undefined), [ref$]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = ref.current!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (ref$) {
      const img = loadedImage(ref$.data);
      const k = w / project.width;
      if (img) ctx.drawImage(img, ref$.x * k, ref$.y * (h / project.height), ref$.width * k, ref$.height * (h / project.height));
    } else if (drawing && !isBlank(drawing)) {
      const pic = drawingBitmap(drawing, project.width, project.height);
      const k = w / project.width;
      const kh = h / project.height;
      if (pic) ctx.drawImage(pic.src, pic.x * k, pic.y * kh, pic.src.width * k, pic.src.height * kh);
    }
  }, [drawing, ref$, loads, project.width, project.height]);
  return <canvas ref={ref} className="layer-thumb" width={104} height={60} aria-hidden="true" />;
}

function GroupRow({ group, selected, onSelectGroup, onUpdateGroup, dragProps, dragClass }: Props & { group: LayerGroup; selected: boolean; dragProps: object; dragClass: string }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      {...dragProps}
      className={`layer-row group-row${selected ? ' active' : ''}${group.visible ? '' : ' hidden'}${dragClass}`}
      title="Click to select the group. Drag it to move all its layers."
      onClick={() => onSelectGroup(group.id)}
      aria-current={selected}
    >
      <button
        className="icon-btn sm" aria-label={group.collapsed ? `Open ${group.name}` : `Fold ${group.name}`}
        title={group.collapsed ? 'Show the layers in this group' : 'Fold the group to save space'}
        onClick={(e) => { e.stopPropagation(); onUpdateGroup(group.id, { collapsed: !group.collapsed }); }}
      >{group.collapsed ? <I.Next /> : <I.Down />}</button>
      <button
        className="icon-btn sm" aria-label={group.visible ? `Hide ${group.name}` : `Show ${group.name}`}
        title={group.visible ? 'Hide every layer in this group' : 'Show this group'}
        onClick={(e) => { e.stopPropagation(); onUpdateGroup(group.id, { visible: !group.visible }); }}
      >{group.visible ? <I.Eye /> : <I.EyeOff />}</button>
      <span className="group-icon" aria-hidden="true"><I.Folder /></span>
      <div className="layer-text">
        {renaming ? (
          <input
            className="layer-rename" type="text" defaultValue={group.name} autoFocus aria-label="Group name"
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { onUpdateGroup(group.id, { name: e.target.value.trim() || group.name }); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <div className="layer-name" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{group.name}</div>
        )}
        <div className="layer-meta">Group{group.blend && group.blend !== 'normal' ? ` · ${BLEND_MODES.find((m) => m.id === group.blend)?.name}` : ''}{group.opacity < 1 ? ` · ${Math.round(group.opacity * 100)}%` : ''}</div>
      </div>
      <button
        className="icon-btn sm" aria-label={group.locked ? `Unlock ${group.name}` : `Lock ${group.name}`}
        title={group.locked ? 'Unlock this group' : 'Lock every layer in this group'}
        style={group.locked ? { color: 'var(--accent)' } : undefined}
        onClick={(e) => { e.stopPropagation(); onUpdateGroup(group.id, { locked: !group.locked }); }}
      >{group.locked ? <I.Lock /> : <I.Unlock />}</button>
    </div>
  );
}
