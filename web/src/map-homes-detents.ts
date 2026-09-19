import { AXIS_LOCK, DISMISS_DISTANCE, DISMISS_FLICK_MIN, DISMISS_VELOCITY, type SheetDragMode } from "./dismiss-gesture";

/**
 * The map's homes sheet rests at one of three heights. `collapsed` is the
 * "n homes" header alone, `peek` shows most of the first card, and `full`
 * docks under the search bar with the whole list scrolling inside.
 */
export type HomesDetent = "collapsed" | "peek" | "full";

export const DETENT_ORDER: readonly HomesDetent[] = ["collapsed", "peek", "full"];

/** Visible sheet height at each detent, in px. */
export type DetentHeights = Record<HomesDetent, number>;

/** How much of the first card the peek detent reveals. */
export const PEEK_CARD_FRACTION = 2 / 3;

/** Smallest jump between two detents, so a squat sheet still has three distinct stops. */
const MIN_STEP = 48;

/**
 * Work out the three resting heights from what is on screen. The peek height
 * follows the first card so about two thirds of it shows; before the card has
 * been measured, or when there is no card, it falls back to a share of the
 * sheet. Every detent stays at least `MIN_STEP` from its neighbors.
 */
export function detentHeights(input: {
  sheetHeight: number;
  headHeight: number;
  cardHeight: number | null;
}): DetentHeights {
  const full = Math.max(0, input.sheetHeight);
  const collapsed = Math.min(full, Math.max(0, input.headHeight));
  const wanted = input.cardHeight && input.cardHeight > 0
    ? collapsed + input.cardHeight * PEEK_CARD_FRACTION
    : collapsed + full * 0.36;
  const peek = Math.min(Math.max(wanted, collapsed + MIN_STEP), Math.max(collapsed, full - MIN_STEP));
  return { collapsed, peek, full };
}

/** The detent one step taller (`1`) or shorter (`-1`); the ends stay put. */
export function stepDetent(current: HomesDetent, direction: 1 | -1): HomesDetent {
  const index = DETENT_ORDER.indexOf(current);
  const next = DETENT_ORDER[index + direction];
  return next ?? current;
}

/**
 * Where the sheet comes to rest after a drag. `dy` is finger travel with
 * down positive, `velocity` in px/ms with the same sign. A sheet moves at
 * most one detent per gesture: a decent pull or a short flick steps to the
 * neighbor in that direction, anything less springs back.
 */
export function settleDetent(
  current: HomesDetent,
  dy: number,
  velocity: number,
  heights: DetentHeights,
): HomesDetent {
  if (dy === 0) return current;
  const direction: 1 | -1 = dy < 0 ? 1 : -1;
  const target = stepDetent(current, direction);
  if (target === current) return current;
  const step = Math.abs(heights[target] - heights[current]);
  const traveled = Math.abs(dy);
  const threshold = Math.min(DISMISS_DISTANCE, Math.max(40, step * 0.25));
  if (traveled >= threshold) return target;
  const sameWay = Math.sign(velocity) === Math.sign(dy);
  if (traveled >= DISMISS_FLICK_MIN && sameWay && Math.abs(velocity) >= DISMISS_VELOCITY) return target;
  return current;
}

/**
 * Visible height while the finger is down. Inside the range the sheet tracks
 * the finger; past either end it gives a little, like an iOS sheet, instead
 * of stopping dead.
 */
export function dragVisibleHeight(base: number, dy: number, heights: DetentHeights): number {
  const raw = base - dy;
  if (raw > heights.full) return heights.full + (raw - heights.full) * 0.16;
  if (raw < heights.collapsed) return heights.collapsed - (heights.collapsed - raw) * 0.16;
  return raw;
}

/**
 * Whether a press on the sheet's body moves the sheet or scrolls the list.
 * Below `full` the list never scrolls, so any travel drags the sheet. At
 * `full` the list owns the gesture unless it is already at the top and the
 * finger is pulling down.
 */
export function homesDragMode(
  dy: number,
  detent: HomesDetent,
  listAtTop: boolean,
  threshold = AXIS_LOCK,
): SheetDragMode {
  if (Math.abs(dy) < threshold) return "pending";
  if (detent !== "full") return "sheet";
  return dy > 0 && listAtTop ? "sheet" : "scroll";
}

/** Tapping the header: a collapsed sheet opens to peek, peek opens fully, full returns to peek. */
export function toggleDetent(current: HomesDetent): HomesDetent {
  return current === "full" ? "peek" : stepDetent(current, 1);
}

/**
 * The part of the map the sheet is not covering, used to count what is in
 * view. When the sheet is full the map is hidden anyway, so the count keeps
 * describing the peek view rather than dropping to nothing.
 */
export function mapInsetFor(detent: HomesDetent, heights: DetentHeights): number {
  return detent === "full" ? heights.peek : heights[detent];
}

export function homesTitle(count: number | null): string {
  if (count === null) return "Homes in view";
  if (count === 0) return "No homes in view";
  return `${count.toLocaleString("en-US")} ${count === 1 ? "home" : "homes"}`;
}
