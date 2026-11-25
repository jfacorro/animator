// Keyboard shortcuts that can be changed, and the keys that can't.

export type ActionId =
  | 'tool.brush' | 'tool.eraser' | 'tool.line' | 'tool.rect' | 'tool.ellipse' | 'tool.fill' | 'tool.text'
  | 'tool.eyedropper' | 'tool.select' | 'tool.liquify' | 'tool.camera'
  | 'frame.prev' | 'frame.next' | 'frame.new' | 'frame.duplicate' | 'onion.toggle'
  | 'brush.smaller' | 'brush.bigger' | 'symmetry.next' | 'rulers.toggle'
  | 'view.zoomIn' | 'view.zoomOut' | 'view.fit' | 'view.actual' | 'view.rotateLeft' | 'view.rotateRight' | 'view.straighten' | 'view.mirror';

export interface ActionDef {
  id: ActionId;
  label: string;
  group: 'Tools' | 'Frames' | 'Drawing' | 'View';
  key: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'tool.brush', label: 'Brush', group: 'Tools', key: 'b' },
  { id: 'tool.eraser', label: 'Eraser', group: 'Tools', key: 'e' },
  { id: 'tool.line', label: 'Line', group: 'Tools', key: 'l' },
  { id: 'tool.rect', label: 'Rectangle', group: 'Tools', key: 'r' },
  { id: 'tool.ellipse', label: 'Ellipse', group: 'Tools', key: 'c' },
  { id: 'tool.fill', label: 'Fill', group: 'Tools', key: 'g' },
  { id: 'tool.text', label: 'Text', group: 'Tools', key: 't' },
  { id: 'tool.eyedropper', label: 'Eyedropper', group: 'Tools', key: 'i' },
  { id: 'tool.select', label: 'Lasso select', group: 'Tools', key: 's' },
  { id: 'tool.liquify', label: 'Liquify', group: 'Tools', key: 'w' },
  { id: 'tool.camera', label: 'Camera', group: 'Tools', key: 'k' },
  { id: 'frame.prev', label: 'Previous frame', group: 'Frames', key: ',' },
  { id: 'frame.next', label: 'Next frame', group: 'Frames', key: '.' },
  { id: 'frame.new', label: 'New drawing', group: 'Frames', key: 'n' },
  { id: 'frame.duplicate', label: 'Duplicate drawing', group: 'Frames', key: 'd' },
  { id: 'onion.toggle', label: 'Onion skin on / off', group: 'Frames', key: 'o' },
  { id: 'brush.smaller', label: 'Smaller size (brush, eraser, shapes, Liquify, text)', group: 'Drawing', key: '[' },
  { id: 'brush.bigger', label: 'Bigger size (brush, eraser, shapes, Liquify, text)', group: 'Drawing', key: ']' },
  { id: 'symmetry.next', label: 'Switch symmetry', group: 'Drawing', key: 'y' },
  { id: 'rulers.toggle', label: 'Rulers and guides on / off', group: 'Drawing', key: 'shift+r' },
  { id: 'view.zoomIn', label: 'Zoom in', group: 'View', key: '=' },
  { id: 'view.zoomOut', label: 'Zoom out', group: 'View', key: '-' },
  { id: 'view.fit', label: 'Fit to screen', group: 'View', key: '0' },
  { id: 'view.actual', label: 'Actual size', group: 'View', key: '1' },
  { id: 'view.rotateLeft', label: 'Rotate view left', group: 'View', key: '4' },
  { id: 'view.rotateRight', label: 'Rotate view right', group: 'View', key: '6' },
  { id: 'view.straighten', label: 'Straighten view', group: 'View', key: '5' },
  { id: 'view.mirror', label: 'Mirror view', group: 'View', key: 'm' },
];

/** Keys that keep their job: they can't be given to another action. */
export const FIXED: { keys: string; label: string }[] = [
  { keys: 'Space', label: 'Tap to play / pause, hold and drag to pan' },
  { keys: 'Tab', label: 'Hide or show the panels' },
  { keys: '← / →', label: 'Previous / next frame' },
  { keys: 'Home / End', label: 'First / last frame' },
  { keys: 'Delete', label: 'Delete the selection or camera key' },
  { keys: 'Esc', label: 'Deselect' },
  { keys: '?', label: 'This list of shortcuts' },
  { keys: 'Ctrl+Z / Ctrl+Shift+Z', label: 'Undo / redo' },
  { keys: 'Ctrl+C / X / V', label: 'Copy / cut / paste' },
];
const RESERVED = new Set(['?', ' ', 'tab', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'delete', 'backspace', 'escape', 'enter']);

export type Keymap = Record<ActionId, string>;

export const DEFAULT_KEYMAP = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])) as Keymap;

/**
 * The shortcut name for a key press, like 'b', 'shift+r' or '['. Null for
 * presses that can't be shortcuts (with Ctrl, Alt or Cmd, or a bare modifier).
 * Shift is only spelled out for letters and named keys: for symbols it is
 * already part of the character typed.
 */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (['shift', 'control', 'alt', 'meta', 'capslock', 'dead', 'unidentified'].includes(k)) return null;
  const named = k.length > 1;
  return e.shiftKey && (named || /^[a-z]$/.test(k)) ? `shift+${k}` : k;
}

export const isReserved = (key: string) => RESERVED.has(key.replace(/^shift\+/, ''));

/** How a shortcut looks on screen: 'B', 'Shift+R', '['. */
export function displayKey(key: string): string {
  if (!key) return '—';
  return key.split('+').map((p) => (p === 'shift' ? 'Shift' : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+');
}

/** Saved shortcuts, with defaults for anything missing or broken. */
export function loadKeymap(saved: unknown): Keymap {
  const map = { ...DEFAULT_KEYMAP };
  if (saved && typeof saved === 'object') {
    for (const a of ACTIONS) {
      const v = (saved as Record<string, unknown>)[a.id];
      if (typeof v === 'string' && (v === '' || !isReserved(v))) map[a.id] = v;
    }
  }
  return map;
}

/** Give `key` to `action`; whichever action had it loses it. Returns the new map and that action. */
export function assignKey(map: Keymap, action: ActionId, key: string): { map: Keymap; displaced: ActionId | null } {
  const next = { ...map };
  let displaced: ActionId | null = null;
  for (const a of ACTIONS) {
    if (a.id !== action && key && next[a.id] === key) {
      next[a.id] = '';
      displaced = a.id;
    }
  }
  next[action] = key;
  return { map: next, displaced };
}

/** The action a key press triggers, if any. */
export function actionFor(map: Keymap, key: string | null): ActionId | null {
  if (!key) return null;
  for (const a of ACTIONS) if (map[a.id] === key) return a.id;
  // Zooming also answers to + and _ (the shifted = and -) while those keys are the default.
  if (key === '+' && map['view.zoomIn'] === '=') return 'view.zoomIn';
  if (key === '_' && map['view.zoomOut'] === '-') return 'view.zoomOut';
  return null;
}
