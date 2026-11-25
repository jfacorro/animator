import { useRef } from 'react';

interface Props {
  /** Which panel this handle sizes: it sits on that panel's inner edge. */
  side: 'left' | 'right' | 'bottom' | 'top';
  label: string;
  collapsed: boolean;
  /** Pixels moved since the drag started, toward the stage being positive for the panel growing. Leave out for a bar that only hides. */
  onResize?: (grow: number, done: boolean) => void;
  onToggle: () => void;
}

/** A drag handle between a panel and the stage, with a button to hide or show the panel. */
export function Splitter({ side, label, collapsed, onResize, onToggle }: Props) {
  const start = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const vertical = side === 'left' || side === 'right';
  const grow = (e: React.PointerEvent, s: { x: number; y: number }) => {
    return side === 'left' ? e.clientX - s.x : side === 'right' ? s.x - e.clientX : side === 'top' ? e.clientY - s.y : s.y - e.clientY;
  };
  const arrow = side === 'left' ? (collapsed ? '›' : '‹') : side === 'right' ? (collapsed ? '‹' : '›') : side === 'top' ? (collapsed ? '˅' : '˄') : collapsed ? '˄' : '˅';

  return (
    <div
      className={`splitter ${vertical ? 'vertical' : 'horizontal'} ${side}${collapsed ? ' collapsed' : ''}${onResize ? '' : ' fixed'}`}
      role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-label={`Resize ${label}`}
      title={collapsed ? `Show ${label}` : onResize ? `Drag to resize ${label}. Double-click to hide it.` : `Double-click to hide ${label}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        if (collapsed || !onResize) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        s.moved = true;
        onResize?.(grow(e, s), false);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (s?.moved) onResize?.(grow(e, s), true);
      }}
      onPointerCancel={() => { start.current = null; }}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onToggle(); }}
      onClick={() => { if (collapsed) onToggle(); }}
    >
      <button className="splitter-btn" aria-label={collapsed ? `Show ${label}` : `Hide ${label}`} title={collapsed ? `Show ${label}` : `Hide ${label} (Tab hides or shows all panels)`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {arrow}
      </button>
    </div>
  );
}
