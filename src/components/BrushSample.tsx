import { memo, useEffect, useRef } from 'react';
import type { BrushPreset } from '../model/brushes';
import type { Point, Stroke } from '../model/project';
import { paintStroke } from '../render/render';

const W = 40, H = 24;

/** A short wavy test line that presses harder in the middle. */
function samplePoints(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([5 + t * (W - 10), H / 2 + Math.sin(t * Math.PI * 2) * 5, 0.25 + 0.75 * Math.sin(t * Math.PI)]);
  }
  return pts;
}
const POINTS = samplePoints();

/** A brush shown as a little line drawn with it, to stand for the brush on its button. */
export const BrushSample = memo(function BrushSample({ brush }: { brush: BrushPreset }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Big brushes are drawn smaller so they fit, but still wider than thin ones.
    const size = Math.min(10, Math.max(1.5, Math.sqrt(brush.size) * 1.6));
    const s: Stroke = {
      points: POINTS, color: '#e9e6df', size, erase: false, smoothing: brush.smoothing,
      simulatePressure: false, thinning: brush.thinning,
      ...(brush.opacity < 1 ? { opacity: brush.opacity } : {}),
      ...(brush.softness > 0 ? { softness: brush.softness } : {}),
      ...(brush.grain && brush.grain !== 'none' && (brush.grainAmount ?? 0) > 0 ? { grain: { kind: brush.grain, amount: brush.grainAmount! } } : {}),
    };
    paintStroke(ctx, s, true);
  }, [brush]);
  return <canvas ref={canvas} className="brush-sample" style={{ width: W, height: H }} aria-hidden="true" />;
});
