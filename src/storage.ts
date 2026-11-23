import { del, get, set } from 'idb-keyval';
import { isProject, type Project } from './model/project';

// Projects live in the browser's IndexedDB: no server, no account.
const CURRENT_KEY = 'animator:current-project';

export async function loadCurrentProject(): Promise<Project | null> {
  try {
    const value = await get(CURRENT_KEY);
    return isProject(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveCurrentProject(project: Project): Promise<void> {
  await set(CURRENT_KEY, project);
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
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
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
  await writable.write(JSON.stringify(project));
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
