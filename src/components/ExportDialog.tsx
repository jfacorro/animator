import { useEffect, useRef, useState } from 'react';
import { exportGif } from '../export/gif';
import { sceneLength, type Project } from '../model/project';
import { composeFrame } from '../render/render';
import { downloadBlob, safeFileName } from '../storage';
import * as I from './Icons';

interface Props {
  project: Project;
  onClose: () => void;
}

const SIZES = [0.5, 0.75, 1];

export function ExportDialog({ project, onClose }: Props) {
  const [scale, setScale] = useState(0.75);
  const [paper, setPaper] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const frames = sceneLength(project);
  const seconds = (frames / project.fps).toFixed(1);

  // Loop a live preview until the GIF is ready.
  useEffect(() => {
    if (result) return;
    const ctx = previewRef.current?.getContext('2d');
    if (!ctx) return;
    let f = 0;
    const id = window.setInterval(() => {
      composeFrame(ctx, project, f, { paper, includeHidden });
      f = (f + 1) % frames;
    }, 1000 / project.fps);
    return () => window.clearInterval(id);
  }, [project, paper, includeHidden, frames, result]);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    setError(null);
    setProgress(0);
    try {
      const blob = await exportGif(project, { scale, paper, includeHidden, onProgress: (d, t) => setProgress(d / t) });
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setProgress(null);
    }
  };

  const reset = () => setResult(null);
  const fileName = `${safeFileName(project.name)}.gif`;

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="dialog-head">
          <h2 id="export-title">Export animation</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><I.Close /></button>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="preview">
              {result ? <img src={result.url} alt="Exported GIF" /> : <canvas ref={previewRef} width={project.width} height={project.height} aria-label="Preview" />}
            </div>
            <span className="muted">
              {result ? `${fileName} · ${(result.blob.size / 1024).toFixed(0)} KB` : `${frames} frames at ${project.fps} fps = ${seconds} s, looping`}
            </span>
          </div>
          <div className="dialog-form">
            <div>
              <div className="muted" style={{ marginBottom: 8 }}>Format</div>
              <div className="format-grid">
                <button className="format-option on" aria-pressed="true"><strong>GIF</strong><span>for sharing</span></button>
                <button className="format-option" disabled><strong>MP4</strong><span>coming in a later phase</span></button>
              </div>
            </div>
            <label className="row">Size
              <select value={scale} onChange={(e) => { setScale(Number(e.target.value)); reset(); }}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>{Math.round(project.width * s)} × {Math.round(project.height * s)}</option>
                ))}
              </select>
            </label>
            <label className="row">Background
              <select value={paper ? 'paper' : 'transparent'} onChange={(e) => { setPaper(e.target.value === 'paper'); reset(); }}>
                <option value="paper">Paper white</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label className="row" style={{ justifyContent: 'flex-start' }}>
              <input type="checkbox" checked={includeHidden} onChange={(e) => { setIncludeHidden(e.target.checked); reset(); }} />
              Include hidden layers
            </label>
            {error && <div className="error" role="alert">{error}</div>}
          </div>
        </div>
        <div className="dialog-foot">
          {progress !== null && <div className="progress" aria-label="Export progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          <button className="btn" onClick={onClose}>Close</button>
          {result ? (
            <button className="btn primary" onClick={() => downloadBlob(result.blob, fileName)}>Download GIF</button>
          ) : (
            <button className="btn primary" disabled={progress !== null} onClick={run}>{progress !== null ? 'Exporting…' : 'Export GIF'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
