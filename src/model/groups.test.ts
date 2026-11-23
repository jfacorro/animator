import { describe, expect, it } from 'vitest';
import { groupLayer, isLocked, isShown, moveGroupToGap, removeGroup, sceneUnits, ungroup, updateGroup } from './groups';
import { addLayer, createProject, moveLayerToGap, removeLayer, updateLayer, type Project } from './project';

/** Background, A, B, C, D from bottom to top. */
function scene(): Project {
  let p = createProject();
  p = { ...p, layers: [p.layers[0]] };
  for (const n of ['A', 'B', 'C', 'D']) p = addLayer(p, n).project;
  return p;
}
const names = (p: Project) => p.layers.map((l) => l.name + (l.groupId ? `(${p.groups![l.groupId].name})` : '')).join(' ');
const id = (p: Project, n: string) => p.layers.find((l) => l.name === n)!.id;

describe('layer groups', () => {
  it('groups a layer, and new layers above it join', () => {
    let p = scene();
    const r = groupLayer(p, id(p, 'B'));
    p = addLayer(r.project, 'B2', id(r.project, 'B')).project;
    expect(names(p)).toBe('Background A B(Group 1) B2(Group 1) C D');
  });

  it('hides and locks with its group', () => {
    let p = scene();
    const r = groupLayer(p, id(p, 'B'));
    p = updateGroup(r.project, r.groupId, { visible: false, locked: true });
    const b = p.layers.find((l) => l.name === 'B')!;
    expect(isShown(p, b)).toBe(false);
    expect(isLocked(p, b)).toBe(true);
  });

  it('joins or leaves a group when a layer is dragged', () => {
    let p = scene();
    const g = groupLayer(p, id(p, 'B'));
    p = addLayer(g.project, 'B2', id(g.project, 'B')).project; // Background A B B2 C D
    p = moveLayerToGap(p, id(p, 'D'), 3, g.groupId); // between B and B2
    expect(names(p)).toBe('Background A B(Group 1) D(Group 1) B2(Group 1) C');
    p = moveLayerToGap(p, id(p, 'B'), 0, null); // out, to the bottom
    expect(names(p)).toBe('B Background A D(Group 1) B2(Group 1) C');
    // Removing every member removes the group.
    p = removeLayer(removeLayer(p, id(p, 'D')), id(p, 'B2'));
    expect(p.groups).toBeUndefined();
  });

  it('keeps a group together', () => {
    let p = scene();
    const g = groupLayer(p, id(p, 'A'));
    p = addLayer(g.project, 'A2', id(g.project, 'A')).project; // Background A A2 B C D
    p = moveGroupToGap(p, g.groupId, 6); // to the top
    expect(names(p)).toBe('Background B C D A(Group 1) A2(Group 1)');
    p = moveGroupToGap(p, g.groupId, 0);
    expect(names(p)).toBe('A(Group 1) A2(Group 1) Background B C D');
    // A gap inside another group steps out above it.
    const h = groupLayer(p, id(p, 'B'));
    p = addLayer(h.project, 'B2', id(h.project, 'B')).project; // A A2 Background B B2 C D
    p = moveGroupToGap(p, g.groupId, 4); // between B and B2
    expect(names(p)).toBe('Background B(Group 2) B2(Group 2) A(Group 1) A2(Group 1) C D');
  });

  it('ungroups and deletes groups', () => {
    let p = scene();
    const g = groupLayer(p, id(p, 'C'));
    expect(names(ungroup(g.project, g.groupId))).toBe('Background A B C D');
    expect(names(removeGroup(g.project, g.groupId))).toBe('Background A B D');
  });

  it('builds drawing units with clipping', () => {
    let p = scene();
    p = updateLayer(updateLayer(p, id(p, 'B'), { clip: true }), id(p, 'C'), { clip: true });
    const g = groupLayer(p, id(p, 'D'));
    const units = sceneUnits(g.project);
    expect(units.map((u) => (u.kind === 'stack' ? `${u.base.name}[${u.clipped.map((c) => c.name).join('')}]` : `group:${u.stacks.map((s) => s.base.name).join('')}`)))
      .toEqual(['Background[]', 'A[BC]', 'group:D']);
  });
});
