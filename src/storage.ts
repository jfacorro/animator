import { get, set } from 'idb-keyval';
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
