import { useEffect, useRef } from 'react';
import { celIndexAt, celStart, sceneLength, type Project } from '../model/project';

const FW = 26; // frame width in px

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
}

export function Timeline(props: Props) {
  const { project, frame, activeLayerId, playing } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const namesRef = useRef<HTMLDivElement>(null);
  const length = sceneLength(project);
  const columns = Math.max(length + 12, 48);
  const topFirst = [...project.layers].reverse();
  const active = project.layers.find((l) => l.id === activeLayerId);
  const celIndex = active ? celIndexAt(active, frame) : -1;
  const cel = active && celIndex >= 0 ? active.cels[celIndex] : null;

  // Keep the playhead in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = frame * FW;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [frame]);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <span className="panel-title" style={{ color: 'var(--text)' }}>Timeline</span>
        <span>{cel ? (cel.drawingId ? 'Drawing holds for' : 'Blank holds for') : 'No drawing here yet'}</span>
        <div className="group">
          {[1, 2, 3, 4].map((h) => (
            <button key={h} className={`btn small${cel?.hold === h ? ' on' : ''}`} disabled={!cel || playing} onClick={() => props.onHold(h)}>
              {h} {h === 1 ? 'frame' : 'frames'}
            </button>
          ))}
          <button className="btn small" disabled={!cel || playing} onClick={() => props.onHold((cel?.hold ?? 1) + 1)} aria-label="Hold one frame longer" title="Hold one frame longer">+1</button>
          <button className="btn small" disabled={!active?.cels.length || playing} onClick={props.onHoldToEnd} title="Hold this drawing until the end of the scene">To end</button>
        </div>
        <div className="spacer" />
        <button className="btn small" disabled={playing} onClick={props.onNewDrawing} title="New drawing (N)">+ New drawing</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDuplicate} title="Duplicate drawing (D)">Duplicate</button>
        <button className="btn small" disabled={!cel || playing} onClick={props.onDelete} title="Delete drawing">Delete</button>
      </div>
      <div className="timeline-body">
        <div className="track-names" ref={namesRef}>
          {topFirst.map((l) => (
            <div
              key={l.id}
              className={`track-name${l.id === activeLayerId ? ' active' : ''}`}
              onClick={() => props.onSelect(l.id, frame)}
              title={l.name}
            >
              {l.name}
            </div>
          ))}
        </div>
        <div
          className="track-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            if (namesRef.current) namesRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          <div style={{ width: columns * FW, position: 'relative', minHeight: '100%' }}>
            <div className="ruler">
              {Array.from({ length: columns }, (_, f) => (
                <div
                  key={f}
                  className={`ruler-cell${f === frame ? ' current' : ''}${f >= length ? ' beyond' : ''}`}
                  style={{ width: FW }}
                  onClick={() => props.onSelectFrame(f)}
                >
                  {f === frame || f === 0 || (f + 1) % 4 === 0 ? f + 1 : ''}
                </div>
              ))}
            </div>
            {topFirst.map((l) => (
              <div className="track" key={l.id}>
                <div className="track-grid">
                  {Array.from({ length: columns }, (_, f) => (
                    <div key={f} style={{ width: FW }} onClick={() => props.onSelect(l.id, f)} />
                  ))}
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
                  ].filter(Boolean).join(' ');
                  return <div key={i} className={cls} style={{ left: start * FW + 1, width: c.hold * FW - 2 }}><i /></div>;
                })}
              </div>
            ))}
            <div className="scene-end" style={{ left: length * FW }} />
            <div className="playhead" style={{ left: frame * FW + FW / 2 - 1 }} />
          </div>
        </div>
      </div>
    </section>
  );
}
