import { RefObject, useEffect, useLayoutEffect } from "react";

import { place, rectOf, TAlign, TSide, viewportRect } from "./position";

const tokenPx = (name: string, fallback: number) =>
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

// Shows a floating element in the browser's top layer (Popover API, so it sits above dialogs with
// no portal or z-index race) and keeps it placed beside its trigger while the page scrolls or
// resizes. The element needs the `popover` attribute and `position: fixed`.
export const useAnchoredPosition = (
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  { side, align = "center", offsetToken }: { side: TSide; align?: TAlign; offsetToken: string }
) => {
  useLayoutEffect(() => {
    const floating = floatingRef.current;
    const trigger = triggerRef.current;
    if (!open || !floating || !trigger) return undefined;
    if (!floating.matches(":popover-open")) floating.showPopover?.();
    const offset = tokenPx(offsetToken, 8);
    const position = () => {
      const placed = place(rectOf(trigger), rectOf(floating), {
        side,
        align,
        offset,
        viewport: viewportRect()
      });
      floating.style.top = `${placed.top}px`;
      floating.style.left = `${placed.left}px`;
      floating.dataset.side = placed.side;
      floating.dataset.open = "true";
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(floating);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      if (floating.matches(":popover-open")) floating.hidePopover?.();
    };
  }, [open, side, align, offsetToken, triggerRef, floatingRef]);
};

// Closes a floating element when a press lands outside it and its trigger. Escape is handled by
// each component, which also decides where focus goes.
export const useDismissOnOutsidePress = (
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onDismiss: () => void
) => {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, refs, onDismiss]);
};
