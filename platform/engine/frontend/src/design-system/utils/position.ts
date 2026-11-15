// Places a floating element (tooltip, popover, menu) next to its trigger. Pure, so it is unit
// tested; components measure the elements and apply the result with `position: fixed`.

export type TSide = "top" | "right" | "bottom" | "left";
export type TAlign = "start" | "center" | "end";

export type TRect = { top: number; left: number; width: number; height: number };

export type TPlacement = { top: number; left: number; side: TSide };

const opposite: Record<TSide, TSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left"
};

const fits = (side: TSide, trigger: TRect, floating: TRect, offset: number, viewport: TRect) => {
  switch (side) {
    case "top":
      return trigger.top - offset - floating.height >= viewport.top;
    case "bottom":
      return (
        trigger.top + trigger.height + offset + floating.height <= viewport.top + viewport.height
      );
    case "left":
      return trigger.left - offset - floating.width >= viewport.left;
    default:
      return (
        trigger.left + trigger.width + offset + floating.width <= viewport.left + viewport.width
      );
  }
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

// Prefers `side`, flips to the opposite side when it does not fit there but fits opposite, and
// keeps the element inside the viewport with `margin` to spare.
export const place = (
  trigger: TRect,
  floating: TRect,
  {
    side,
    align = "center",
    offset = 8,
    margin = 8,
    viewport
  }: { side: TSide; align?: TAlign; offset?: number; margin?: number; viewport: TRect }
): TPlacement => {
  const chosen =
    !fits(side, trigger, floating, offset, viewport) &&
    fits(opposite[side], trigger, floating, offset, viewport)
      ? opposite[side]
      : side;
  const vertical = chosen === "top" || chosen === "bottom";
  const alongStart = vertical ? trigger.left : trigger.top;
  const alongSize = vertical ? trigger.width : trigger.height;
  const ownSize = vertical ? floating.width : floating.height;
  let along = alongStart + (alongSize - ownSize) / 2;
  if (align === "start") along = alongStart;
  if (align === "end") along = alongStart + alongSize - ownSize;

  let top: number;
  let left: number;
  if (vertical) {
    top =
      chosen === "top"
        ? trigger.top - offset - floating.height
        : trigger.top + trigger.height + offset;
    left = clamp(
      along,
      viewport.left + margin,
      viewport.left + viewport.width - floating.width - margin
    );
  } else {
    left =
      chosen === "left"
        ? trigger.left - offset - floating.width
        : trigger.left + trigger.width + offset;
    top = clamp(
      along,
      viewport.top + margin,
      viewport.top + viewport.height - floating.height - margin
    );
  }
  return { top: Math.round(top), left: Math.round(left), side: chosen };
};

export const rectOf = (element: Element): TRect => {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
};

export const viewportRect = (): TRect => ({
  top: 0,
  left: 0,
  width: window.innerWidth,
  height: window.innerHeight
});
