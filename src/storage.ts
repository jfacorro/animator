import { del, delMany, get, getMany, set, setMany } from 'idb-keyval';
import { isProject, type Drawing, type Project } from './model/project';

// Projects live in the browser's IndexedDB: no server, no account.
const CURRENT_KEY = 'animator:current-project';

// The project is stored in pieces: the project without its drawings, and
// each drawing under its own key. Drawings never change once made (an edit
// makes a new drawing object), so a save only writes the drawings that are
// new since the last one, instead of copying the whole animation each time.
const META_KEY = 'animator:current-meta';
const drawingKey = (id: string) => `animator:d:${id}`;
type StoredMeta = Omit<Project, 'drawings'> & { drawingIds: string[] };

/** The drawing object last written under each id. (Undo can bring back an older object for the same id.) */
let stored = new Map<string, Drawing>();

export async function loadCurrentProject(): Promise<Project | null> {
  try {
    const meta = (await get(META_KEY)) as StoredMeta | undefined;
    if (meta?.drawingIds) {
      const list = (await getMany(meta.drawingIds.map(drawingKey))) as (Drawing | undefined)[];
      const drawings: Record<string, Drawing> = {};
      meta.drawingIds.forEach((id, i) => {
        const d = list[i];
        if (d) drawings[id] = d;
      });
      stored = new Map(Object.entries(drawings));
      const { drawingIds: _ids, ...rest } = meta;
      void _ids;
      const project = { ...rest, drawings };
      return isProject(project) ? project : null;
    }
    // Saved by an older version, in one piece.
    const value = await get(CURRENT_KEY);
    return isProject(value) ? value : null;
  } catch {
    return null;
  }
}

let saving: Promise<void> = Promise.resolve();

export function saveCurrentProject(project: Project): Promise<void> {
  // One save at a time, in order, so a slow save can't land after a newer one.
  saving = saving.catch(() => {}).then(() => writeCurrent(project));
  return saving;
}

async function writeCurrent(project: Project): Promise<void> {
  const { drawings, ...rest } = project;
  const ids = Object.keys(drawings);
  const fresh: [string, Drawing][] = [];
  for (const id of ids) if (stored.get(id) !== drawings[id]) fresh.push([id, drawings[id]]);
  const gone = [...stored.keys()].filter((id) => !(id in drawings));
  if (fresh.length) await setMany(fresh.map(([id, d]) => [drawingKey(id), d]));
  for (const [id, d] of fresh) stored.set(id, d);
  const meta: StoredMeta = { ...rest, drawingIds: ids };
  await set(META_KEY, meta);
  for (const id of gone) stored.delete(id);
  if (gone.length) await delMany(gone.map(drawingKey));
  if (!legacyCleared) {
    legacyCleared = true;
    await del(CURRENT_KEY); // the one-piece copy from older versions, if any
  }
}
let legacyCleared = false;

// Project files are JSON. Each drawing's JSON is kept, so writing the file
// again after a change only turns the changed drawings into text.
const drawingJson = new WeakMap<Drawing, string>();

/** The project as JSON text: the same as JSON.stringify(project), made faster. */
export function projectJson(project: Project): string {
  const { drawings, ...meta } = project;
  const head = JSON.stringify(meta);
  const parts: string[] = [];
  for (const id of Object.keys(drawings)) {
    const d = drawings[id];
    let j = drawingJson.get(d);
    if (j === undefined) {
      j = JSON.stringify(d);
      drawingJson.set(d, j);
    }
    parts.push(`${JSON.stringify(id)}:${j}`);
  }
  return `${head.slice(0, -1)}${head.length > 2 ? ',' : ''}"drawings":{${parts.join(',')}}}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'animation';
}

export function saveProjectFile(project: Project) {
  const blob = new Blob([projectJson(project)], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(project.name)}.animator.json`);
}

export async function readProjectFile(file: File): Promise<Project> {
  const value: unknown = JSON.parse(await file.text());
  if (!isProject(value)) throw new Error('This file is not an Animator project.');
  return value;
}

// Saving straight to a file on disk, and auto-saving to it after that, uses
// the File System Access API (Chrome and Edge on the desktop). Elsewhere,
// saving falls back to a download and auto-save to a file isn't available.
const FILE_KEY = 'animator:project-file';
const FILE_TYPES = [{ description: 'Animator project', accept: { 'application/json': ['.json'] } }];

interface FilePickerWindow {
  showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
}
interface PermissionHandle {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
}
const pickers = () => window as unknown as FilePickerWindow;

export const canSaveToFile = () => typeof pickers().showSaveFilePicker === 'function';

export interface LinkedFile {
  handle: FileSystemFileHandle;
  /** The project this file belongs to; another project never writes to it. */
  projectId: string;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Ask where to save. Returns null if the person cancels. */
export async function pickSaveFile(project: Project): Promise<LinkedFile | null> {
  try {
    const handle = await pickers().showSaveFilePicker!({ suggestedName: `${safeFileName(project.name)}.animator.json`, types: FILE_TYPES });
    return { handle, projectId: project.id };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Ask for a project file to open. Returns null if the person cancels. */
export async function pickOpenFile(): Promise<{ project: Project; handle: FileSystemFileHandle } | null> {
  try {
    const [handle] = await pickers().showOpenFilePicker!({ types: FILE_TYPES });
    return { project: await readProjectFile(await handle.getFile()), handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export async function writeProjectFile(file: LinkedFile, project: Project): Promise<void> {
  const writable = await file.handle.createWritable();
  await writable.write(projectJson(project));
  await writable.close();
}

/** Remember the linked file across reloads (file handles can be stored in IndexedDB). */
export async function rememberLinkedFile(file: LinkedFile | null): Promise<void> {
  try {
    if (file) await set(FILE_KEY, file);
    else await del(FILE_KEY);
  } catch {
    // Not every browser can store a handle; auto-save then lasts until a reload.
  }
}

export async function loadLinkedFile(): Promise<LinkedFile | null> {
  try {
    const value = (await get(FILE_KEY)) as LinkedFile | undefined;
    return value?.handle && value.projectId ? value : null;
  } catch {
    return null;
  }
}

/** Whether we may write to the file without asking. `ask` must run from a click. */
export async function filePermission(file: LinkedFile, ask: boolean): Promise<boolean> {
  const h = file.handle as unknown as PermissionHandle;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
