import { useEffect, useRef, type RefObject } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';
export const screenEdge = (x: number) => x <= 24 ? 'left' : x >= window.innerWidth - 24 ? 'right' : null;

// Capture only gestures claimed at their start. A second finger always cancels
// navigation and passes through to the image's pinch controls.
export function useTouchSwipe(target: RefObject<HTMLElement | null> | null,
  begin: (x: number, y: number, target: EventTarget | null) => ((direction: SwipeDirection) => void) | null,
  horizontalOnly = false) {
  const callback = useRef(begin);
  callback.current = begin;
  useEffect(() => {
    const surface = target?.current ?? window;
    let gesture: { x: number; y: number; id: number; action(direction: SwipeDirection): void; direction?: SwipeDirection } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) { gesture = null; return; }
      const touch = event.touches[0];
      const action = callback.current(touch.clientX, touch.clientY, event.target);
      gesture = action ? { x: touch.clientX, y: touch.clientY, id: touch.identifier, action } : null;
      if (gesture) event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) { gesture = null; return; }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      if (!gesture.direction) {
        if (horizontalOnly && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
        gesture.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      }
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const end = (event: TouchEvent) => {
      const finished = gesture; gesture = null;
      if (!finished || event.touches.length) return;
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === finished.id);
      if (!touch) return;
      const dx = touch.clientX - finished.x, dy = touch.clientY - finished.y;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.25;
      const direction = horizontal && Math.abs(dx) >= 60 ? (dx < 0 ? 'left' : 'right')
        : !horizontalOnly && vertical && Math.abs(dy) >= 60 ? (dy < 0 ? 'up' : 'down') : null;
      if (direction) { if (event.cancelable) event.preventDefault(); finished.action(direction); }
      event.stopPropagation();
    };
    const cancel = () => { gesture = null; };
    const options = { capture: true, passive: false };
    surface.addEventListener('touchstart', start as EventListener, options);
    surface.addEventListener('touchmove', move as EventListener, options);
    surface.addEventListener('touchend', end as EventListener, options);
    surface.addEventListener('touchcancel', cancel, options);
    return () => {
      surface.removeEventListener('touchstart', start as EventListener, options);
      surface.removeEventListener('touchmove', move as EventListener, options);
      surface.removeEventListener('touchend', end as EventListener, options);
      surface.removeEventListener('touchcancel', cancel, options);
    };
  }, [target, horizontalOnly]);
}
