import { describe, expect, test } from "vitest";
import {
  detentHeights,
  dragVisibleHeight,
  homesDragMode,
  homesTitle,
  mapInsetFor,
  settleDetent,
  SHEET_TOP_RADIUS,
  sheetTopRadius,
  stepDetent,
  toggleDetent,
} from "./map-homes-detents";

const heights = detentHeights({ sheetHeight: 700, headHeight: 56, cardHeight: 330 });

describe("detentHeights", () => {
  test("collapsed is the header, peek shows two thirds of the first card, full is the sheet", () => {
    expect(heights.collapsed).toBe(56);
    expect(heights.peek).toBe(56 + 220);
    expect(heights.full).toBe(700);
  });

  test("without a card the peek falls back to a share of the sheet", () => {
    const fallback = detentHeights({ sheetHeight: 700, headHeight: 56, cardHeight: null });
    expect(fallback.peek).toBeGreaterThan(fallback.collapsed);
    expect(fallback.peek).toBeLessThan(fallback.full);
  });

  test("a tall card never pushes the peek stop onto the full stop", () => {
    const squat = detentHeights({ sheetHeight: 400, headHeight: 56, cardHeight: 900 });
    expect(squat.peek).toBeLessThan(squat.full);
    expect(squat.peek - squat.collapsed).toBeGreaterThanOrEqual(48);
  });
});

describe("stepDetent and toggleDetent", () => {
  test("steps one stop at a time and stops at the ends", () => {
    expect(stepDetent("collapsed", 1)).toBe("peek");
    expect(stepDetent("peek", 1)).toBe("full");
    expect(stepDetent("full", 1)).toBe("full");
    expect(stepDetent("full", -1)).toBe("peek");
    expect(stepDetent("peek", -1)).toBe("collapsed");
    expect(stepDetent("collapsed", -1)).toBe("collapsed");
  });

  test("tapping the header opens up, and brings a full sheet back to peek", () => {
    expect(toggleDetent("collapsed")).toBe("peek");
    expect(toggleDetent("peek")).toBe("full");
    expect(toggleDetent("full")).toBe("peek");
  });
});

describe("settleDetent", () => {
  test("a swipe up from peek docks the sheet", () => {
    expect(settleDetent("peek", -140, -0.2, heights)).toBe("full");
  });

  test("a swipe down from full returns to peek, not straight to collapsed", () => {
    expect(settleDetent("full", 600, 1.2, heights)).toBe("peek");
  });

  test("a swipe down from peek collapses to the header", () => {
    expect(settleDetent("peek", 120, 0.4, heights)).toBe("collapsed");
  });

  test("a swipe up from collapsed returns to peek", () => {
    expect(settleDetent("collapsed", -90, -0.5, heights)).toBe("peek");
  });

  test("a short flick counts even without much travel", () => {
    expect(settleDetent("peek", -24, -0.6, heights)).toBe("full");
  });

  test("a slow nudge springs back", () => {
    expect(settleDetent("peek", -20, -0.05, heights)).toBe("peek");
    expect(settleDetent("full", 30, 0.1, heights)).toBe("full");
  });

  test("a flick the wrong way for the travel does not step", () => {
    expect(settleDetent("peek", -24, 0.6, heights)).toBe("peek");
  });

  test("the ends stay put", () => {
    expect(settleDetent("collapsed", 300, 2, heights)).toBe("collapsed");
    expect(settleDetent("full", -300, -2, heights)).toBe("full");
  });
});

describe("sheetTopRadius", () => {
  test("stays round until the sheet is within the corner radius of the search bar", () => {
    expect(sheetTopRadius(heights.peek, heights.full)).toBe(SHEET_TOP_RADIUS);
    expect(sheetTopRadius(heights.full - SHEET_TOP_RADIUS, heights.full)).toBe(SHEET_TOP_RADIUS);
    expect(sheetTopRadius(heights.full - 12, heights.full)).toBe(12);
  });

  test("arrives square when docked, including a pull past the top", () => {
    expect(sheetTopRadius(heights.full, heights.full)).toBe(0);
    expect(sheetTopRadius(heights.full + 20, heights.full)).toBe(0);
  });
});

describe("dragVisibleHeight", () => {
  test("tracks the finger inside the range", () => {
    expect(dragVisibleHeight(heights.peek, 50, heights)).toBe(heights.peek - 50);
    expect(dragVisibleHeight(heights.peek, -50, heights)).toBe(heights.peek + 50);
  });

  test("gives a little past either end", () => {
    const over = dragVisibleHeight(heights.full, -100, heights);
    expect(over).toBeGreaterThan(heights.full);
    expect(over).toBeLessThan(heights.full + 100);
    const under = dragVisibleHeight(heights.collapsed, 100, heights);
    expect(under).toBeLessThan(heights.collapsed);
    expect(under).toBeGreaterThan(heights.collapsed - 100);
  });
});

describe("homesDragMode", () => {
  test("waits for the finger to commit", () => {
    expect(homesDragMode(4, "peek", true)).toBe("pending");
  });

  test("below full any travel moves the sheet", () => {
    expect(homesDragMode(-30, "peek", false)).toBe("sheet");
    expect(homesDragMode(30, "collapsed", false)).toBe("sheet");
  });

  test("at full the list scrolls unless it is at the top and pulled down", () => {
    expect(homesDragMode(-30, "full", true)).toBe("scroll");
    expect(homesDragMode(30, "full", false)).toBe("scroll");
    expect(homesDragMode(30, "full", true)).toBe("sheet");
  });
});

describe("mapInsetFor and homesTitle", () => {
  test("the full sheet keeps counting what the peek view showed", () => {
    expect(mapInsetFor("collapsed", heights)).toBe(heights.collapsed);
    expect(mapInsetFor("peek", heights)).toBe(heights.peek);
    expect(mapInsetFor("full", heights)).toBe(heights.peek);
  });

  test("titles read naturally", () => {
    expect(homesTitle(null)).toBe("Homes in view");
    expect(homesTitle(0)).toBe("No homes in view");
    expect(homesTitle(1)).toBe("1 home");
    expect(homesTitle(1234)).toBe("1,234 homes");
  });
});
