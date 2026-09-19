import { useEffect } from "react";

/** Class on `<html>` while the whole header is slid up out of view. */
export const CHROME_RETRACTED_CLASS = "chrome-retracted";
/** Class on `<html>` while only the brand row shows; the search row is tucked behind it. */
export const CHROME_TUCKED_CLASS = "chrome-search-tucked";

/** Scroll travel in one direction before the header reacts, so a wobble does nothing. */
export const RETRACT_THRESHOLD = 10;

/** With scroll-driven animations the search row tucks in CSS, following the scroll itself. */
const CSS_TUCK = typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll()");

/**
 * `full` is the whole header with its search row, only at the top of the
 * page. `tucked` is the brand row alone, while reading back up. `hidden`
 * is everything out of view, while reading down.
 */
export type ChromeMode = "full" | "tucked" | "hidden";

export interface ChromeScroll {
  /** Last scroll position seen. */
  y: number;
  /** Scroll position where the finger last changed direction. */
  turn: number;
  dir: 1 | -1 | 0;
  mode: ChromeMode;
}

export function initialChromeScroll(y: number): ChromeScroll {
  const clamped = Math.max(0, y);
  return { y: clamped, turn: clamped, dir: 0, mode: clamped > 0 ? "tucked" : "full" };
}

/**
 * Where the header should be after a scroll. Leaving the top tucks the search
 * row; down past the header by `threshold` since the last turn hides the rest;
 * up by `threshold` brings the brand row back; reaching the top restores the
 * search row. Positions past the scroll range (rubber-banding) are clamped so
 * a bounce cannot flip it.
 */
export function stepChromeScroll(
  state: ChromeScroll,
  rawY: number,
  maxY: number,
  header: number,
  threshold = RETRACT_THRESHOLD,
): ChromeScroll {
  const y = Math.max(0, Math.min(rawY, Math.max(0, maxY)));
  if (y === state.y) return state;
  const dir: 1 | -1 = y > state.y ? 1 : -1;
  const turn = dir === state.dir ? state.turn : state.y;
  let mode = state.mode;
  if (y <= 0) mode = "full";
  else if (dir === 1) {
    if (y > header && y - turn >= threshold) mode = "hidden";
    else if (mode === "full" && y >= threshold) mode = "tucked";
  } else if (mode === "hidden" && turn - y >= threshold) mode = "tucked";
  return { y, turn, dir, mode };
}

/**
 * Retract the top bar on the way down a long page and return it on the way
 * up, keeping the search row for the top of the page. Focus in the header
 * (the search field) always brings the whole thing back.
 */
export function useRetractingChrome(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let state = initialChromeScroll(window.scrollY);
    let frame = 0;
    const paint = (mode: ChromeMode) => {
      root.classList.toggle(CHROME_RETRACTED_CLASS, mode === "hidden");
      root.classList.toggle(CHROME_TUCKED_CLASS, mode === "tucked" && !CSS_TUCK);
    };
    const commit = (next: ChromeScroll) => {
      const changed = next.mode !== state.mode;
      state = next;
      if (changed) paint(next.mode);
    };
    const apply = () => {
      frame = 0;
      const header = Number.parseFloat(getComputedStyle(root).getPropertyValue("--topbar-height")) || 0;
      const maxY = root.scrollHeight - window.innerHeight;
      commit(stepChromeScroll(state, window.scrollY, maxY, header));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as Element | null)?.closest?.(".topbar")) commit({ ...state, mode: "full" });
    };
    paint(state.mode);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("focusin", onFocusIn);
      root.classList.remove(CHROME_RETRACTED_CLASS, CHROME_TUCKED_CLASS);
    };
  }, [enabled]);
}
