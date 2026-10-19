"use client";

import { useEffect } from "react";
import { site } from "@/config/site";

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const BLOCKED = ["contextmenu", "copy", "cut", "dragstart", "selectstart"] as const;

function inEditable(target: EventTarget | null) {
  // selectstart reports a text node; its element is the parent.
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(EDITABLE) != null;
}

/**
 * Blocks right-click, copy, cut, selecting and dragging for the whole page (see site.protectContent).
 * base.css does the same without JavaScript by making nothing selectable; this covers the menu, the
 * copy events and the browsers that ignore that rule. Form fields, if one is ever added, stay usable.
 * `data-guard` on <html> says the listeners are attached. Renders nothing.
 */
export function ContentGuard() {
  useEffect(() => {
    if (!site.protectContent) return;
    const block = (event: Event) => {
      if (!inEditable(event.target)) event.preventDefault();
    };
    // Capture phase, so nothing on the page can answer these events first.
    for (const type of BLOCKED) document.addEventListener(type, block, true);
    document.documentElement.setAttribute("data-guard", "on");
    return () => {
      for (const type of BLOCKED) document.removeEventListener(type, block, true);
      document.documentElement.removeAttribute("data-guard");
    };
  }, []);
  return null;
}
