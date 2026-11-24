import { memo, useEffect, useRef, useState } from 'react';
import { useLongPress } from './longPress';
import * as I from './Icons';
import { layerDrops, useLayerDrag } from './useLayerDrag';
import { groupOf } from '../model/groups';
import { peaks, useAudioBuffer } from '../audio';
import type { AudioTrack } from '../model/project';
import { celIndexAt, celStart, dropIndex, dropSlot, layerLength, sceneLength, type Layer, type Project } from '../model/project';

const FW = 26; // frame width in px

/** The frame under a click, from its position along the row. */
const frameOfClick = (e: React.MouseEvent<HTMLElement>) => Math.max(0, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / FW));
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag

export type FrameAction = 'insert-left' | 'insert-right' | 'duplicate' | 'clear' | 'delete' | 'new-here' | 'copy' | 'paste';

interface Props {
  project: Project;
  frame: number;
  activeLayerId: string;
  playing: boolean;
  onSelect: (layerId: string, frame: number) => void;
  onSelectFrame: (frame: number) => void;
  onHold: (hold: number) => void;
  onHoldToEnd: () => void;
  onNewDrawing: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFrameAction: (action: FrameAction, layerId: string, frame: number) => void;
  /** Something has been copied and can be pasted. */
  canPaste: boolean;
  /** Show the camera row (camera tool on, or the camera has keys). */
  showCamera: boolean;
  /** Hear a frame of sound when stepping through frames. */
  scrub: boolean;
  onScrubChange: (scrub: boolean) => void;
  onAudioChange: (patch: Partial<AudioTrack>, record?: boolean) => void;
  onRemoveAudio: () => void;
  onAddAudio: () => void;
  onRemoveCameraKey: (frame: number) => void;
  onMoveCel: (layerId: string, from: number, to: number) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked'>>) => void;
  /** Drag a layer into a gap in the stack, counted bottom to top. */
  onMoveLayerTo: (layerId: string, gap: number, group: string | null) => void;
}

interface Press {
  pointerId: number;
  layerId: string;
  frame: number;
  cel: number;
  x: number;
  wasCurrent: boolean;
}

interface Drag {
  layerId: string;
  from: number;
  /** Gap the cel would drop into (see dropSlot), and where it would land. */
  slot: number;
  to: number;
  /** Pointer position over the track, for the floating cel. */
  x: number;
}

interface Menu {
  layerId: string;
  frame: number;
  x: number;
  y: number;
}

export function Timeline(props: Props) {
  const { project, frame, activeLayerId, playing } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const namesRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const hold = useLongPress();
  const [renaming, setRenaming] = useState<string | null>(null);
  const layerDrag = useLayerDrag((id, _kind, drop) => props.onMoveLayerTo(id, drop.gap, drop.group));
  const length = sceneLength(project);
  const audio = project.audio ?? null;
  const audioBuffer = useAudioBuffer(audio);
  const audioFrames = audioBuffer ? Math.ceil(audioBuffer.duration * project.fps) : 0;
  const columns = Math.max(length + 12, 48, audio ? audio.start + audioFrames + 4 : 0);
  const topFirst = [...project.layers].reverse();
  const active = project.layers.find((l) => l.id === activeLayerId);
  const celIndex = active ? celIndexAt(active, frame) : -1;
  const cel = active && celIndex >= 0 ? active.cels[celIndex] : null;

  // Keep the playhead in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || drag) return;
    const x = frame * FW;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [frame, drag]);

  // Close the frame menu on outside clicks, Escape, scrolling or playback.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.frame-menu')) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  useEffect(() => { if (playing) setMenu(null); }, [playing]);

  const locate = (e: React.PointerEvent | React.MouseEvent, el: HTMLElement) => {
    const x = e.clientX - el.getBoundingClientRect().left;
    const f = Math.floor(x / FW);
    return { x, frame: Math.max(0, f), fraction: Math.min(1, Math.max(0, x / FW - f)) };
  };

  const openMenu = (layerId: string, f: number, clientX: number, clientY: number) => {
    const w = 220, h = 250;
    setMenu({
      layerId,
      frame: f,
      x: Math.min(clientX, window.innerWidth - w - 8),
      y: clientY + h > window.innerHeight ? Math.max(8, clientY - h) : clientY,
    });
  };

  const onTrackPointerDown = (layer: Layer, e: React.PointerEvent<HTMLDivElement>) => {
    if (playing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const { x, frame: f } = locate(e, e.currentTarget);
    const i = celIndexAt(layer, f);
    pressRef.current = {
      pointerId: e.pointerId,
      layerId: layer.id,
      frame: f,
      cel: i,
      x,
      wasCurrent: layer.id === activeLayerId && i >= 0 && i === celIndexAt(layer, frame),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    // Press and hold (finger or pencil) opens the frame menu, like a right-click.
    const id = e.pointerId;
    hold.start(e, (cx, cy) => {
      if (pressRef.current?.pointerId !== id) return;
      pressRef.current = null;
      props.onSelect(layer.id, f);
      openMenu(layer.id, f, cx, cy);
    });
  };

  const onTrackPointerMove = (layer: Layer, e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId || press.layerId !== layer.id) return;
    hold.move(e);
    const { x, frame: f, fraction } = locate(e, e.currentTarget);
    if (!drag && (press.cel < 0 || layer.locked || layer.cels.length < 2 || Math.abs(x - press.x) < DRAG_THRESHOLD)) return;
    hold.cancel();
    setMenu(null);
    setDrag({ layerId: layer.id, from: press.cel, slot: dropSlot(layer, f, fraction), to: dropIndex(layer, press.cel, f, fraction), x });
  };

  const onTrackPointerUp = (layer: Layer, e: React.PointerEvent<HTMLDivElement>) => {
    hold.cancel();
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    pressRef.current = null;
    if (drag) {
      setDrag(null);
      if (drag.to !== drag.from) props.onMoveCel(layer.id, drag.from, drag.to);
      return;
    }
    // A second click on the selected drawing opens its menu; otherwise select.
    if (press.wasCurrent) openMenu(layer.id, press.frame, e.clientX, e.clientY);
    else props.onSelect(layer.id, press.frame);
  };

  const onTrackPointerCancel = () => {
    hold.cancel();
    pressRef.current = null;
    setDrag(null);
  };

  const onTrackContextMenu = (layer: Layer, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // A long press already opened the menu (some browsers also send a context menu).
    if (playing || hold.justFired()) return;
    const { frame: f } = locate(e, e.currentTarget);
    props.onSelect(layer.id, f);
    openMenu(layer.id, f, e.clientX, e.clientY);
  };

  const menuLayer = menu ? project.layers.find((l) => l.id === menu.layerId) : undefined;
  const menuCel = menuLayer && menu ? celIndexAt(menuLayer, menu.frame) : -1;
  const menuDrawing = menuLayer && menuCel >= 0 && menuLayer.cels[menuCel].drawingId ? project.drawings[menuLayer.cels[menuCel].drawingId!] : null;
  const act = (action: FrameAction) => {
    if (!menu) return;
    props.onFrameAction(action, menu.layerId, menu.frame);
    setMenu(null);
  };

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <span className="panel-title" style={{ color: 'var(--text)' }}>Timeline</span>
        <span>{active?.reference ? 'Reference image: shows on every frame' : cel ? (cel.drawingId ? 'Drawing holds for' : 'Blank holds for') : 'No drawing here yet'}</span>
        <div className="group">
          {[1, 2, 3, 4].map((h) => (
            <button key={h} className={`btn small${cel?.hold === h ? ' on' : ''}`} title={`Show the selected drawing for ${h} frame${h === 1 ? '' : 's'}${h === 2 ? ' ("on twos")' : ''}`} disabled={!cel || playing} onClick={() => props.onHold(h)}>
              {h} {h === 1 ? 'frame' : 'frames'}
            </button>
          ))}
          <button className="btn small" disabled={!cel || playing} onClick={() => props.onHold((cel?.hold ?? 1) + 1)} aria-label="Hold one frame longer" title="Hold one frame longer">+1</button>
          <button className="btn small" disabled={!active?.cels.length || playing} onClick={props.onHoldToEnd} title="Hold this drawing until the end of the scene">To end</button>
        </div>
        <div className="spacer" />
        {audio && (
          <label className="hint" title="Play a frame's worth of the sound each time you step to a frame, to find where words and beats fall">
            <input type="checkbox" checked={props.scrub} onChange={(e) => props.onScrubChange(e.target.checked)} /> Scrub sound
          </label>
        )}
        {!audio && !props.showCamera && <span className="hint">Click the selected drawing or right-click for options · drag to move</span>}
        <button className="btn small" disabled={playing} onClick={props.onNewDrawing} title="New drawing (N)">+ New drawing</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDuplicate} title="Duplicate drawing (D)">Duplicate</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDelete} title="Delete drawing">Delete</button>
      </div>
      <div className="timeline-body">
        <div className="track-names" ref={namesRef}>
          {props.showCamera && (
            <div className="track-name special" title="Camera keys: the camera glides from one key to the next when you play. Use the camera tool (K) to set them.">
              <span className="track-label"><I.Camera /> Camera</span>
            </div>
          )}
          {audio && (
            <div className="track-name special" title={`Sound: ${audio.name}. Drag the waveform sideways to change where it starts.`}>
              <span className="track-label"><I.Sound /> {audio.name}</span>
              <button
                className={`icon-btn xs${audio.volume === 0 ? ' locked' : ''}`} aria-label={audio.volume === 0 ? 'Unmute sound' : 'Mute sound'}
                title={audio.volume === 0 ? 'Turn the sound back on' : 'Mute the sound'}
                onClick={() => props.onAudioChange({ volume: audio.volume === 0 ? 1 : 0 })}
              >{audio.volume === 0 ? <I.Mute /> : <I.Sound />}</button>
              <button className="icon-btn xs" aria-label="Remove sound" title="Remove the sound from this animation" onClick={props.onRemoveAudio}><I.Trash /></button>
            </div>
          )}
          {topFirst.map((l) => {
            const index = project.layers.indexOf(l);
            const g = groupOf(project, l);
            const d = layerDrops(index, l.groupId);
            return (
            <div
              key={l.id}
              {...layerDrag.rowProps(l.id, l.id, 'layer', d.above, d.below)}
              className={`track-name${l.id === activeLayerId ? ' active' : ''}${l.visible && (g?.visible ?? true) ? '' : ' hidden'}${g ? ' in-group' : ''}${layerDrag.rowClass(l.id)}`}
              onClick={() => props.onSelect(l.id, frame)}
              title={`${l.name}: click to draw on this layer, double-click to rename, drag up or down to reorder`}
            >
              {renaming === l.id ? (
                <input
                  className="track-rename" type="text" defaultValue={l.name} autoFocus aria-label="Layer name"
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => { props.onUpdateLayer(l.id, { name: e.target.value.trim() || l.name }); setRenaming(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="track-label" title={g ? `In ${g.name}` : undefined} onDoubleClick={(e) => { e.stopPropagation(); setRenaming(l.id); }}>{l.clip && <span className="clip-mark" aria-label="clipped">↳</span>}{l.name}</span>
              )}
              <button
                className="icon-btn xs" aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                title={l.visible ? 'Hide this layer' : 'Show this layer'}
                onClick={(e) => { e.stopPropagation(); props.onUpdateLayer(l.id, { visible: !l.visible }); }}
              >
                {l.visible ? <I.Eye /> : <I.EyeOff />}
              </button>
              <button
                className={`icon-btn xs${l.locked ? ' locked' : ''}`} aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}
                title={l.locked ? 'Unlock this layer' : 'Lock this layer so it can\'t be drawn on or edited'}
                onClick={(e) => { e.stopPropagation(); props.onUpdateLayer(l.id, { locked: !l.locked }); }}
              >
                {l.locked ? <I.Lock /> : <I.Unlock />}
              </button>
            </div>
            );
          })}
        </div>
        <div
          className="track-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            if (namesRef.current) namesRef.current.scrollTop = e.currentTarget.scrollTop;
            setMenu(null);
          }}
        >
          <div style={{ width: columns * FW, position: 'relative', minHeight: '100%' }}>
            <RulerRow columns={columns} frame={frame} length={length} onSelectFrame={props.onSelectFrame} />
            {props.showCamera && (
              <div className="track special-track" title="Camera keys. Click a frame to go to it.">
                <div className="track-grid" aria-hidden="true" onClick={(e) => props.onSelectFrame(frameOfClick(e))} />
                {(project.camera ?? []).map((k) => (
                  <button
                    key={k.frame} className={`camera-key${k.frame === frame ? ' current' : ''}`} style={{ left: k.frame * FW + FW / 2 - 7 }}
                    aria-label={`Camera key at frame ${k.frame + 1}`}
                    title={`Camera key at frame ${k.frame + 1}. Click to go to it; right-click, double-click or press and hold to remove it.`}
                    {...hold.bind(() => props.onRemoveCameraKey(k.frame))}
                    onClick={() => props.onSelectFrame(k.frame)}
                    onDoubleClick={() => props.onRemoveCameraKey(k.frame)}
                    onContextMenu={(e) => { e.preventDefault(); props.onRemoveCameraKey(k.frame); }}
                  ><I.Diamond /></button>
                ))}
              </div>
            )}
            {audio && (
              <AudioTrackRow audio={audio} buffer={audioBuffer} frames={audioFrames} columns={columns} onSelectFrame={props.onSelectFrame} onChange={props.onAudioChange} />
            )}
            {topFirst.map((l) => {
              const dragging = drag?.layerId === l.id ? drag : null;
              // Each cel's first frame, as a running sum (celStart per cel would be quadratic on long layers).
              let acc = 0;
              const starts = l.cels.map((c) => { const at = acc; acc += c.hold; return at; });
              return (
                <div
                  className={`track${dragging ? ' dragging' : ''}`}
                  key={l.id}
                  title="Click to select. Click the selected drawing again, right-click or press and hold for options. Drag a drawing to move it."
                  onPointerDown={(e) => onTrackPointerDown(l, e)}
                  onPointerMove={(e) => onTrackPointerMove(l, e)}
                  onPointerUp={(e) => onTrackPointerUp(l, e)}
                  onPointerCancel={onTrackPointerCancel}
                  onContextMenu={(e) => onTrackContextMenu(l, e)}
                >
                  <div className="track-grid" aria-hidden="true" />
                  {l.cels.map((c, i) => {
                    const start = starts[i];
                    const d = c.drawingId ? project.drawings[c.drawingId] : null;
                    const current = l.id === activeLayerId && i === celIndex;
                    const cls = [
                      'cel',
                      !c.drawingId ? 'blank' : '',
                      d && !d.strokes.length ? 'empty' : '',
                      current ? 'current' : '',
                      l.visible ? '' : 'dimmed',
                      dragging?.from === i ? 'lifted' : '',
                    ].filter(Boolean).join(' ');
                    return <div key={i} className={cls} style={{ left: start * FW + 1, width: c.hold * FW - 2 }}><i /></div>;
                  })}
                  {dragging && (
                    <>
                      <div
                        className="drop-marker"
                        style={{ left: (dragging.slot >= l.cels.length ? layerLength(l) : celStart(l, dragging.slot)) * FW - 1 }}
                      />
                      <div
                        className="cel floating"
                        style={{ left: dragging.x - (l.cels[dragging.from].hold * FW) / 2, width: l.cels[dragging.from].hold * FW - 2 }}
                      ><i /></div>
                    </>
                  )}
                </div>
              );
            })}
            <div className="scene-end" style={{ left: length * FW }} />
            <div className="playhead" style={{ left: frame * FW + FW / 2 - 1 }} />
          </div>
        </div>
      </div>

      {menu && menuLayer && (
        <div className="frame-menu" role="menu" aria-label="Frame" style={{ left: menu.x, top: menu.y }}>
          <div className="frame-menu-title">{menuLayer.name} · frame {menu.frame + 1}</div>
          {menuCel < 0 ? (
            <>
              <button role="menuitem" disabled={menuLayer.locked} onClick={() => act('new-here')}>New drawing here</button>
              <button role="menuitem" disabled={menuLayer.locked || !props.canPaste} title="Paste what you copied into a new drawing here" onClick={() => act('paste')}>Paste here</button>
            </>
          ) : (
            <>
              <button role="menuitem" disabled={!menuDrawing?.strokes.length} title="Copy this drawing to paste it on another frame or layer (Ctrl+C)" onClick={() => act('copy')}>Copy drawing</button>
              <button role="menuitem" disabled={menuLayer.locked || !props.canPaste} title="Paste what you copied on top of this drawing (Ctrl+V)" onClick={() => act('paste')}>Paste into drawing</button>
              <div className="frame-menu-sep" />
              <button role="menuitem" disabled={menuLayer.locked} onClick={() => act('insert-left')}>Insert drawing to the left</button>
              <button role="menuitem" disabled={menuLayer.locked} onClick={() => act('insert-right')}>Insert drawing to the right</button>
              <button role="menuitem" disabled={menuLayer.locked} onClick={() => act('duplicate')}>Duplicate</button>
              <div className="frame-menu-sep" />
              <button role="menuitem" disabled={menuLayer.locked || !menuDrawing?.strokes.length} onClick={() => act('clear')}>Clear drawing</button>
              <button role="menuitem" className="danger" disabled={menuLayer.locked} onClick={() => act('delete')}>Delete drawing</button>
            </>
          )}
          {menuLayer.locked && <div className="frame-menu-note">This layer is locked</div>}
        </div>
      )}
    </section>
  );
}

function AudioTrackRow({ audio, buffer, frames, onSelectFrame, onChange }: {
  audio: AudioTrack;
  buffer: AudioBuffer | null;
  frames: number;
  columns: number;
  onSelectFrame: (frame: number) => void;
  onChange: (patch: Partial<AudioTrack>, record?: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const press = useRef<{ pointerId: number; x: number; start: number; moved: boolean } | null>(null);
  const width = Math.max(1, frames * FW);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !buffer) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.min(32000, Math.round(width * dpr));
    c.height = Math.round(26 * dpr);
    const ctx = c.getContext('2d')!;
    const bars = Math.max(1, Math.floor(width / 2));
    const p = peaks(buffer, bars);
    const mid = c.height / 2;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = audio.volume === 0 ? '#6b6f78' : '#6faf6a';
    const bw = c.width / bars;
    for (let i = 0; i < bars; i++) {
      const hgt = Math.max(1, p[i] * (c.height - 2));
      ctx.fillRect(i * bw, mid - hgt / 2, Math.max(1, bw - dpr * 0.5), hgt);
    }
  }, [buffer, width, audio.volume]);

  const frameAt = (e: React.PointerEvent<HTMLElement>, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.floor((e.clientX - r.left) / FW));
  };

  return (
    <div className="track special-track audio-track">
      <div className="track-grid" aria-hidden="true" onClick={(e) => onSelectFrame(frameOfClick(e))} />
      <div
        className="waveform"
        style={{ left: audio.start * FW, width }}
        title="Drag sideways to change where the sound starts. Click to go to that frame."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { pointerId: e.pointerId, x: e.clientX, start: audio.start, moved: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || p.pointerId !== e.pointerId) return;
          const shift = Math.round((e.clientX - p.x) / FW);
          if (!p.moved && Math.abs(e.clientX - p.x) < 4) return;
          p.moved = true;
          const start = Math.max(0, p.start + shift);
          if (start !== audio.start) onChange({ start }, false);
        }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          if (!p) return;
          if (p.moved) onChange({ start: audio.start }, true);
          else onSelectFrame(audio.start + frameAt(e, e.currentTarget));
        }}
        onPointerCancel={() => { press.current = null; }}
      >
        {buffer ? <canvas ref={canvasRef} style={{ width, height: 26 }} /> : <span className="waveform-loading">Loading sound…</span>}
      </div>
    </div>
  );
}

/** Frame numbers along the top. Only the labels are elements; the tick lines are a background. */
const RulerRow = memo(function RulerRow({ columns, frame, length, onSelectFrame }: { columns: number; frame: number; length: number; onSelectFrame: (f: number) => void }) {
  const labels: number[] = [0];
  for (let f = 3; f < columns; f += 4) labels.push(f);
  if (!labels.includes(frame)) labels.push(frame);
  return (
    <div className="ruler" style={{ width: columns * FW }} title="Click a frame number to go there" onClick={(e) => onSelectFrame(frameOfClick(e))}>
      {labels.map((f) => (
        <span key={f} className={`ruler-label${f === frame ? ' current' : ''}${f >= length ? ' beyond' : ''}`} style={{ left: f * FW, width: FW }}>{f + 1}</span>
      ))}
    </div>
  );
});
