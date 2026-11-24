// MP4 video and PNG image-sequence export, made in the browser.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { zipSync } from 'fflate';
import { decodeAudio } from '../audio';
import { sceneLength, type Project } from '../model/project';
import { composeFrame } from '../render/render';

export interface FrameOptions {
  scale: number;
  includeHidden: boolean;
  onProgress?: (done: number, total: number) => void;
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));
/** Video sizes must be even. */
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Draws each frame of the scene at export size. */
function frameRenderer(project: Project, w: number, h: number, paper: boolean, includeHidden: boolean) {
  const full = document.createElement('canvas');
  full.width = project.width;
  full.height = project.height;
  const fctx = full.getContext('2d')!;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  return (f: number) => {
    composeFrame(fctx, project, f, { paper, includeHidden, camera: true });
    octx.clearRect(0, 0, w, h);
    octx.drawImage(full, 0, 0, w, h);
    return out;
  };
}

/** True when this browser can encode video (WebCodecs). */
export const canExportMp4 = () => typeof window !== 'undefined' && 'VideoEncoder' in window;

type VideoChoice = { encoder: string; muxer: 'avc' | 'vp9' };

async function pickVideoCodec(w: number, h: number, fps: number): Promise<VideoChoice | null> {
  // H.264 plays everywhere; the level has to cover the frame size. VP9 is the fallback.
  const options: VideoChoice[] = [
    { encoder: 'avc1.640028', muxer: 'avc' },
    { encoder: 'avc1.640033', muxer: 'avc' },
    { encoder: 'avc1.4d0033', muxer: 'avc' },
    { encoder: 'avc1.42003e', muxer: 'avc' },
    { encoder: 'vp09.00.41.08', muxer: 'vp9' },
  ];
  for (const o of options) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec: o.encoder, width: w, height: h, framerate: fps, bitrate: bitrateFor(w, h, fps) });
      if (supported) return o;
    } catch { /* try the next one */ }
  }
  return null;
}

/** Plenty for flat drawn colours: about 0.1 bits per pixel per frame, at least 1 Mbit/s. */
const bitrateFor = (w: number, h: number, fps: number) => Math.max(1_000_000, Math.round(w * h * fps * 0.1));

const SAMPLE_RATE = 48000;

/** The sound, placed where it starts in the scene and cut to the video's length. */
async function mixSound(project: Project, seconds: number): Promise<AudioBuffer | null> {
  const track = project.audio;
  if (!track) return null;
  const buffer = await decodeAudio(track.data);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = track.volume;
  src.connect(gain).connect(ctx.destination);
  const at = track.start / project.fps;
  if (at >= 0) src.start(at);
  else src.start(0, -at);
  return ctx.startRendering();
}

async function pickAudioCodec(): Promise<{ encoder: string; muxer: 'aac' | 'opus' } | null> {
  if (!('AudioEncoder' in window)) return null;
  for (const o of [{ encoder: 'mp4a.40.2', muxer: 'aac' as const }, { encoder: 'opus', muxer: 'opus' as const }]) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({ codec: o.encoder, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
      if (supported) return o;
    } catch { /* next */ }
  }
  return null;
}

export interface Mp4Result {
  blob: Blob;
  /** The sound made it into the video. */
  withSound: boolean;
  /** Why the sound was left out, if it was. */
  soundNote?: string;
}

/** Encode the scene as an MP4 video, with the sound track when there is one. */
export async function exportMp4(project: Project, opts: FrameOptions & { sound: boolean }): Promise<Mp4Result> {
  const w = even(project.width * opts.scale);
  const h = even(project.height * opts.scale);
  const fps = project.fps;
  const total = sceneLength(project);
  const video = await pickVideoCodec(w, h, fps);
  if (!video) throw new Error('This browser can’t make videos. Try Chrome or Edge, or export a GIF.');

  let sound: AudioBuffer | null = null;
  let audio: Awaited<ReturnType<typeof pickAudioCodec>> = null;
  let soundNote: string | undefined;
  if (opts.sound && project.audio) {
    audio = await pickAudioCodec();
    if (!audio) soundNote = 'This browser can’t encode sound, so the video is silent.';
    else {
      try { sound = await mixSound(project, total / fps); } catch { soundNote = 'The sound couldn’t be read, so the video is silent.'; }
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: video.muxer, width: w, height: h, frameRate: fps },
    ...(sound && audio ? { audio: { codec: audio.muxer, numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: video.encoder, width: w, height: h, framerate: fps, bitrate: bitrateFor(w, h, fps) });

  const draw = frameRenderer(project, w, h, true, opts.includeHidden);
  const frameUs = 1_000_000 / fps;
  for (let f = 0; f < total; f++) {
    if (failure) break;
    const frame = new VideoFrame(draw(f), { timestamp: Math.round(f * frameUs), duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    opts.onProgress?.(f + 1, total + 1);
    // Don't let the encoder's queue grow without bound on long scenes.
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    if (f % 4 === 3) await nextTick();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure instanceof Error ? failure : new Error('The video encoder stopped.');

  if (sound && audio) {
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { failure = e; },
    });
    aenc.configure({ codec: audio.encoder, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
    const left = sound.getChannelData(0);
    const right = sound.getChannelData(1);
    const block = 4800; // 0.1 s
    for (let i = 0; i < sound.length; i += block) {
      const n = Math.min(block, sound.length - i);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(i, i + n), 0);
      data.set(right.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1_000_000), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (failure) throw failure instanceof Error ? failure : new Error('The sound encoder stopped.');
  }

  muxer.finalize();
  opts.onProgress?.(total + 1, total + 1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), withSound: !!(sound && audio), soundNote };
}

/** File names for a numbered image sequence: name_0001.png, … */
export const sequenceName = (base: string, f: number, total: number) =>
  `${base}_${String(f + 1).padStart(Math.max(4, String(total).length), '0')}.png`;

/** Every frame as a PNG, in one zip file. */
export async function exportPngSequence(project: Project, base: string, opts: FrameOptions & { paper: boolean }): Promise<Blob> {
  const w = Math.round(project.width * opts.scale);
  const h = Math.round(project.height * opts.scale);
  const total = sceneLength(project);
  const draw = frameRenderer(project, w, h, opts.paper, opts.includeHidden);
  const files: Record<string, Uint8Array> = {};
  for (let f = 0; f < total; f++) {
    const blob = await new Promise<Blob>((resolve, reject) => draw(f).toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a PNG'))), 'image/png'));
    files[`${base}/${sequenceName(base, f, total)}`] = new Uint8Array(await blob.arrayBuffer());
    opts.onProgress?.(f + 1, total + 1);
  }
  // PNGs are already compressed: store them as they are.
  const zip = zipSync(files, { level: 0 });
  opts.onProgress?.(total + 1, total + 1);
  return new Blob([zip as BlobPart], { type: 'application/zip' });
}
