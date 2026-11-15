import {
  cloneElement,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

import { useAnchoredPosition, useDismissOnOutsidePress } from "../../utils/anchored";
import { TAlign, TSide } from "../../utils/position";
import { assignRef, elementRef } from "../../utils/refs";

import "./Popover.css";

export type TPopoverProps = {
  // A button. It gets aria-expanded, aria-controls and aria-haspopup="dialog".
  trigger: ReactElement;
  // Visible heading that names the popover. Without it, `label` names it.
  title?: ReactNode;
  label?: string;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  side?: TSide;
  align?: TAlign;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
};

type TTriggerProps = {
  id?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  ref?: (node: HTMLElement | null) => void;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: "dialog";
};

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const popoverAttribute = { popover: "manual" } as Record<string, string>;

// A non-modal panel anchored to a button (WAI-ARIA disclosure of a non-modal dialog). The page
// stays usable: a press outside closes it and focus stays where the press landed.
export const Popover = ({
  trigger,
  title,
  label,
  children,
  side = "bottom",
  align = "start",
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  initialFocus,
  className
}: TPopoverProps) => {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const panelId = `${id}-popover`;
  const titleId = title ? `${id}-title` : undefined;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const closeAndReturn = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useAnchoredPosition(open, triggerRef, panelRef, {
    side,
    align,
    offsetToken: "--vx-popover-offset"
  });
  const insideRefs = useMemo(() => [triggerRef, panelRef], []);
  useDismissOnOutsidePress(open, insideRefs, close);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const first = initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    first.focus();
  }, [open, initialFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeAndReturn();
  };

  const own = trigger.props as TTriggerProps;
  const callerRef = elementRef<HTMLElement>(trigger);
  const triggerProps: TTriggerProps = {
    ref: (node) => {
      triggerRef.current = node;
      assignRef(callerRef, node);
    },
    onClick: (event) => {
      own.onClick?.(event);
      setOpen(!open);
    },
    "aria-expanded": open,
    "aria-controls": open ? panelId : undefined,
    "aria-haspopup": "dialog"
  };

  return (
    <>
      {cloneElement(trigger, triggerProps)}
      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape inside the non-modal dialog closes it, per the WAI-ARIA dialog pattern
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          aria-label={titleId ? undefined : label}
          tabIndex={-1}
          className={["vx-popover", className].filter(Boolean).join(" ")}
          onKeyDown={onKeyDown}
          {...popoverAttribute}
        >
          {title && (
            <h2 id={titleId} className="vx-popover__title">
              {title}
            </h2>
          )}
          {typeof children === "function" ? children({ close: closeAndReturn }) : children}
        </div>
      )}
    </>
  );
};
