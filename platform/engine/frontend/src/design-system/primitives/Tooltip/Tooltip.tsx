import {
  cloneElement,
  FocusEvent,
  isValidElement,
  KeyboardEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  Ref,
  RefCallback,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import { place, rectOf, TSide, viewportRect } from "../../utils/position";
import { durationMs } from "../../utils/tokens";

import "./Tooltip.css";

export type TTooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: TSide;
  // "label": the tooltip shows the trigger's accessible name (icon-only controls); the name is set
  // with aria-label and the tooltip itself is hidden from assistive tech so it is not read twice.
  // "description": extra information, linked with aria-describedby and role="tooltip".
  kind?: "label" | "description";
};

type TTriggerProps = {
  ref?: Ref<HTMLElement>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

const LEAVE_GRACE_MS = 120;

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") Reflect.set(ref, "current", value);
};

// The Popover API puts the tooltip in the top layer, above dialogs, without a portal or z-index race.
const popoverAttribute = { popover: "manual" } as Record<string, string>;

// Meets WCAG 2.2 SC 1.4.13: it opens on hover after the token delay and at once on keyboard focus,
// stays open while the pointer moves onto it, and closes on Escape without moving the pointer.
export const Tooltip = ({
  content,
  children,
  side = "top",
  kind = "description"
}: TTooltipProps) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const show = useCallback((delayed: boolean) => {
    clearTimers();
    if (!delayed) {
      setOpen(true);
      return;
    }
    openTimer.current = window.setTimeout(
      () => setOpen(true),
      durationMs("--vx-duration-tooltip-delay", 400)
    );
  }, []);
  const hide = useCallback((graceful: boolean) => {
    clearTimers();
    if (!graceful) {
      setOpen(false);
      return;
    }
    closeTimer.current = window.setTimeout(() => setOpen(false), LEAVE_GRACE_MS);
  }, []);

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hide(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const trigger = triggerRef.current;
    if (!open || !tip || !trigger) return undefined;
    tip.showPopover?.();
    const offset =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--vx-tooltip-offset")
      ) || 8;
    const position = () => {
      const placed = place(rectOf(trigger), rectOf(tip), {
        side,
        offset,
        viewport: viewportRect()
      });
      tip.style.top = `${placed.top}px`;
      tip.style.left = `${placed.left}px`;
      tip.dataset.side = placed.side;
      tip.dataset.open = "true";
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      if (tip.matches?.(":popover-open")) tip.hidePopover?.();
    };
  }, [open, side]);

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<TTriggerProps> & { ref?: Ref<HTMLElement> };
  const own = child.props;

  const setTrigger: RefCallback<HTMLElement> = (node) => {
    triggerRef.current = node;
    assignRef(child.ref, node);
  };

  const labelled = Boolean(own["aria-label"] || own["aria-labelledby"]);
  const triggerProps: TTriggerProps = {
    ref: setTrigger,
    onPointerEnter: (event) => {
      own.onPointerEnter?.(event);
      if (event.pointerType === "mouse") show(true);
    },
    onPointerLeave: (event) => {
      own.onPointerLeave?.(event);
      hide(true);
    },
    onFocus: (event) => {
      own.onFocus?.(event);
      if (event.currentTarget.matches(":focus-visible")) show(false);
    },
    onBlur: (event) => {
      own.onBlur?.(event);
      hide(false);
    },
    onKeyDown: (event) => {
      own.onKeyDown?.(event);
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        hide(false);
      }
    }
  };
  if (kind === "label" && !labelled && typeof content === "string")
    triggerProps["aria-label"] = content;
  if (kind === "description") {
    triggerProps["aria-describedby"] =
      [own["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined;
  }

  return (
    <>
      {cloneElement(child, triggerProps)}
      {open && (
        <div
          ref={tipRef}
          id={id}
          className="vx-tooltip"
          role={kind === "description" ? "tooltip" : undefined}
          aria-hidden={kind === "label" ? true : undefined}
          onPointerEnter={() => clearTimers()}
          onPointerLeave={() => hide(true)}
          {...popoverAttribute}
        >
          {content}
        </div>
      )}
    </>
  );
};
