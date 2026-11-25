import { useEffect, useRef, useState } from 'react';
import { exportGif } from '../export/gif';
import { canExportMp4, exportMp4, exportPngSequence } from '../export/video';
import { sceneLength, type Project } from '../model/project';
import { composeFrame, paintReady } from '../render/render';
import { downloadBlob, safeFileName } from '../storage';
import * as I from './Icons';

interface Props {
  project: Project;
  onClose: () => void;
}

const SIZES = [0.5, 0.75, 1, 1.5, 2];

type Format = 'gif' | 'mp4' | 'png';
const FORMATS: { id: Format; name: string; note: string; help: string }[] = [
  { id: 'gif', name: 'GIF', note: 'for sharing', help: 'Animated GIF: plays anywhere, loops, no sound' },
  { id: 'mp4', name: 'MP4', note: 'video with sound', help: 'MP4 video: small, sharp, and includes the sound track' },
  { id: 'png', name: 'PNG', note: 'image sequence', help: 'One PNG image per frame, in a zip file: for video editors and compositing' },
];
const EXT: Record<Format, string> = { gif: 'gif', mp4: 'mp4', png: 'zip' };

/** The export as a file for the share sheet (iPad: Photos, Files, Messages…), or null where sharing files isn't supported. */
function shareFile(blob: Blob, name: string): File | null {
  if (typeof navigator.canShare !== 'function') return null;
  const file = new File([blob], name, { type: blob.type });
  return navigator.canShare({ files: [file] }) ? file : null;
}

export function ExportDialog({ project, onClose }: Props) {
  const [format, setFormat] = useState<Format>('gif');
  const [scale, setScale] = useState(0.75);
  const [sound, setSound] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const mp4 = canExportMp4();
  const [paper, setPaper] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const frames = sceneLength(project);
  const seconds = (frames / project.fps).toFixed(1);

  // Loop a live preview until the export is ready (a PNG sequence keeps previewing).
  useEffect(() => {
    if (result && format !== 'png') return;
    const ctx = previewRef.current?.getContext('2d');
    if (!ctx) return;
    let f = 0;
    const id = window.setInterval(() => {
      composeFrame(ctx, project, f, { paper: paper || format === 'mp4', includeHidden, camera: true });
      f = (f + 1) % frames;
    }, 1000 / project.fps);
    return () => window.clearInterval(id);
  }, [project, paper, includeHidden, frames, result, format]);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    setError(null);
    setNote(null);
    setProgress(0);
    const onProgress = (d: number, t: number) => setProgress(d / t);
    try {
      // Paint layers' pixels must be decoded before frames are drawn.
      await paintReady(project);
      let blob: Blob;
      if (format === 'mp4') {
        const r = await exportMp4(project, { scale, includeHidden, sound, onProgress });
        blob = r.blob;
        if (r.soundNote) setNote(r.soundNote);
      } else if (format === 'png') {
        blob = await exportPngSequence(project, safeFileName(project.name), { scale, paper, includeHidden, onProgress });
      } else {
        blob = await exportGif(project, { scale, paper, includeHidden, onProgress });
      }
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setProgress(null);
    }
  };

  const reset = () => setResult(null);
  const fileName = `${safeFileName(project.name)}.${EXT[format]}`;
  const what = format === 'mp4' ? 'video' : format === 'png' ? 'images' : 'GIF';
  const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="dialog-head">
          <h2 id="export-title">Export animation</h2>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><I.Close /></button>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="preview">
              {result && format === 'gif' ? <img src={result.url} alt="Exported GIF" />
                : result && format === 'mp4' ? <video src={result.url} controls autoPlay loop aria-label="Exported video" />
                : <canvas ref={previewRef} width={project.width} height={project.height} aria-label="Preview" />}
            </div>
            <span className="muted">
              {result
                ? `${fileName} · ${size(result.blob.size)}${format === 'png' ? ` · ${frames} PNG images` : ''}`
                : `${frames} frames at ${project.fps} fps = ${seconds} s${format === 'gif' ? ', looping' : ''}`}
            </span>
          </div>
          <div className="dialog-form">
            <div>
              <div className="muted" style={{ marginBottom: 8 }}>Format</div>
              <div className="format-grid">
                {FORMATS.map((f) => {
                  const off = f.id === 'mp4' && !mp4;
                  return (
                    <button
                      key={f.id} className={`format-option${format === f.id ? ' on' : ''}`} aria-pressed={format === f.id} disabled={off || progress !== null}
                      title={off ? 'This browser can’t make videos. Chrome, Edge and Safari can.' : f.help}
                      onClick={() => { setFormat(f.id); reset(); }}
                    ><strong>{f.name}</strong><span>{off ? 'needs Chrome or Edge' : f.note}</span></button>
                  );
                })}
              </div>
            </div>
            <label className="row" title="Width × height in pixels. Smaller files load faster; bigger ones stay sharp on large screens.">Size
              <select value={scale} onChange={(e) => { setScale(Number(e.target.value)); reset(); }}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>{Math.round(project.width * s)} × {Math.round(project.height * s)}</option>
                ))}
              </select>
            </label>
            {format !== 'mp4' && <label className="row" title="Paper white fills the background. Transparent lets the pictures sit on any colour.">Background
              <select value={paper ? 'paper' : 'transparent'} onChange={(e) => { setPaper(e.target.value === 'paper'); reset(); }}>
                <option value="paper">Paper white</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>}
            {format === 'mp4' && project.audio && (
              <label className="row" style={{ justifyContent: 'flex-start' }} title="Put the sound track in the video">
                <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); reset(); }} />
                Include sound ({project.audio.name})
              </label>
            )}
            <label className="row" style={{ justifyContent: 'flex-start' }} title="Also export layers you have hidden with the eye icon">
              <input type="checkbox" checked={includeHidden} onChange={(e) => { setIncludeHidden(e.target.checked); reset(); }} />
              Include hidden layers
            </label>
            {error && <div className="error" role="alert">{error}</div>}
            {note && <div className="muted" role="status">{note}</div>}
          </div>
        </div>
        <div className="dialog-foot">
          {progress !== null && <div className="progress" aria-label="Export progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          <button className="btn" title="Close (Esc)" onClick={onClose}>Close</button>
          {result && shareFile(result.blob, fileName) && (
            <button className="btn" title={`Send the ${what} to another app, or save it to Photos or Files`} onClick={() => {
              navigator.share({ files: [shareFile(result.blob, fileName)!], title: project.name }).catch(() => { /* closed the share sheet */ });
            }}>Share…</button>
          )}
          {result ? (
            <button className="btn primary" title={`Save the ${what} to your computer`} onClick={() => downloadBlob(result.blob, fileName)}>Download {format === 'png' ? 'zip' : format.toUpperCase()}</button>
          ) : (
            <button className="btn primary" disabled={progress !== null} title={`Create the ${what} with these settings`} onClick={run}>{progress !== null ? 'Exporting…' : `Export ${format === 'png' ? 'PNGs' : format.toUpperCase()}`}</button>
          )}
        </div>
      </div>
    </div>
  );
}
