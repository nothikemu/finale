"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

const CELL_SELECTOR = "rect[data-row][data-col]";

/**
 * Adds hover, tap and keyboard interaction to the server-rendered calendar
 * without hydrating its 370-odd cells: it only attaches delegated handlers.
 * The details shown mirror each cell's aria-label, so the tooltip is an
 * equivalent of what assistive technology already reads. It appears on
 * pointer hover, on tap, and on keyboard focus: never on hover alone.
 */
export function CalendarInteractive({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  // The tapped cell, so touch/pen users can dismiss by tapping again or elsewhere.
  const pinned = useRef<Element | null>(null);

  const show = useCallback((cell: Element) => {
    const text = cell.getAttribute("aria-label");
    if (!text) return;
    const box = cell.getBoundingClientRect();
    const below = box.top < 56;
    setTip({
      text,
      x: Math.min(Math.max(box.left + box.width / 2, 130), window.innerWidth - 130),
      y: below ? box.bottom + 8 : box.top - 8,
      below,
    });
  }, []);

  const hide = useCallback(() => {
    pinned.current = null;
    setTip(null);
  }, []);

  useEffect(() => {
    if (!tip) return;
    // Positions are viewport-relative, so any scroll or resize invalidates them.
    const dismiss = () => hide();
    window.addEventListener("scroll", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerdown", outside);
    // Escape dismisses a tooltip however it was opened (a hover has no key handler of its own).
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [tip, hide]);

  const cellFrom = (target: EventTarget) => (target as Element).closest?.(CELL_SELECTOR) ?? null;

  function onPointerOver(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const cell = cellFrom(event.target);
    if (cell) show(cell);
  }

  function onPointerOut(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    // Keep the tooltip while a cell has keyboard focus.
    if (!root.current?.contains(document.activeElement) || document.activeElement === document.body) hide();
  }

  function onClick(event: React.MouseEvent) {
    // Mouse clicks are already covered by hover; touch and pen need an explicit tap.
    if ((event.nativeEvent as globalThis.PointerEvent).pointerType === "mouse") return;
    const cell = cellFrom(event.target);
    if (!cell) return;
    if (pinned.current === cell) {
      hide();
    } else {
      pinned.current = cell;
      show(cell);
    }
  }

  function onFocus(event: React.FocusEvent) {
    const cell = cellFrom(event.target);
    if (!cell) return;
    // Roving tabindex: the focused cell becomes the only tab stop.
    root.current?.querySelectorAll(`${CELL_SELECTOR}[tabindex="0"]`).forEach((other) => other.setAttribute("tabindex", "-1"));
    cell.setAttribute("tabindex", "0");
    show(cell);
  }

  function onBlur(event: React.FocusEvent) {
    if (!root.current?.contains(event.relatedTarget as Node | null)) hide();
  }

  function onKeyDown(event: KeyboardEvent) {
    const cell = cellFrom(event.target) as SVGRectElement | null;
    if (!cell) return;
    if (event.key === "Escape") {
      hide();
      return;
    }
    let row = Number(cell.dataset.row);
    let col = Number(cell.dataset.col);
    switch (event.key) {
      case "ArrowUp":
        row -= 1;
        break;
      case "ArrowDown":
        row += 1;
        break;
      case "ArrowLeft":
        col -= 1;
        break;
      case "ArrowRight":
        col += 1;
        break;
      case "Home":
        col = Number.MIN_SAFE_INTEGER; // the first cell that exists in this row (the first week can be partial)
        break;
      case "End":
        col = Number.MAX_SAFE_INTEGER;
        break;
      default:
        return;
    }
    event.preventDefault();
    const cells = Array.from(root.current?.querySelectorAll<SVGRectElement>(`${CELL_SELECTOR}[data-row="${row}"]`) ?? []);
    const extreme = (better: (a: number, b: number) => boolean) =>
      cells.reduce<SVGRectElement | undefined>((a, b) => (!a || better(Number(b.dataset.col), Number(a.dataset.col)) ? b : a), undefined);
    const target =
      col === Number.MAX_SAFE_INTEGER
        ? extreme((b, a) => b > a)
        : col === Number.MIN_SAFE_INTEGER
          ? extreme((b, a) => b < a)
          : cells.find((candidate) => Number(candidate.dataset.col) === col);
    target?.focus({ preventScroll: false });
  }

  return (
    <div
      ref={root}
      className="calendar__interactive"
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {children}
      {/* Portalled: a backdrop-filter ancestor would otherwise become the containing block for position: fixed. */}
      {tip
        ? createPortal(
            <div className={`tooltip${tip.below ? " tooltip--below" : ""}`} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
