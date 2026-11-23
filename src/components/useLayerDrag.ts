import { useRef, useState } from 'react';

const THRESHOLD = 5; // px of movement before a press becomes a drag

/** Where a drop lands: a gap in the stack (counted bottom to top) and the group it joins, if any. */
export interface Drop {
  gap: number;
  group: string | null;
}

export type DragKind = 'layer' | 'group';

interface Press {
  key: string;
  id: string;
  kind: DragKind;
  pointerId: number;
  y: number;
  dragging: boolean;
  list: HTMLElement | null;
}

interface Target {
  row: string;
  half: 'above' | 'below';
  drop: Drop;
}

/**
 * Drag rows of a layer list up and down. Each row says where a drop just
 * above or below it lands; `onDrop` gets the dragged layer or group and that spot.
 */
export function useLayerDrag(onDrop: (id: string, kind: DragKind, drop: Drop) => void) {
  const pressRef = useRef<Press | null>(null);
  /** Set right after a drag so the click that ends it doesn't select the row. */
  const justDragged = useRef(false);
  const [drag, setDrag] = useState<{ key: string; target: Target | null } | null>(null);

  const targetAt = (list: HTMLElement | null, clientY: number): Target | null => {
    const rows = [...(list?.querySelectorAll<HTMLElement>('[data-drop-row]') ?? [])];
    if (!rows.length) return null;
    let row = rows.find((r) => clientY < r.getBoundingClientRect().bottom) ?? rows[rows.length - 1];
    const b = row.getBoundingClientRect();
    const half = clientY < b.top + b.height / 2 ? 'above' : 'below';
    const data = JSON.parse(row.dataset.dropRow!) as { above: Drop; below: Drop };
    if (clientY > b.bottom) row = rows[rows.length - 1];
    return { row: row.dataset.rowKey!, half, drop: data[half] };
  };

  const rowProps = (key: string, id: string, kind: DragKind, above: Drop, below: Drop) => ({
    'data-drop-row': JSON.stringify({ above, below }),
    'data-row-key': key,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
      pressRef.current = { key, id, kind, pointerId: e.pointerId, y: e.clientY, dragging: false, list: e.currentTarget.parentElement };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = pressRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      if (!p.dragging) {
        if (Math.abs(e.clientY - p.y) < THRESHOLD) return;
        p.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setDrag({ key: p.key, target: targetAt(p.list, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const p = pressRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      pressRef.current = null;
      if (!p.dragging) return;
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
      setDrag(null);
      const t = targetAt(p.list, e.clientY);
      if (t) onDrop(p.id, p.kind, t.drop);
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
  const rowClass = (key: string) => {
    if (!drag) return '';
    const parts = [];
    if (drag.key === key) parts.push('dragging');
    if (drag.target?.row === key) parts.push(drag.target.half === 'above' ? 'drop-before' : 'drop-after');
    return parts.length ? ` ${parts.join(' ')}` : '';
  };

  return { rowProps, rowClass };
}

/** Drop spots around a layer row at stack index `index`. */
export const layerDrops = (index: number, group: string | undefined) => ({
  above: { gap: index + 1, group: group ?? null },
  below: { gap: index, group: group ?? null },
});
