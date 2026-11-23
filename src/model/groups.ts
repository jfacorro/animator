// Layer groups: folders of neighbouring layers that show, hide, lock, fade
// and blend together.
import { newId, pruneGroups, withoutGroup, type Layer, type LayerGroup, type Project } from './project';

export const groupOf = (project: Project, layer: Layer): LayerGroup | null =>
  (layer.groupId && project.groups?.[layer.groupId]) || null;

/** Shown, counting its group. */
export const isShown = (project: Project, layer: Layer) => layer.visible && (groupOf(project, layer)?.visible ?? true);
/** Locked, counting its group. */
export const isLocked = (project: Project, layer: Layer) => layer.locked || (groupOf(project, layer)?.locked ?? false);

/** Put a layer in a new group of its own. */
export function groupLayer(project: Project, layerId: string): { project: Project; groupId: string } {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.groupId) return { project, groupId: layer?.groupId ?? '' };
  const id = newId('g');
  const n = Object.keys(project.groups ?? {}).length + 1;
  const group: LayerGroup = { id, name: `Group ${n}`, visible: true, locked: false, opacity: 1 };
  const layers = project.layers.map((l) => (l.id === layerId ? { ...l, groupId: id } : l));
  return { project: { ...project, layers, groups: { ...(project.groups ?? {}), [id]: group } }, groupId: id };
}

/** Dissolve a group, keeping its layers where they are. */
export function ungroup(project: Project, groupId: string): Project {
  const layers = project.layers.map((l) => (l.groupId === groupId ? withoutGroup(l) : l));
  return pruneGroups({ ...project, layers });
}

export function updateGroup(project: Project, groupId: string, patch: Partial<Omit<LayerGroup, 'id'>>): Project {
  const g = project.groups?.[groupId];
  if (!g) return project;
  return { ...project, groups: { ...project.groups, [groupId]: { ...g, ...patch } } };
}

/** Delete a group and all its layers (never the last layers of the scene). */
export function removeGroup(project: Project, groupId: string): Project {
  const layers = project.layers.filter((l) => l.groupId !== groupId);
  if (!layers.length) return project;
  const { [groupId]: _gone, ...groups } = project.groups ?? {};
  return pruneGroups({ ...project, layers, groups });
}

/**
 * Move a whole group into a gap in the stack (gaps count bottom to top).
 * A gap inside another group moves it just above that group instead.
 */
export function moveGroupToGap(project: Project, groupId: string, gap: number): Project {
  const members = project.layers.filter((l) => l.groupId === groupId);
  if (!members.length) return project;
  const first = project.layers.findIndex((l) => l.groupId === groupId);
  const others = project.layers.filter((l) => l.groupId !== groupId);
  // Gap among the other layers.
  let at = gap <= first ? gap : Math.max(first, gap - members.length);
  at = Math.max(0, Math.min(others.length, at));
  const below = others[at - 1];
  const above = others[at];
  if (below?.groupId && below.groupId === above?.groupId) {
    // Inside another group: step out above it.
    while (others[at]?.groupId === below.groupId) at++;
  }
  const layers = [...others.slice(0, at), ...members, ...others.slice(at)];
  if (layers.every((l, i) => l === project.layers[i])) return project;
  return { ...project, layers };
}

/**
 * The scene as drawing units, bottom to top: single layers and groups. Within
 * each, clipped layers are attached to the base layer below them.
 */
export type Unit =
  | { kind: 'stack'; base: Layer; clipped: Layer[] }
  | { kind: 'group'; group: LayerGroup; stacks: { base: Layer; clipped: Layer[] }[] };

function stacksOf(layers: Layer[]): { base: Layer; clipped: Layer[] }[] {
  const out: { base: Layer; clipped: Layer[] }[] = [];
  for (const l of layers) {
    const last = out[out.length - 1];
    if (l.clip && last) last.clipped.push(l);
    else out.push({ base: l, clipped: [] });
  }
  return out;
}

export function sceneUnits(project: Project): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  const layers = project.layers;
  while (i < layers.length) {
    const g = groupOf(project, layers[i]);
    if (!g) {
      // A run of ungrouped layers.
      let j = i;
      while (j < layers.length && !groupOf(project, layers[j])) j++;
      for (const s of stacksOf(layers.slice(i, j))) units.push({ kind: 'stack', ...s });
      i = j;
    } else {
      let j = i;
      while (j < layers.length && layers[j].groupId === g.id) j++;
      units.push({ kind: 'group', group: g, stacks: stacksOf(layers.slice(i, j)) });
      i = j;
    }
  }
  return units;
}

export const BLEND_MODES: { id: NonNullable<Layer['blend']>; name: string }[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'multiply', name: 'Multiply' },
  { id: 'screen', name: 'Screen' },
  { id: 'overlay', name: 'Overlay' },
  { id: 'darken', name: 'Darken' },
  { id: 'lighten', name: 'Lighten' },
  { id: 'add', name: 'Add (glow)' },
  { id: 'color-dodge', name: 'Colour dodge' },
  { id: 'color-burn', name: 'Colour burn' },
  { id: 'soft-light', name: 'Soft light' },
  { id: 'hard-light', name: 'Hard light' },
  { id: 'difference', name: 'Difference' },
  { id: 'color', name: 'Colour' },
  { id: 'luminosity', name: 'Luminosity' },
];

/** Canvas compositing operation for a blend mode. */
export function compositeOp(blend: Layer['blend']): GlobalCompositeOperation {
  if (!blend || blend === 'normal') return 'source-over';
  if (blend === 'add') return 'lighter';
  return blend;
}
