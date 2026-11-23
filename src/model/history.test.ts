import { expect, it } from 'vitest';
import { commit, initHistory, redo, undo } from './history';

it('undoes and redoes commits', () => {
  let h = initHistory(1);
  h = commit(h, 2);
  h = commit(h, 3);
  h = undo(h);
  expect(h.present).toBe(2);
  h = redo(h);
  expect(h.present).toBe(3);
  h = undo(undo(h));
  expect(h.present).toBe(1);
  expect(undo(h)).toBe(h);
  h = commit(h, 9);
  expect(h.future).toEqual([]);
});
