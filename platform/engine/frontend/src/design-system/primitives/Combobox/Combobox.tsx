import {
  ChangeEvent,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Icon } from "../../icons/Icon";
import { useAnchoredPosition, useDismissOnOutsidePress } from "../../utils/anchored";
import { useField } from "../Field/Field";

import "../Popover/Popover.css";
import "../Menu/Menu.css";
import "../TextInput/TextInput.css";
import "./Combobox.css";

export type TComboboxOption = {
  value: string;
  label: string;
  // A second line, e.g. the environment or owner. Matched by the filter too.
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type TComboboxProps = {
  options: TComboboxOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  // Without a Field around it, the accessible name.
  "aria-label"?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  noMatches?: ReactNode;
  className?: string;
};

const popoverAttribute = { popover: "manual" } as Record<string, string>;

const matches = (option: TComboboxOption, query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.label.toLowerCase().includes(needle) ||
    Boolean(option.description?.toLowerCase().includes(needle))
  );
};

// The WAI-ARIA editable combobox with list autocomplete. Focus stays in the text box; the active
// option is conveyed with aria-activedescendant. The value must be one of the options: leaving the
// box puts back the chosen option's label.
export const Combobox = ({
  options,
  value,
  defaultValue = null,
  onValueChange,
  placeholder,
  "aria-label": ariaLabel,
  id,
  disabled,
  required,
  invalid,
  noMatches = "No matches",
  className
}: TComboboxProps) => {
  const field = useField();
  const [uncontrolled, setUncontrolled] = useState<string | null>(defaultValue);
  const selected = value === undefined ? uncontrolled : value;
  const selectedOption = options.find((option) => option.value === selected) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const generated = useId();
  const inputId = id ?? field?.controlId ?? `vx-combobox-${generated}`;
  const listId = `${inputId}-listbox`;
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const isDisabled = disabled ?? field?.disabled ?? false;
  const isInvalid = invalid ?? field?.invalid ?? false;

  // Until the person types, the whole list shows even though the box holds the chosen label.
  const visible = useMemo(
    () => (typed ? options.filter((option) => matches(option, query)) : options),
    [options, query, typed]
  );

  useEffect(() => {
    if (!open) setQuery(selectedOption?.label ?? "");
  }, [selectedOption?.label, open]);

  useAnchoredPosition(open, boxRef, listRef, {
    side: "bottom",
    align: "start",
    offsetToken: "--vx-popover-offset"
  });

  useLayoutEffect(() => {
    if (open && listRef.current && boxRef.current)
      listRef.current.style.minWidth = `${boxRef.current.getBoundingClientRect().width}px`;
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // optionId depends only on inputId, which does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const close = useCallback(() => {
    setOpen(false);
    setTyped(false);
    setActive(-1);
  }, []);
  const insideRefs = useMemo(() => [boxRef, listRef], []);
  useDismissOnOutsidePress(open, insideRefs, close);

  const choose = (option: TComboboxOption) => {
    if (option.disabled) return;
    if (value === undefined) setUncontrolled(option.value);
    onValueChange?.(option.value);
    setQuery(option.label);
    close();
  };

  const step = (from: number, direction: 1 | -1) => {
    if (visible.length === 0) return -1;
    let index = from;
    for (let count = 0; count < visible.length; count += 1) {
      index = (index + direction + visible.length) % visible.length;
      if (!visible[index].disabled) return index;
    }
    return -1;
  };

  const openList = (direction: 1 | -1 | 0) => {
    setOpen(true);
    if (direction === 0) return;
    const current = visible.findIndex((option) => option.value === selected);
    if (!open && current >= 0) setActive(current);
    else setActive((index) => step(index < 0 && direction === -1 ? 0 : index, direction));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        openList(event.altKey ? 0 : 1);
        break;
      case "ArrowUp":
        if (event.altKey) {
          close();
          break;
        }
        openList(-1);
        break;
      case "Enter":
        if (!open || active < 0) return;
        choose(visible[active]);
        break;
      case "Escape":
        if (open) close();
        else if (query) {
          setQuery("");
          if (value === undefined) setUncontrolled(null);
          onValueChange?.(null);
        } else return;
        event.stopPropagation();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setTyped(true);
    setOpen(true);
    setActive(-1);
  };

  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (listRef.current?.contains(event.relatedTarget)) return;
    close();
  };

  const count = visible.length;
  const status = open && typed ? `${count} ${count === 1 ? "match" : "matches"}` : "";

  return (
    <>
      {/* The live region announces how many options match as the person types. */}
      <span className="vx-combobox__status" role="status">
        {status}
      </span>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the input is the control; a press on the box forwards to it */}
      <span
        ref={boxRef}
        className={["vx-input", "vx-combobox", className].filter(Boolean).join(" ")}
        data-invalid={isInvalid || undefined}
        data-disabled={isDisabled || undefined}
        onMouseDown={(event) => {
          if (event.target === inputRef.current || isDisabled) return;
          event.preventDefault();
          inputRef.current?.focus();
          if (open) close();
          else openList(0);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="vx-input__control"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-invalid={isInvalid || undefined}
          aria-describedby={field?.describedBy}
          required={required ?? field?.required}
          disabled={isDisabled}
          placeholder={placeholder}
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onClick={() => {
            if (!open) openList(0);
          }}
        />
        <span className="vx-input__adornment vx-combobox__chevron">
          <Icon name="chevron-down" />
        </span>
      </span>
      <div ref={listRef} className="vx-floating vx-menu vx-combobox__popup" {...popoverAttribute}>
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : field?.labelId}
        >
          {visible.map((option, index) => (
            // Focus stays in the text box (aria-activedescendant), so options take no focus and are
            // chosen with Enter there.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === selected}
              aria-disabled={option.disabled || undefined}
              className="vx-menu__item vx-combobox__option"
              data-active={index === active || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onPointerMove={() => {
                if (!option.disabled && index !== active) setActive(index);
              }}
            >
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
              <span className="vx-combobox__check" aria-hidden="true">
                {option.value === selected && <Icon name="check" />}
              </span>
            </div>
          ))}
        </div>
        {visible.length === 0 && <div className="vx-combobox__empty">{noMatches}</div>}
      </div>
    </>
  );
};
