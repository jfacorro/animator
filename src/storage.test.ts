import { describe, expect, it } from 'vitest';
import { projectJson } from './storage';
import { addStroke, createProject, type Stroke } from './model/project';

const stroke: Stroke = { points: [[1, 2, 0.5], [3, 4, 0.5]], color: '#123456', size: 3, erase: false, smoothing: 0.5, simulatePressure: false, thinning: 0 };

describe('project files', () => {
  it('writes the same JSON as JSON.stringify, before and after an edit', () => {
    let p = createProject('Walk "cycle"');
    expect(projectJson(p)).toBe(JSON.stringify(p));
    p = addStroke(p, p.layers[1].id, 0, stroke);
    expect(projectJson(p)).toBe(JSON.stringify(p));
    expect(JSON.parse(projectJson(p))).toEqual(p);
  });

  it('copes with a project with no drawings', () => {
    const p = { ...createProject(), drawings: {} };
    expect(JSON.parse(projectJson(p))).toEqual(p);
  });
});
