import { useRef, useState } from 'react';

const THRESHOLD = 5; // px of movement before a press becomes a drag

interface Press {
  id: string;
  pointerId: number;
  y: number;
  dragging: boolean;
  list: HTMLElement | null;
}

/**
 * Drag layer rows up and down in a list shown top layer first. Rows need a
 * `data-layer-row` attribute. `onDrop` gets the layer and the gap it was
 * dropped in, counted bottom to top (see moveLayerToGap).
 */
export function useLayerDrag(count: number, onDrop: (layerId: string, gap: number) => void) {
  const pressRef = useRef<Press | null>(null);
  /** Set right after a drag so the click that ends it doesn't select the row. */
  const justDragged = useRef(false);
  const [drag, setDrag] = useState<{ id: string; slot: number } | null>(null);

  /** Gap under the pointer, counted top to bottom in the list as shown. */
  const slotAt = (list: HTMLElement | null, clientY: number) => {
    const rows = [...(list?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? [])];
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return clientY < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };

  const rowProps = (id: string) => ({
    'data-layer-row': id,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
      pressRef.current = { id, pointerId: e.pointerId, y: e.clientY, dragging: false, list: e.currentTarget.parentElement };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = pressRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      if (!p.dragging) {
        if (Math.abs(e.clientY - p.y) < THRESHOLD) return;
        p.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setDrag({ id: p.id, slot: slotAt(p.list, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const p = pressRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      pressRef.current = null;
      if (!p.dragging) return;
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
      setDrag(null);
      onDrop(p.id, count - slotAt(p.list, e.clientY));
    },
    onPointerCancel: () => {
      pressRef.current = null;
      setDrag(null);
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (justDragged.current) e.stopPropagation();
    },
  });

  /** Class for a row: the dragged one, and where the drop line shows. */
  const rowClass = (id: string, index: number) => {
    if (!drag) return '';
    const parts = [];
    if (drag.id === id) parts.push('dragging');
    if (drag.slot === index) parts.push('drop-before');
    if (drag.slot === count && index === count - 1) parts.push('drop-after');
    return parts.length ? ` ${parts.join(' ')}` : '';
  };

  return { rowProps, rowClass };
}
