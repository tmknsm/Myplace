import { describe, expect, test } from "vitest";
import { initialChromeScroll, RETRACT_THRESHOLD, stepChromeScroll } from "./retracting-chrome";

const HEADER = 120;
const MAX = 3000;

function run(positions: number[], start = 0) {
  let state = initialChromeScroll(start);
  for (const y of positions) state = stepChromeScroll(state, y, MAX, HEADER);
  return state;
}

describe("stepChromeScroll", () => {
  test("stays put while the header is still over the top of the page", () => {
    expect(run([20, 60, 100]).hidden).toBe(false);
  });

  test("hides after scrolling down past the header", () => {
    expect(run([80, 160, 200]).hidden).toBe(true);
  });

  test("a wobble smaller than the threshold does nothing", () => {
    const hidden = run([200, 400]);
    expect(hidden.hidden).toBe(true);
    const nudged = stepChromeScroll(hidden, 400 - RETRACT_THRESHOLD + 1, MAX, HEADER);
    expect(nudged.hidden).toBe(true);
  });

  test("returns after scrolling up by the threshold", () => {
    const hidden = run([200, 400]);
    expect(stepChromeScroll(hidden, 400 - RETRACT_THRESHOLD, MAX, HEADER).hidden).toBe(false);
  });

  test("measures the return from the turning point, not from the last frame", () => {
    let state = run([200, 400]);
    state = stepChromeScroll(state, 396, MAX, HEADER);
    state = stepChromeScroll(state, 392, MAX, HEADER);
    expect(state.hidden).toBe(true);
    state = stepChromeScroll(state, 388, MAX, HEADER);
    expect(state.hidden).toBe(false);
  });

  test("reaching the top always shows the header", () => {
    const hidden = run([200, 400]);
    expect(stepChromeScroll(hidden, 0, MAX, HEADER).hidden).toBe(false);
  });

  test("rubber-banding past either end is ignored", () => {
    const top = stepChromeScroll(initialChromeScroll(0), -40, MAX, HEADER);
    expect(top).toEqual(initialChromeScroll(0));
    const hidden = run([200, MAX]);
    expect(stepChromeScroll(hidden, MAX + 60, MAX, HEADER)).toBe(hidden);
  });

  test("a short page that cannot scroll past the header never hides it", () => {
    let state = initialChromeScroll(0);
    for (const y of [40, 80, 100]) state = stepChromeScroll(state, y, 100, HEADER);
    expect(state.hidden).toBe(false);
  });
});
