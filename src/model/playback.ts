// What frame comes next during playback.

export type PlayMode = 'loop' | 'pingpong' | 'once';

export const PLAY_MODES: { id: PlayMode; name: string; help: string }[] = [
  { id: 'loop', name: 'Loop', help: 'Start again from the first frame at the end' },
  { id: 'pingpong', name: 'Ping-pong', help: 'Play forwards, then backwards, and repeat' },
  { id: 'once', name: 'Once', help: 'Stop at the last frame' },
];

/** The frame after `frame` (playing in direction `dir`), the direction after it, and whether to stop. */
export function nextFrame(frame: number, length: number, mode: PlayMode, dir: 1 | -1): { frame: number; dir: 1 | -1; stop: boolean } {
  if (length <= 1) return { frame: 0, dir: 1, stop: mode === 'once' };
  if (mode === 'pingpong') {
    let d = dir;
    if (frame + d >= length || frame + d < 0) d = d === 1 ? -1 : 1;
    return { frame: frame + d, dir: d, stop: false };
  }
  if (frame + 1 < length) return { frame: frame + 1, dir: 1, stop: false };
  return mode === 'loop' ? { frame: 0, dir: 1, stop: false } : { frame, dir: 1, stop: true };
}

/** The order frames play in once through, for exports: 0…n-1, and back down to 1 for ping-pong. */
export function playOrder(length: number, mode: PlayMode): number[] {
  const forward = Array.from({ length }, (_, i) => i);
  return mode === 'pingpong' && length > 2 ? [...forward, ...forward.slice(1, -1).reverse()] : forward;
}
