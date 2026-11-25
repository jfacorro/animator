import { useEffect, useRef, useState } from 'react';
import { harmony, HARMONIES, hexToHsv, hsvToHex, type Harmony, type Hsv } from '../model/colour';

interface Props {
  color: string;
  onChange: (hex: string) => void;
  /** Colours used lately, newest first. */
  recent: string[];
  harmonyKind: Harmony;
  onHarmonyChange: (h: Harmony) => void;
  onClose: () => void;
}

const SIZE = 200, RING = 18;
const R = SIZE / 2;
/** Half the inner square's side: it fits inside the ring with a small gap. */
const HALF = ((R - RING - 6) * Math.SQRT2) / 2;

/** A hue ring around a saturation/brightness square, plus harmonies and the colours used lately. */
export function ColourPicker({ color, onChange, recent, harmonyKind, onHarmonyChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Keep the hue while the colour is grey or black, where the hex alone loses it.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  useEffect(() => { if (hsvToHex(hsv) !== color.toLowerCase()) setHsv(hexToHsv(color)); }, [color]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const drag = useRef<'ring' | 'square' | null>(null);

  // Close on a click outside or Escape.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.colour-toggle')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = SIZE * dpr; c.height = SIZE * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Hue ring.
    const ring = ctx.createConicGradient(-Math.PI / 2, R, R);
    for (let i = 0; i <= 12; i++) ring.addColorStop(i / 12, hsvToHex({ h: i * 30, s: 1, v: 1 }));
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.arc(R, R, R - RING, 0, Math.PI * 2, true);
    ctx.fillStyle = ring;
    ctx.fill();
    // Saturation left to right, brightness bottom to top.
    const x0 = R - HALF, y0 = R - HALF, side = HALF * 2;
    ctx.fillStyle = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    ctx.fillRect(x0, y0, side, side);
    const white = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white; ctx.fillRect(x0, y0, side, side);
    const black = ctx.createLinearGradient(0, y0, 0, y0 + side);
    black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
    ctx.fillStyle = black; ctx.fillRect(x0, y0, side, side);
    // Markers.
    const mark = (x: number, y: number) => {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    };
    const a = (hsv.h / 180) * Math.PI - Math.PI / 2;
    mark(R + Math.cos(a) * (R - RING / 2), R + Math.sin(a) * (R - RING / 2));
    mark(x0 + hsv.s * side, y0 + (1 - hsv.v) * side);
  }, [hsv]);

  const pick = (e: React.PointerEvent, start: boolean) => {
    const b = canvas.current!.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * SIZE - R, y = ((e.clientY - b.top) / b.height) * SIZE - R;
    if (start) drag.current = Math.hypot(x, y) > R - RING - 3 ? 'ring' : Math.abs(x) <= HALF + 4 && Math.abs(y) <= HALF + 4 ? 'square' : null;
    let next = hsv;
    if (drag.current === 'ring') next = { ...hsv, h: ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360 };
    else if (drag.current === 'square') {
      const k = (t: number) => Math.min(1, Math.max(0, t));
      next = { ...hsv, s: k((x + HALF) / (2 * HALF)), v: k(1 - (y + HALF) / (2 * HALF)) };
    } else return;
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const swatch = (c: string, label: string) => (
    <button key={label} className={`swatch${c === color.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={label} title={c} onClick={() => onChange(c)} />
  );

  return (
    <div ref={ref} className="colour-picker" role="dialog" aria-label="Colour picker">
      <canvas
        ref={canvas} style={{ width: SIZE, height: SIZE, touchAction: 'none' }} aria-label="Colour disc"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e, true); }}
        onPointerMove={(e) => { if (drag.current) pick(e, false); }}
        onPointerUp={() => { drag.current = null; }}
      />
      <label className="row">
        Hex
        <input
          type="text" value={hex} maxLength={7} aria-label="Hex colour" spellCheck={false}
          onChange={(e) => { const v = e.target.value.trim(); setHex(v); const h = v.startsWith('#') ? v : `#${v}`; if (/^#[0-9a-f]{6}$/i.test(h)) onChange(h.toLowerCase()); }}
        />
      </label>
      <div className="colour-section">
        <select value={harmonyKind} aria-label="Harmony" onChange={(e) => onHarmonyChange(e.target.value as Harmony)}>
          {HARMONIES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <div className="swatch-row" role="group" aria-label="Harmony colours">
          {harmony(color, harmonyKind).map((c, i) => swatch(c, `Harmony colour ${i + 1}`))}
        </div>
      </div>
      <div className="colour-section">
        <span className="panel-title">Recent</span>
        <div className="swatch-row" role="group" aria-label="Recent colours">
          {recent.length ? recent.map((c) => swatch(c, `Recent colour ${c}`)) : <span className="hint">Colours you pick show here.</span>}
        </div>
      </div>
    </div>
  );
}
