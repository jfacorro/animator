import { describe, expect, it } from 'vitest';
import { sequenceName } from './video';

describe('image sequence names', () => {
  it('numbers frames from 1 with at least four digits', () => {
    expect(sequenceName('walk', 0, 24)).toBe('walk_0001.png');
    expect(sequenceName('walk', 23, 24)).toBe('walk_0024.png');
    expect(sequenceName('walk', 0, 12000)).toBe('walk_00001.png');
  });
});
