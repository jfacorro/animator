import { describe, expect, it } from 'vitest';
import { actionFor, assignKey, DEFAULT_KEYMAP, displayKey, isReserved, keyOf, loadKeymap } from './keys';

const press = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  keyOf({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('keyboard shortcuts', () => {
  it('names key presses', () => {
    expect(press('B')).toBe('b');
    expect(press('R', { shiftKey: true })).toBe('shift+r');
    expect(press('+', { shiftKey: true })).toBe('+');
    expect(press('F2', { shiftKey: true })).toBe('shift+f2');
    expect(press('z', { ctrlKey: true })).toBeNull();
    expect(press('Shift', { shiftKey: true })).toBeNull();
    expect(displayKey('shift+r')).toBe('Shift+R');
    expect(displayKey('f2')).toBe('F2');
    expect(displayKey('')).toBe('—');
  });

  it('finds the action for a key, with + and _ for zoom', () => {
    expect(actionFor(DEFAULT_KEYMAP, 'b')).toBe('tool.brush');
    expect(actionFor(DEFAULT_KEYMAP, 'shift+r')).toBe('rulers.toggle');
    expect(actionFor(DEFAULT_KEYMAP, '+')).toBe('view.zoomIn');
    expect(actionFor(DEFAULT_KEYMAP, 'q')).toBeNull();
  });

  it('moves a key from the action that had it', () => {
    const { map, displaced } = assignKey(DEFAULT_KEYMAP, 'tool.text', 'b');
    expect(map['tool.text']).toBe('b');
    expect(map['tool.brush']).toBe('');
    expect(displaced).toBe('tool.brush');
    expect(actionFor(map, 'b')).toBe('tool.text');
    expect(actionFor(map, 't')).toBeNull();
  });

  it('loads saved shortcuts, ignoring broken or reserved ones', () => {
    const map = loadKeymap({ 'tool.brush': 'p', 'tool.eraser': ' ', 'tool.line': 3, nonsense: 'x' });
    expect(map['tool.brush']).toBe('p');
    expect(map['tool.eraser']).toBe('e');
    expect(map['tool.line']).toBe('l');
    expect(isReserved('shift+tab')).toBe(true);
    expect(loadKeymap(null)).toEqual(DEFAULT_KEYMAP);
  });
});
