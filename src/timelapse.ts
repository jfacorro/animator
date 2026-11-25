// Timelapse: a small picture of the frame you're working on after each change,
// kept in this browser per animation, to replay how a drawing came together.
import { del, get, set } from 'idb-keyval';
import type { Project } from './model/project';
import { composeFrame } from './render/render';

const key = (projectId: string) => `animator:timelapse:${projectId}`;
/** Longest side of a recorded picture, in px. */
const SIDE = 640;
/** When there are more pictures than this, every other one is dropped. */
const MAX = 2400;
/** At most one picture per this many ms. */
const EVERY = 600;

let id: string | null = null;
let shots: Blob[] = [];
let loaded: Promise<void> | null = null;
let timer = 0;
let last = 0;
let saveTimer = 0;
let pending: { project: Project; frame: number } | null = null;
let canvas: HTMLCanvasElement | null = null;
let full: HTMLCanvasElement | null = null;

async function use(projectId: string) {
  if (id === projectId && loaded) return loaded;
  id = projectId;
  shots = [];
  loaded = get(key(projectId)).then((v) => {
    if (id === projectId && Array.isArray(v)) shots = [...(v as Blob[]), ...shots];
  }).catch(() => undefined);
  return loaded;
}

/** Size of the recorded pictures for a project. */
export function shotSize(project: Project): { w: number; h: number } {
  const s = Math.min(1, SIDE / Math.max(project.width, project.height));
  return { w: Math.round(project.width * s), h: Math.round(project.height * s) };
}

async function capture() {
  const p = pending;
  pending = null;
  if (!p) return;
  last = Date.now();
  await use(p.project.id);
  const { w, h } = shotSize(p.project);
  if (!canvas) canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // Drawn at project size, then shrunk: a screen-style render here would throw
  // away the canvas's own cached pictures on every change.
  if (!full) full = document.createElement('canvas');
  if (full.width !== p.project.width || full.height !== p.project.height) { full.width = p.project.width; full.height = p.project.height; }
  composeFrame(full.getContext('2d')!, p.project, p.frame, { paper: true });
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas!.toBlob(r, 'image/jpeg', 0.82));
  if (!blob || id !== p.project.id) return;
  shots.push(blob);
  if (shots.length > MAX) shots = shots.filter((_, i) => i % 2 === 0 || i === shots.length - 1);
  window.clearTimeout(saveTimer);
  const projectId = p.project.id;
  saveTimer = window.setTimeout(() => { set(key(projectId), shots).catch(() => undefined); }, 2000);
}

/** Note that the drawing changed: a picture is taken soon (not on every change while drawing fast). */
export function recordChange(project: Project, frame: number) {
  pending = { project, frame };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void capture(); }, Math.max(0, EVERY - (Date.now() - last)));
}

/** The pictures recorded for this animation, oldest first. */
export async function timelapseShots(projectId: string): Promise<Blob[]> {
  await use(projectId);
  return shots;
}

export async function clearTimelapse(projectId: string): Promise<void> {
  if (id === projectId) shots = [];
  await del(key(projectId)).catch(() => undefined);
}
