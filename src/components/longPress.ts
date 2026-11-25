// Press and hold with a finger or Apple Pencil: the touch version of a right-click.
import { useRef } from 'react';
import type React from 'react';

export const LONG_PRESS_MS = 500;
/** How far a press may wander and still count as held still. */
const SLOP = 10;

export interface LongPress {
  /** Start timing a press. Mouse presses are ignored: they have a right button. */
  start: (e: React.PointerEvent, fire: (x: number, y: number) => void) => void;
  /** Call on pointer move: moving too far cancels the press. */
  move: (e: React.PointerEvent) => void;
  cancel: () => void;
  /** True just after a long press fired, so the click (or native menu) that follows can be ignored. */
  justFired: () => boolean;
  /** Ready-made handlers for an element whose long press does `fire`. */
  bind: (fire: (x: number, y: number) => void) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
}

export function useLongPress(): LongPress {
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const firedAt = useRef(0);
  const api = useRef<LongPress | null>(null);
  if (!api.current) {
    const cancel = () => {
      if (press.current) clearTimeout(press.current.timer);
      press.current = null;
    };
    const start: LongPress['start'] = (e, fire) => {
      cancel();
      if (e.pointerType === 'mouse') return;
      const { clientX: x, clientY: y, pointerId: id } = e;
      const timer = window.setTimeout(() => {
        press.current = null;
        firedAt.current = Date.now();
        fire(x, y);
      }, LONG_PRESS_MS);
      press.current = { id, x, y, timer };
    };
    const move: LongPress['move'] = (e) => {
      const p = press.current;
      if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancel();
    };
    const justFired = () => Date.now() - firedAt.current < 800;
    api.current = {
      start, move, cancel, justFired,
      bind: (fire) => ({
        onPointerDown: (e) => start(e, fire),
        onPointerMove: move,
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onClickCapture: (e) => {
          if (!justFired()) return;
          e.preventDefault();
          e.stopPropagation();
        },
      }),
    };
  }
  return api.current;
}
