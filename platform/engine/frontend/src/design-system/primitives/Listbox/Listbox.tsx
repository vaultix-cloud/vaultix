import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";

import { Icon } from "../../icons/Icon";

import "../Menu/Menu.css";
import "../Combobox/Combobox.css";
import "./Listbox.css";

export type TListboxOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type TListboxProps = {
  options: TListboxOption[];
  // Names the list for assistive technology; use labelledBy when a visible heading names it.
  label?: string;
  labelledBy?: string;
  // The chosen values, always a list: at most one item unless multiple.
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  multiple?: boolean;
  className?: string;
};

const TYPEAHEAD_RESET_MS = 500;

// The WAI-ARIA listbox. The list is one Tab stop and the active option is conveyed with
// aria-activedescendant. Single: selection follows focus. Multiple: Space toggles, Shift+arrows
// extend, Ctrl+A chooses all (or none when all are chosen).
export const Listbox = ({
  options,
  label,
  labelledBy,
  value,
  defaultValue = [],
  onValueChange,
  multiple = false,
  className
}: TListboxProps) => {
  const [uncontrolled, setUncontrolled] = useState<string[]>(defaultValue);
  const selected = value ?? uncontrolled;
  const firstSelected = options.findIndex((option) => selected.includes(option.value));
  const [active, setActive] = useState(Math.max(0, firstSelected));
  const typed = useRef({ text: "", timer: 0 });
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // optionId depends only on the stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const commit = (next: string[]) => {
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };

  const enabled = (index: number) => !options[index]?.disabled;
  const step = (from: number, direction: 1 | -1) => {
    for (let index = from + direction; index >= 0 && index < options.length; index += direction) {
      if (enabled(index)) return index;
    }
    return from;
  };
  const edge = (direction: 1 | -1) => {
    const start = direction === 1 ? -1 : options.length;
    return step(start, direction);
  };

  const moveTo = (index: number, extend: boolean) => {
    setActive(index);
    const chosen = options[index].value;
    if (!multiple) commit([chosen]);
    else if (extend && !selected.includes(chosen)) commit([...selected, chosen]);
  };

  const toggle = (index: number) => {
    if (!enabled(index)) return;
    const chosen = options[index].value;
    if (!multiple) {
      commit([chosen]);
      return;
    }
    commit(
      selected.includes(chosen) ? selected.filter((item) => item !== chosen) : [...selected, chosen]
    );
  };

  const typeahead = (key: string) => {
    window.clearTimeout(typed.current.timer);
    typed.current.text += key.toLowerCase();
    typed.current.timer = window.setTimeout(() => {
      typed.current.text = "";
    }, TYPEAHEAD_RESET_MS);
    const { text } = typed.current;
    // A first letter looks past the current option; a longer prefix may stay on it.
    const start = text.length === 1 ? active + 1 : active;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      if (enabled(index) && options[index].label.toLowerCase().startsWith(text)) {
        moveTo(index, false);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const extend = multiple && event.shiftKey;
    switch (event.key) {
      case "ArrowDown":
        moveTo(step(active, 1), extend);
        break;
      case "ArrowUp":
        moveTo(step(active, -1), extend);
        break;
      case "Home":
        moveTo(edge(1), false);
        break;
      case "End":
        moveTo(edge(-1), false);
        break;
      case " ":
        if (!multiple) return;
        toggle(active);
        break;
      case "a":
        if (multiple && (event.ctrlKey || event.metaKey)) {
          const all = options.filter((option) => !option.disabled).map((option) => option.value);
          commit(all.every((item) => selected.includes(item)) ? [] : all);
          break;
        }
        typeahead(event.key);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={["vx-listbox", className].filter(Boolean).join(" ")}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-multiselectable={multiple || undefined}
      aria-activedescendant={options.length ? optionId(active) : undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const isSelected = selected.includes(option.value);
        return (
          // The list holds focus (aria-activedescendant); options are chosen with the keyboard
          // there or by pressing them.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
          <div
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled || undefined}
            className="vx-menu__item vx-combobox__option vx-listbox__option"
            data-active={index === active || undefined}
            onClick={() => {
              if (!enabled(index)) return;
              setActive(index);
              toggle(index);
            }}
          >
            {multiple ? (
              <span
                className="vx-listbox__box"
                data-checked={isSelected || undefined}
                aria-hidden="true"
              >
                {isSelected && <Icon name="check" size={12} />}
              </span>
            ) : null}
            {option.icon && (
              <span className="vx-menu__icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="vx-combobox__text">
              <span className="vx-menu__label">{option.label}</span>
              {option.description && (
                <span className="vx-combobox__description">{option.description}</span>
              )}
            </span>
            {!multiple && (
              <span className="vx-combobox__check" aria-hidden="true">
                {isSelected && <Icon name="check" />}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
