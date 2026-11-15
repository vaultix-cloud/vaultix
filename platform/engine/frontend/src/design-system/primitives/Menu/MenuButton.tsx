import {
  cloneElement,
  Fragment,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
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

import "../Popover/Popover.css";
import "./Menu.css";

export type TMenuItem = {
  kind?: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  // Shown at the end of the row and exposed with aria-keyshortcuts, e.g. "Control+Shift+C".
  shortcut?: { label: string; keys: string };
  danger?: boolean;
  // Stays in the keyboard order so people learn it exists, but does nothing.
  disabled?: boolean;
  onSelect: () => void;
};

export type TMenuEntry =
  | TMenuItem
  | { kind: "separator"; id: string }
  | { kind: "group"; id: string; label: string; items: TMenuItem[] };

export type TMenuButtonProps = {
  // A button (Button or IconButton). It gets aria-haspopup, aria-expanded and aria-controls, and
  // names the menu.
  trigger: ReactElement;
  items: TMenuEntry[];
  side?: TSide;
  align?: TAlign;
  className?: string;
};

type TTriggerProps = {
  id?: string;
  ref?: (node: HTMLElement | null) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
};

const TYPEAHEAD_RESET_MS = 500;
const popoverAttribute = { popover: "manual" } as Record<string, string>;

const flatten = (entries: TMenuEntry[]): TMenuItem[] =>
  entries.flatMap((entry) => {
    if (entry.kind === "separator") return [];
    if (entry.kind === "group") return entry.items;
    return [entry];
  });

// The WAI-ARIA menu button pattern. Focus moves into the menu and between items with the arrow
// keys (roving focus); each item is reached by arrows, Home, End or typing its first letters.
export const MenuButton = ({
  trigger,
  items,
  side = "bottom",
  align = "start",
  className
}: TMenuButtonProps) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const typed = useRef({ text: "", timer: 0 });
  const id = useId();
  const own = trigger.props as TTriggerProps;
  const triggerId = own.id ?? `${id}-trigger`;
  const menuId = `${id}-menu`;
  const flat = useMemo(() => flatten(items), [items]);

  useAnchoredPosition(open, triggerRef, menuRef, {
    side,
    align,
    offsetToken: "--vx-popover-offset"
  });
  const close = useCallback(() => setOpen(false), []);
  const insideRefs = useMemo(() => [triggerRef, menuRef], []);
  useDismissOnOutsidePress(open, insideRefs, close);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const select = (item: TMenuItem) => {
    if (item.disabled) return;
    closeToTrigger();
    item.onSelect();
  };

  const typeahead = (key: string) => {
    window.clearTimeout(typed.current.timer);
    typed.current.text += key.toLowerCase();
    typed.current.timer = window.setTimeout(() => {
      typed.current.text = "";
    }, TYPEAHEAD_RESET_MS);
    const { text } = typed.current;
    // A repeated single letter cycles through items starting with it.
    const repeated = text.length > 1 && [...text].every((ch) => ch === text[0]);
    const needle = repeated ? text[0] : text;
    const start = repeated || text.length === 1 ? active + 1 : active;
    for (let step = 0; step < flat.length; step += 1) {
      const index = (start + step) % flat.length;
      if (flat[index].label.toLowerCase().startsWith(needle)) {
        setActive(index);
        return;
      }
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = flat.length - 1;
    switch (event.key) {
      case "ArrowDown":
        setActive((index) => (index >= last ? 0 : index + 1));
        break;
      case "ArrowUp":
        setActive((index) => (index <= 0 ? last : index - 1));
        break;
      case "Home":
      case "PageUp":
        setActive(0);
        break;
      case "End":
      case "PageDown":
        setActive(last);
        break;
      case "Enter":
      case " ":
        select(flat[active]);
        break;
      case "Escape":
        event.stopPropagation();
        closeToTrigger();
        break;
      case "Tab":
        // Focus moves on to the next control as usual; the menu closes after it leaves.
        window.setTimeout(close, 0);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
  };

  const callerRef = elementRef<HTMLElement>(trigger);
  const triggerProps: TTriggerProps = {
    id: triggerId,
    ref: (node) => {
      triggerRef.current = node;
      assignRef(callerRef, node);
    },
    onClick: (event) => {
      own.onClick?.(event);
      if (open) setOpen(false);
      else openAt(0);
    },
    onKeyDown: (event) => {
      own.onKeyDown?.(event);
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAt(0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        openAt(flat.length - 1);
      }
    },
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined
  };

  let position = -1;
  const renderItem = (item: TMenuItem) => {
    position += 1;
    const index = position;
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the menu handles Enter and Space for the focused item
      <div
        key={item.id}
        ref={(node) => {
          itemRefs.current[index] = node;
        }}
        role="menuitem"
        tabIndex={-1}
        className="vx-menu__item"
        data-danger={item.danger || undefined}
        aria-disabled={item.disabled || undefined}
        aria-keyshortcuts={item.shortcut?.keys}
        onClick={() => select(item)}
        onPointerMove={() => {
          if (index !== active) setActive(index);
        }}
      >
        {item.icon && (
          <span className="vx-menu__icon" aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className="vx-menu__label">{item.label}</span>
        {item.shortcut && (
          <span className="vx-menu__shortcut" aria-hidden="true">
            {item.shortcut.label}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {cloneElement(trigger, triggerProps)}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-labelledby={triggerId}
          className={["vx-floating", "vx-menu", className].filter(Boolean).join(" ")}
          onKeyDown={onMenuKeyDown}
          {...popoverAttribute}
        >
          {items.map((entry) => {
            if (entry.kind === "separator")
              return <div key={entry.id} role="separator" className="vx-menu__separator" />;
            if (entry.kind === "group") {
              const labelId = `${menuId}-${entry.id}`;
              return (
                <div key={entry.id} role="group" aria-labelledby={labelId}>
                  <div id={labelId} className="vx-menu__group-label">
                    {entry.label}
                  </div>
                  {entry.items.map(renderItem)}
                </div>
              );
            }
            return <Fragment key={entry.id}>{renderItem(entry)}</Fragment>;
          })}
        </div>
      )}
    </>
  );
};
