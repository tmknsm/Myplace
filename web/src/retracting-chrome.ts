import { useEffect } from "react";

/** Class on `<html>` while the header is slid up out of view. */
export const CHROME_RETRACTED_CLASS = "chrome-retracted";

/** Scroll travel in one direction before the header reacts, so a wobble does nothing. */
export const RETRACT_THRESHOLD = 10;

export interface ChromeScroll {
  /** Last scroll position seen. */
  y: number;
  /** Scroll position where the finger last changed direction. */
  turn: number;
  dir: 1 | -1 | 0;
  hidden: boolean;
}

export function initialChromeScroll(y: number): ChromeScroll {
  const clamped = Math.max(0, y);
  return { y: clamped, turn: clamped, dir: 0, hidden: false };
}

/**
 * Where the header should be after a scroll. Down past the header by
 * `threshold` since the last turn hides it; up by `threshold`, or reaching
 * the top, brings it back. Positions past the scroll range (rubber-banding)
 * are clamped so a bounce cannot flip it.
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
  let hidden = state.hidden;
  if (dir === 1 && y > header && y - turn >= threshold) hidden = true;
  if (dir === -1 && (y <= 0 || turn - y >= threshold)) hidden = false;
  return { y, turn, dir, hidden };
}

/**
 * Retract the top bar on the way down a long page and return it on the way
 * up. Focus in the header (the search field) always brings it back.
 */
export function useRetractingChrome(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let state = initialChromeScroll(window.scrollY);
    let frame = 0;
    const commit = (next: ChromeScroll) => {
      const changed = next.hidden !== state.hidden;
      state = next;
      if (changed) root.classList.toggle(CHROME_RETRACTED_CLASS, next.hidden);
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
      if ((event.target as Element | null)?.closest?.(".topbar")) commit({ ...state, hidden: false });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("focusin", onFocusIn);
      root.classList.remove(CHROME_RETRACTED_CLASS);
    };
  }, [enabled]);
}
