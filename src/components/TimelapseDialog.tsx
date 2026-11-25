import { useEffect, useRef, useState } from 'react';
import { canExportMp4, encodeVideo } from '../export/video';
import type { Project } from '../model/project';
import { downloadBlob, safeFileName } from '../storage';
import { clearTimelapse, shotSize, timelapseShots } from '../timelapse';
import * as I from './Icons';

interface Props {
  project: Project;
  onClose: () => void;
}

const SPEEDS = [10, 20, 30, 60];

/** Replay how the drawing came together, from the pictures taken after each change. */
export function TimelapseDialog({ project, onClose }: Props) {
  const [shots, setShots] = useState<Blob[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(20);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { w, h } = shotSize(project);

  useEffect(() => { timelapseShots(project.id).then((s) => setShots([...s])); }, [project.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Show the picture at `index`.
  useEffect(() => {
    const blob = shots?.[index];
    const c = canvas.current;
    if (!blob || !c) return;
    let gone = false;
    createImageBitmap(blob).then((bmp) => {
      if (gone) return;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
    }).catch(() => undefined);
    return () => { gone = true; };
  }, [shots, index]);

  // Play: step through, then hold the finished drawing for a moment and start again.
  useEffect(() => {
    if (!playing || !shots?.length) return;
    const atEnd = index >= shots.length - 1;
    const t = window.setTimeout(() => setIndex((i) => (i >= shots.length - 1 ? 0 : i + 1)), atEnd ? 1500 : 1000 / fps);
    return () => window.clearTimeout(t);
  }, [playing, shots, index, fps]);

  const exportVideo = async () => {
    if (!shots?.length) return;
    setError(null);
    setPlaying(false);
    setProgress(0);
    try {
      // The finished drawing stays on screen for a second and a half at the end.
      const hold = Math.round(fps * 1.5);
      const blob = await encodeVideo(shots.length + hold, w, h, fps, (i) => createImageBitmap(shots[Math.min(i, shots.length - 1)]), (d, t) => setProgress(d / t));
      downloadBlob(blob, `${safeFileName(project.name)} timelapse.mp4`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The video could not be made');
    } finally {
      setProgress(null);
    }
  };

  const clear = async () => {
    if (!window.confirm('Delete the timelapse recorded for this animation? Recording starts again from now.')) return;
    await clearTimelapse(project.id);
    setShots([]);
    setIndex(0);
  };

  const count = shots?.length ?? 0;
  const seconds = (count / fps).toFixed(1);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Timelapse">
        <div className="dialog-head">
          <h2>Timelapse</h2>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><I.Close /></button>
        </div>
        <div className="timelapse-body">
          {shots === null ? <p className="muted">Loading…</p> : count === 0 ? (
            <p className="muted">Nothing recorded yet. From now on, the frame you work on is pictured after each change, here in this browser. Draw a while and come back.</p>
          ) : (
            <>
              <div className="preview"><canvas ref={canvas} width={w} height={h} aria-label="Timelapse replay" /></div>
              <div className="timelapse-controls">
                <button className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>{playing ? <I.Pause /> : <I.Play />}</button>
                <input type="range" min={0} max={count - 1} value={index} aria-label="Position" onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
                <span className="value">{index + 1} / {count}</span>
                <select value={fps} aria-label="Speed" onChange={(e) => setFps(Number(e.target.value))}>
                  {SPEEDS.map((s) => <option key={s} value={s}>{s} per second</option>)}
                </select>
              </div>
              <span className="muted">{count} pictures, {seconds} s at this speed. Recorded in this browser for this animation.</span>
            </>
          )}
          {error && <div className="error" role="alert">{error}</div>}
        </div>
        <div className="dialog-foot">
          {progress !== null && <div className="progress" aria-label="Export progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          {count > 0 && <button className="btn" title="Delete the recording and start again" onClick={clear}>Clear</button>}
          <button className="btn" onClick={onClose}>Close</button>
          {count > 0 && (
            <button className="btn primary" disabled={!canExportMp4() || progress !== null} title={canExportMp4() ? 'Save the timelapse as an MP4 video' : 'Making videos needs Chrome, Edge or a recent Safari'} onClick={exportVideo}>
              {progress !== null ? 'Exporting…' : 'Export MP4'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
