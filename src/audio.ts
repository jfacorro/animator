// The sound track: decoding, waveform peaks, playback in sync with the
// frames, and short "scrub" snippets when stepping frame by frame (lip-sync).
import { useEffect, useRef, useState } from 'react';
import type { AudioTrack, Project } from './model/project';

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const decoded = new Map<string, Promise<AudioBuffer>>();
export function decodeAudio(data: string): Promise<AudioBuffer> {
  let p = decoded.get(data);
  if (!p) {
    p = fetch(data).then((r) => r.arrayBuffer()).then((buf) => audioContext().decodeAudioData(buf));
    decoded.set(data, p);
    p.catch(() => decoded.delete(data));
  }
  return p;
}

export function useAudioBuffer(track: AudioTrack | null | undefined): AudioBuffer | null {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const data = track?.data;
  useEffect(() => {
    setBuffer(null);
    if (!data) return;
    let live = true;
    decodeAudio(data).then((b) => { if (live) setBuffer(b); }).catch(() => {});
    return () => { live = false; };
  }, [data]);
  return buffer;
}

/** Loudest sample in each of `count` equal slices of the sound, 0–1. */
export function peaks(buffer: AudioBuffer, count: number): Float32Array {
  const out = new Float32Array(count);
  const per = buffer.length / count;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i * per);
      const b = Math.min(data.length, Math.floor((i + 1) * per));
      let m = out[i];
      // Sample a slice sparsely; plenty for a waveform at a few px per slice.
      const step = Math.max(1, Math.floor((b - a) / 200));
      for (let j = a; j < b; j += step) {
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      out[i] = m;
    }
  }
  return out;
}

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export function readAudioFile(file: File): Promise<AudioTrack> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_AUDIO_BYTES) {
      reject(new Error('That sound file is too big. Use one under 20 MB, for example a short MP3.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const data = reader.result as string;
      decodeAudio(data)
        .then((b) => resolve({ name: file.name, data, start: 0, volume: 1, duration: b.duration }))
        .catch(() => reject(new Error('This browser can’t play that sound file. Try an MP3 or WAV.')));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Play the sound while the animation plays, starting from the current frame,
 * and play a one-frame snippet when stepping through frames.
 */
export function useAudioPlayback(project: Project, frame: number, playing: boolean, scrub: boolean) {
  const track = project.audio ?? null;
  const buffer = useAudioBuffer(track);
  const source = useRef<{ node: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const lastFrame = useRef(frame);

  const stop = () => {
    try { source.current?.node.stop(); } catch { /* already stopped */ }
    source.current = null;
  };

  const start = (fromFrame: number, duration?: number) => {
    if (!buffer || !track) return;
    const ac = audioContext();
    const offset = (fromFrame - track.start) / project.fps;
    const node = ac.createBufferSource();
    node.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.value = track.volume;
    node.connect(gain).connect(ac.destination);
    if (offset >= buffer.duration) return;
    if (offset < 0) {
      if (duration !== undefined) return; // scrubbing before the sound starts
      node.start(ac.currentTime - offset, 0);
    } else {
      node.start(0, offset, duration);
    }
    source.current = { node, gain };
  };

  // Start and stop with playback; restart when playback loops back.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!playing) {
      if (wasPlaying.current) stop();
      wasPlaying.current = false;
      return;
    }
    if (!wasPlaying.current || !source.current || frame < lastFrame.current) {
      wasPlaying.current = true;
      stop();
      start(frame);
    }
    lastFrame.current = frame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frame, buffer]);

  // Scrub: one frame of sound when stepping while paused.
  useEffect(() => {
    if (playing || !scrub) return;
    if (frame === lastFrame.current) return;
    lastFrame.current = frame;
    stop();
    start(frame, Math.max(1 / project.fps, 0.08));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  // Follow volume changes and stop when the sound is removed or the page closes.
  useEffect(() => {
    if (source.current && track) source.current.gain.gain.value = track.volume;
  }, [track?.volume]);
  useEffect(() => () => stop(), [track?.data]);
}
