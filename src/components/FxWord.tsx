"use client";

import { useRef, type ReactNode } from "react";
import type { FxName } from "@/config/site";

/** Duration of each effect, in ms; keep in sync with --fx-duration in about.css. */
const DURATION: Record<FxName, number> = { rocket: 560, beats: 640, enjoyer: 520 };

const DECORATION: Record<FxName, ReactNode> = {
  rocket: (
    <span className="fx__exhaust" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  ),
  beats: (
    <span className="fx__bars" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  ),
  enjoyer: <span className="fx__scan" aria-hidden="true" />,
};

/**
 * Decorative effect around one word. The readable text is always the only
 * child text node; decoration is empty, aria-hidden elements. The effect plays
 * on pointer hover (pure CSS) and on touch/pen tap (here), and rests in a
 * polished static state otherwise. It is deliberately not a button.
 */
export function FxWord({ fx, children }: { fx: FxName; children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function playOnTap(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.pointerType === "mouse") return; // hover already covers mice
    const element = ref.current;
    if (!element) return;
    clearTimeout(timer.current);
    element.removeAttribute("data-playing");
    // Force a reflow so the animation restarts on repeated taps.
    void element.offsetWidth;
    element.setAttribute("data-playing", "");
    timer.current = setTimeout(() => element.removeAttribute("data-playing"), DURATION[fx] + 60);
  }

  return (
    <span ref={ref} className={`fx fx--${fx}`} onPointerDown={playOnTap}>
      {children}
      {DECORATION[fx]}
    </span>
  );
}
