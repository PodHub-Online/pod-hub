"use client";

import React from "react";
import { useSide } from "~/components/sideContext";

export const SIDE_ORDER = ["left", "right", "both"] as const;

/**
 * Swipe sideways to change side: the content follows the finger, the bed-icon picker's
 * highlight moves with it, and the order loops Left → Right → Whole bed → Left.
 * Spread `handlers` on the wrapper and give it `ref={deck}`.
 */
export function useSideSwipe() {
  const { selected, select } = useSide();
  const deck = React.useRef<HTMLDivElement>(null);
  const touch = React.useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const lastSide = React.useRef(selected);
  const swipeDir = React.useRef<number | null>(null);

  // after a swipe, slide the new view in from the side it came from; a tap on the picker
  // or the bed just changes the view in place (only the picker highlight moves)
  React.useEffect(() => {
    if (lastSide.current === selected) return;
    lastSide.current = selected;
    const dir = swipeDir.current;
    swipeDir.current = null;
    if (dir === null) return;
    deck.current?.animate(
      [
        { transform: `translateX(${dir * 45}%)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }, [selected]);

  const setDrag = (dx: number) => {
    // move the picker highlight along with the finger: one full card width = one step
    const root = document.documentElement;
    const width = deck.current?.offsetWidth ?? 320;
    if (dx) {
      root.style.setProperty("--side-drag", String(-dx / width));
      root.setAttribute("data-side-dragging", "");
    } else {
      root.style.removeProperty("--side-drag");
      root.removeAttribute("data-side-dragging");
    }
    if (!deck.current) return;
    deck.current.style.transform = dx ? `translateX(${dx}px)` : "";
    deck.current.style.opacity = dx ? String(Math.max(0.4, 1 - Math.abs(dx) / 400)) : "";
  };

  const onTouchStart = (e: React.TouchEvent) => {
    // dragging on the 3D bed turns the bed; sliders (and anything marked data-no-swipe, like the temperature knob) and time pickers keep their own drag
    if ((e.target as HTMLElement).closest("canvas, input, select, textarea, [data-no-swipe]")) return;
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY, dragging: false } : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t0 = touch.current;
    const p = e.touches[0];
    if (!t0 || !p) return;
    const dx = p.clientX - t0.x;
    const dy = p.clientY - t0.y;
    if (!t0.dragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) t0.dragging = true;
    if (t0.dragging) setDrag(dx * 0.7);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!t0?.dragging || !p) return setDrag(0);
    const dx = p.clientX - t0.x;
    if (Math.abs(dx) < 60) {
      // not far enough: spring back
      setDrag(0);
      deck.current?.animate([{ transform: `translateX(${dx * 0.7}px)` }, { transform: "translateX(0)" }], { duration: 180 });
      return;
    }
    const dir = dx < 0 ? 1 : -1;
    setDrag(0);
    swipeDir.current = dir;
    // tells the picker this came from a swipe, so going past an end loops instead of going back
    document.documentElement.setAttribute("data-side-swiped", "");
    select(SIDE_ORDER[(SIDE_ORDER.indexOf(selected) + dir + 3) % 3]!);
  };

  return { deck, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
