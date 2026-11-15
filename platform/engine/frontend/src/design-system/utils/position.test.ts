import { describe, expect, test } from "vitest";

import { place } from "./position";

const viewport = { top: 0, left: 0, width: 1000, height: 800 };
const floating = { top: 0, left: 0, width: 120, height: 32 };

describe("place", () => {
  test("puts the element on the preferred side, centred, at the offset", () => {
    const trigger = { top: 400, left: 500, width: 40, height: 40 };
    expect(place(trigger, floating, { side: "top", viewport })).toEqual({
      top: 360,
      left: 460,
      side: "top"
    });
    expect(place(trigger, floating, { side: "right", viewport })).toEqual({
      top: 404,
      left: 548,
      side: "right"
    });
  });

  test("flips to the opposite side when the preferred side has no room", () => {
    const nearTop = { top: 10, left: 500, width: 40, height: 40 };
    expect(place(nearTop, floating, { side: "top", viewport }).side).toBe("bottom");
    const nearRight = { top: 400, left: 950, width: 40, height: 40 };
    expect(place(nearRight, floating, { side: "right", viewport }).side).toBe("left");
  });

  test("keeps the preferred side when neither side fits", () => {
    const tall = { ...floating, height: 900 };
    expect(
      place({ top: 380, left: 0, width: 40, height: 40 }, tall, {
        side: "top",
        viewport: { ...viewport, height: 800 }
      }).side
    ).toBe("top");
  });

  test("clamps along the edge so the element stays on screen", () => {
    const atLeftEdge = { top: 400, left: 0, width: 20, height: 20 };
    expect(place(atLeftEdge, floating, { side: "top", viewport }).left).toBe(8);
    const atBottom = { top: 790, left: 500, width: 20, height: 10 };
    expect(place(atBottom, floating, { side: "right", viewport }).top).toBe(800 - 32 - 8);
  });

  test("aligns to the start or end of the trigger", () => {
    const trigger = { top: 400, left: 500, width: 200, height: 40 };
    expect(place(trigger, floating, { side: "bottom", align: "start", viewport }).left).toBe(500);
    expect(place(trigger, floating, { side: "bottom", align: "end", viewport }).left).toBe(580);
  });
});
