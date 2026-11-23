// Camera moves: keyframed pan, zoom and rotation over the whole scene.
import type { Matrix } from './geometry';
import type { CameraKey, Project } from './project';

export type CameraView = Omit<CameraKey, 'frame'>;

export const restingCamera = (p: Pick<Project, 'width' | 'height'>): CameraView => ({ x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 });

const ease = (t: number) => t * t * (3 - 2 * t); // smooth start and stop

/** Where the camera is at `frame`: eased between keys, held before the first and after the last. */
export function cameraAt(project: Project, frame: number): CameraView {
  const keys = project.camera ?? [];
  if (!keys.length) return restingCamera(project);
  if (frame <= keys[0].frame) return strip(keys[0]);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return strip(last);
  const i = keys.findIndex((k) => k.frame > frame);
  const a = keys[i - 1];
  const b = keys[i];
  const t = ease((frame - a.frame) / (b.frame - a.frame));
  const mix = (u: number, v: number) => u + (v - u) * t;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), zoom: a.zoom * Math.pow(b.zoom / a.zoom, t), rotation: mix(a.rotation, b.rotation) };
}

const strip = ({ x, y, zoom, rotation }: CameraKey): CameraView => ({ x, y, zoom, rotation });

export const keyAt = (project: Project, frame: number) => (project.camera ?? []).find((k) => k.frame === frame) ?? null;

/** Set (or replace) the camera key at a frame. */
export function setCameraKey(project: Project, frame: number, view: CameraView): Project {
  const key: CameraKey = { frame, x: view.x, y: view.y, zoom: Math.min(20, Math.max(0.1, view.zoom)), rotation: view.rotation };
  const camera = [...(project.camera ?? []).filter((k) => k.frame !== frame), key].sort((a, b) => a.frame - b.frame);
  return { ...project, camera };
}

export function removeCameraKey(project: Project, frame: number): Project {
  const camera = (project.camera ?? []).filter((k) => k.frame !== frame);
  return { ...project, camera: camera.length ? camera : undefined };
}

/** Maps canvas (scene) coordinates to the output picture for this camera view. */
export function cameraMatrix(view: CameraView, w: number, h: number): Matrix {
  const r = (view.rotation * Math.PI) / 180;
  const c = Math.cos(-r) * view.zoom;
  const s = Math.sin(-r) * view.zoom;
  // translate(w/2, h/2) · rotate(-r) · scale(zoom) · translate(-x, -y)
  return [c, s, -s, c, w / 2 - (c * view.x - s * view.y), h / 2 - (s * view.x + c * view.y)];
}

/** The four corners of the camera's view on the canvas, clockwise from top-left. */
export function cameraCorners(view: CameraView, w: number, h: number): [number, number][] {
  const r = (view.rotation * Math.PI) / 180;
  const hw = w / 2 / view.zoom;
  const hh = h / 2 / view.zoom;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(([dx, dy]) => [
    view.x + dx * Math.cos(r) - dy * Math.sin(r),
    view.y + dx * Math.sin(r) + dy * Math.cos(r),
  ]);
}

/** Whether the camera ever moves away from showing the whole canvas. */
export const hasCamera = (project: Project) => !!project.camera?.length;
