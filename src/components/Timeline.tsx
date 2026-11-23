import { useEffect, useRef, useState } from 'react';
import * as I from './Icons';
import { celIndexAt, celStart, dropIndex, dropSlot, layerLength, sceneLength, type Layer, type Project } from '../model/project';

const FW = 26; // frame width in px
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag

export type FrameAction = 'insert-left' | 'insert-right' | 'duplicate' | 'clear' | 'delete' | 'new-here';

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
  onMoveCel: (layerId: string, from: number, to: number) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<Layer, 'visible' | 'locked'>>) => void;
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
  const length = sceneLength(project);
  const columns = Math.max(length + 12, 48);
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
  };

  const onTrackPointerMove = (layer: Layer, e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId || press.layerId !== layer.id) return;
    const { x, frame: f, fraction } = locate(e, e.currentTarget);
    if (!drag && (press.cel < 0 || layer.locked || layer.cels.length < 2 || Math.abs(x - press.x) < DRAG_THRESHOLD)) return;
    setMenu(null);
    setDrag({ layerId: layer.id, from: press.cel, slot: dropSlot(layer, f, fraction), to: dropIndex(layer, press.cel, f, fraction), x });
  };

  const onTrackPointerUp = (layer: Layer, e: React.PointerEvent<HTMLDivElement>) => {
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
    pressRef.current = null;
    setDrag(null);
  };

  const onTrackContextMenu = (layer: Layer, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (playing) return;
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
        <span>{cel ? (cel.drawingId ? 'Drawing holds for' : 'Blank holds for') : 'No drawing here yet'}</span>
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
        <span className="hint">Click the selected drawing or right-click for options · drag to move</span>
        <button className="btn small" disabled={playing} onClick={props.onNewDrawing} title="New drawing (N)">+ New drawing</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDuplicate} title="Duplicate drawing (D)">Duplicate</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDelete} title="Delete drawing">Delete</button>
      </div>
      <div className="timeline-body">
        <div className="track-names" ref={namesRef}>
          {topFirst.map((l) => (
            <div
              key={l.id}
              className={`track-name${l.id === activeLayerId ? ' active' : ''}${l.visible ? '' : ' hidden'}`}
              onClick={() => props.onSelect(l.id, frame)}
              title={`${l.name}: click to draw on this layer`}
            >
              <span className="track-label">{l.name}</span>
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
          ))}
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
            <div className="ruler">
              {Array.from({ length: columns }, (_, f) => (
                <div
                  key={f}
                  className={`ruler-cell${f === frame ? ' current' : ''}${f >= length ? ' beyond' : ''}`}
                  style={{ width: FW }}
                  title={`Go to frame ${f + 1}`}
                  onClick={() => props.onSelectFrame(f)}
                >
                  {f === frame || f === 0 || (f + 1) % 4 === 0 ? f + 1 : ''}
                </div>
              ))}
            </div>
            {topFirst.map((l) => {
              const dragging = drag?.layerId === l.id ? drag : null;
              return (
                <div
                  className={`track${dragging ? ' dragging' : ''}`}
                  key={l.id}
                  title="Click to select. Click the selected drawing again or right-click for options. Drag a drawing to move it."
                  onPointerDown={(e) => onTrackPointerDown(l, e)}
                  onPointerMove={(e) => onTrackPointerMove(l, e)}
                  onPointerUp={(e) => onTrackPointerUp(l, e)}
                  onPointerCancel={onTrackPointerCancel}
                  onContextMenu={(e) => onTrackContextMenu(l, e)}
                >
                  <div className="track-grid" aria-hidden="true">
                    {Array.from({ length: columns }, (_, f) => <div key={f} style={{ width: FW }} />)}
                  </div>
                  {l.cels.map((c, i) => {
                    const start = celStart(l, i);
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
            <button role="menuitem" disabled={menuLayer.locked} onClick={() => act('new-here')}>New drawing here</button>
          ) : (
            <>
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
