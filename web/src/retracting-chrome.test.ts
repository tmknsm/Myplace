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
  test("starts full at the top and tucked anywhere else", () => {
    expect(initialChromeScroll(0).mode).toBe("full");
    expect(initialChromeScroll(500).mode).toBe("tucked");
  });

  test("a nudge off the top keeps the search row", () => {
    expect(run([RETRACT_THRESHOLD - 1]).mode).toBe("full");
  });

  test("leaving the top tucks the search row while the brand row stays", () => {
    expect(run([20, 60, 100]).mode).toBe("tucked");
  });

  test("hides everything after scrolling down past the header", () => {
    expect(run([80, 160, 200]).mode).toBe("hidden");
  });

  test("a wobble smaller than the threshold does nothing", () => {
    const hidden = run([200, 400]);
    expect(hidden.mode).toBe("hidden");
    expect(stepChromeScroll(hidden, 400 - RETRACT_THRESHOLD + 1, MAX, HEADER).mode).toBe("hidden");
  });

  test("scrolling up by the threshold returns the brand row only", () => {
    const hidden = run([200, 400]);
    expect(stepChromeScroll(hidden, 400 - RETRACT_THRESHOLD, MAX, HEADER).mode).toBe("tucked");
  });

  test("measures the return from the turning point, not from the last frame", () => {
    let state = run([200, 400]);
    state = stepChromeScroll(state, 396, MAX, HEADER);
    state = stepChromeScroll(state, 392, MAX, HEADER);
    expect(state.mode).toBe("hidden");
    state = stepChromeScroll(state, 388, MAX, HEADER);
    expect(state.mode).toBe("tucked");
  });

  test("the search row only comes back at the very top", () => {
    let state = run([200, 400, 300, 100, 20]);
    expect(state.mode).toBe("tucked");
    state = stepChromeScroll(state, 0, MAX, HEADER);
    expect(state.mode).toBe("full");
  });

  test("reaching the top from hidden restores the whole header", () => {
    const hidden = run([200, 400]);
    expect(stepChromeScroll(hidden, 0, MAX, HEADER).mode).toBe("full");
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
    expect(state.mode).toBe("tucked");
  });
});
