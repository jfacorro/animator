import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { sceneLength, type Project } from '../model/project';
import { composeFrame } from '../render/render';
import { playOrder } from '../model/playback';

export interface GifOptions {
  scale: number;
  paper: boolean;
  includeHidden: boolean;
  /** Play forwards then backwards (ping-pong) before looping. */
  pingPong?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Encode the scene as an animated GIF in the browser. Runs of identical
 * frames (held drawings) become one GIF frame with a longer delay.
 */
export async function exportGif(project: Project, opts: GifOptions): Promise<Blob> {
  const w = Math.round(project.width * opts.scale);
  const h = Math.round(project.height * opts.scale);
  const full = document.createElement('canvas');
  full.width = project.width;
  full.height = project.height;
  const fctx = full.getContext('2d')!;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true })!;

  const order = playOrder(sceneLength(project), opts.pingPong ? 'pingpong' : 'loop');
  const total = order.length;
  const frames: { data: Uint8ClampedArray; frames: number }[] = [];
  const drawn = new Map<number, Uint8ClampedArray>();
  for (let k = 0; k < total; k++) {
    const f = order[k];
    let data = drawn.get(f);
    if (!data) {
      composeFrame(fctx, project, f, { paper: opts.paper, includeHidden: opts.includeHidden, camera: true });
      octx.clearRect(0, 0, w, h);
      octx.drawImage(full, 0, 0, w, h);
      data = octx.getImageData(0, 0, w, h).data;
      drawn.set(f, data);
    }
    const prev = frames.at(-1);
    if (prev && sameImage(prev.data, data)) prev.frames += 1;
    else frames.push({ data, frames: 1 });
    opts.onProgress?.(k + 1, total * 2);
    if (k % 4 === 3) await nextTick();
  }

  const gif = GIFEncoder();
  const frameMs = 1000 / project.fps;
  for (let i = 0; i < frames.length; i++) {
    const { data, frames: count } = frames[i];
    const transparent = !opts.paper;
    const palette = quantize(data, 256, transparent ? { format: 'rgba4444', oneBitAlpha: true } : {});
    const index = applyPalette(data, palette, transparent ? 'rgba4444' : 'rgb565');
    const transparentIndex = transparent ? Math.max(0, palette.findIndex((c) => c[3] === 0)) : 0;
    gif.writeFrame(index, w, h, { palette, delay: Math.round(frameMs * count), transparent, transparentIndex, repeat: 0 });
    opts.onProgress?.(total + Math.round(((i + 1) / frames.length) * total), total * 2);
    await nextTick();
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

function sameImage(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) return false;
  return true;
}

function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
