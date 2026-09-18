import { describe, expect, test } from "vitest";
import {
  dismissDirection,
  dismissIntent,
  lockFromTravel,
  sheetModeFromTravel,
} from "./dismiss-gesture";

describe("dismissIntent", () => {
  test("a short flick down closes a sheet", () => {
    expect(dismissIntent(28, 0.5, 700, "down")).toBe(true);
  });

  test("a slow nudge does not close", () => {
    expect(dismissIntent(40, 0.1, 700, "down")).toBe(false);
  });

  test("dragging past the distance threshold closes", () => {
    expect(dismissIntent(120, 0, 700, "down")).toBe(true);
  });

  test("upward travel never closes a down-only sheet", () => {
    expect(dismissIntent(-200, -1, 700, "down")).toBe(false);
  });

  test("a lightbox flick up or down both close", () => {
    expect(dismissIntent(-30, -0.5, 800, "vertical")).toBe(true);
    expect(dismissIntent(30, 0.5, 800, "vertical")).toBe(true);
  });

  test("a lightbox drag that reverses does not count as a flick", () => {
    expect(dismissIntent(40, -0.6, 800, "vertical")).toBe(false);
  });
});

describe("dismissDirection", () => {
  test("follows the flick when there is one", () => {
    expect(dismissDirection(20, -0.4)).toBe(-1);
    expect(dismissDirection(-20, 0.4)).toBe(1);
  });

  test("follows the drag when the flick is quiet", () => {
    expect(dismissDirection(-80, 0.01)).toBe(-1);
    expect(dismissDirection(80, -0.01)).toBe(1);
  });
});

describe("lockFromTravel", () => {
  test("stays pending until the finger picks an axis", () => {
    expect(lockFromTravel(4, 6)).toBe("pending");
  });

  test("a mostly vertical drag dismisses", () => {
    expect(lockFromTravel(8, 40)).toBe("y");
    expect(lockFromTravel(-6, -30)).toBe("y");
  });

  test("a mostly horizontal drag pages", () => {
    expect(lockFromTravel(40, 8)).toBe("x");
  });
});

describe("sheetModeFromTravel", () => {
  test("pulling down on a dismissible surface owns the sheet", () => {
    expect(sheetModeFromTravel(24, true)).toBe("sheet");
  });

  test("pulling down over a scrolled body stays a scroll", () => {
    expect(sheetModeFromTravel(24, false)).toBe("scroll");
  });

  test("an upward nudge never steals the sheet", () => {
    expect(sheetModeFromTravel(-24, true)).toBe("scroll");
  });
});
