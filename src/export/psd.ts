// Photoshop files: export one frame with its layers, and open a PSD as paint layers.
import { readPsd, writePsd, type BlendMode as PsdBlend, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { createDrawing, newId, type BlendMode, type Layer, type Project } from '../model/project';
import { composeFrame, encodePaint, PAPER } from '../render/render';

const TO_PSD: Record<BlendMode, PsdBlend> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  add: 'linear dodge', 'color-dodge': 'color dodge', 'color-burn': 'color burn', 'hard-light': 'hard light',
  'soft-light': 'soft light', difference: 'difference', color: 'color', luminosity: 'luminosity',
};
const FROM_PSD = Object.fromEntries(Object.entries(TO_PSD).map(([a, b]) => [b, a])) as Partial<Record<PsdBlend, BlendMode>>;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** One layer on its own at this frame, at full strength (its opacity and blend go in the PSD), with its mask applied. */
function layerCanvas(project: Project, layer: Layer, frame: number, scale: number): HTMLCanvasElement {
  const w = Math.round(project.width * scale), h = Math.round(project.height * scale);
  const c = canvas(w, h);
  const solo: Project = {
    ...project,
    layers: [{ ...layer, visible: true, opacity: 1, blend: 'normal', clip: false, groupId: undefined }],
    groups: {},
  };
  composeFrame(c.getContext('2d')!, solo, frame, {
    paper: false, camera: true, includeHidden: true,
    view: scale === 1 ? undefined : { matrix: [scale, 0, 0, scale, 0, 0], width: w, height: h },
  });
  return c;
}

/**
 * The frame as a layered Photoshop file: each layer (and group) kept apart, with
 * its name, opacity, blend mode, visibility and clipping. Reference images are left out.
 */
export function exportPsd(project: Project, frame: number, opts: { scale: number; paper: boolean; includeHidden: boolean }): Blob {
  const w = Math.round(project.width * opts.scale), h = Math.round(project.height * opts.scale);
  const top: PsdLayer[] = [];
  if (opts.paper) {
    const bg = canvas(w, h);
    const ctx = bg.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    top.push({ name: 'Paper', canvas: bg });
  }
  const folders = new Map<string, PsdLayer>();
  for (const layer of project.layers) {
    if (layer.reference || (!layer.visible && !opts.includeHidden)) continue;
    const entry: PsdLayer = {
      name: layer.name, canvas: layerCanvas(project, layer, frame, opts.scale), opacity: layer.opacity,
      hidden: !layer.visible, blendMode: TO_PSD[layer.blend ?? 'normal'], clipping: !!layer.clip,
    };
    const group = layer.groupId ? project.groups?.[layer.groupId] : undefined;
    if (!group) { top.push(entry); continue; }
    let folder = folders.get(group.id);
    if (!folder) {
      folder = { name: group.name, opacity: group.opacity, hidden: !group.visible, blendMode: TO_PSD[group.blend ?? 'normal'], children: [], opened: true };
      folders.set(group.id, folder);
      top.push(folder);
    }
    folder.children!.push(entry);
  }
  // The flattened picture other apps show as a preview.
  const flat = canvas(w, h);
  composeFrame(flat.getContext('2d')!, project, frame, {
    paper: opts.paper, camera: true, includeHidden: opts.includeHidden,
    view: opts.scale === 1 ? undefined : { matrix: [opts.scale, 0, 0, opts.scale, 0, 0], width: w, height: h },
  });
  const psd: Psd = { width: w, height: h, canvas: flat, children: top };
  return new Blob([writePsd(psd, { generateThumbnail: true })], { type: 'image/vnd.adobe.photoshop' });
}

/** Leaf layers in stacking order (bottom first), with the folders they're in. */
function flatten(layers: PsdLayer[], path: PsdLayer[] = []): { layer: PsdLayer; folders: PsdLayer[] }[] {
  return layers.flatMap((l) => (l.children ? flatten(l.children, [...path, l]) : [{ layer: l, folders: path }]));
}

/** A Photoshop file as a new animation: one frame, each PSD layer a paint layer. */
export async function importPsd(file: File): Promise<Project> {
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true });
  const { width: w, height: h } = psd;
  const drawings: Project['drawings'] = {};
  const layers: Layer[] = [];
  const groups: NonNullable<Project['groups']> = {};
  const groupIds = new Map<PsdLayer, string>();
  for (const { layer: pl, folders } of flatten(psd.children ?? [])) {
    if (!pl.canvas) continue;
    const sheet = canvas(w, h);
    sheet.getContext('2d')!.drawImage(pl.canvas, pl.left ?? 0, pl.top ?? 0);
    const paint = encodePaint(sheet, w, h);
    const d = createDrawing();
    drawings[d.id] = paint ? { ...d, paint } : d;
    // Only the outermost folder becomes a group: groups don't nest here.
    const outer = folders[0];
    let groupId: string | undefined;
    if (outer) {
      groupId = groupIds.get(outer);
      if (!groupId) {
        groupId = newId('g');
        groupIds.set(outer, groupId);
        groups[groupId] = { id: groupId, name: outer.name ?? 'Group', visible: !outer.hidden, locked: false, opacity: outer.opacity ?? 1, blend: FROM_PSD[outer.blendMode ?? 'normal'] ?? 'normal' };
      }
    }
    layers.push({
      id: newId('l'), name: pl.name || `Layer ${layers.length + 1}`, visible: !pl.hidden, locked: false,
      opacity: pl.opacity ?? 1, blend: FROM_PSD[pl.blendMode ?? 'normal'] ?? 'normal', clip: pl.clipping || undefined,
      paint: true, cels: [{ drawingId: d.id, hold: 1 }], ...(groupId ? { groupId } : {}),
    });
  }
  if (!layers.length) throw new Error('This PSD has no layers with pixels in it.');
  const name = file.name.replace(/\.psd$/i, '') || 'Imported PSD';
  return { version: 1, id: newId('p'), name, width: w, height: h, fps: 12, layers, drawings, groups };
}
