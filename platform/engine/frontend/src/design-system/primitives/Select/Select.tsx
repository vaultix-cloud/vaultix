import { forwardRef, SelectHTMLAttributes } from "react";

import { useField } from "../Field/Field";
import { joinIds, TTextInputSize } from "../TextInput/TextInput";

import "../TextInput/TextInput.css";
import "./Select.css";

export type TSelectOption = { value: string; label: string; disabled?: boolean };

export type TSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "multiple"> & {
  options: (TSelectOption | { group: string; options: TSelectOption[] })[];
  // Shown first with an empty value when nothing is chosen yet, e.g. "Choose an environment".
  placeholder?: string;
  size?: TTextInputSize;
  invalid?: boolean;
};

const Chevron = () => (
  <svg
    className="vx-select__chevron"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="m4.5 6.25 3.5 3.5 3.5-3.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// A native <select> in the text-control box: the platform's own keyboard, screen-reader and
// touch pickers, with Field wiring. For long or searchable lists use Combobox.
export const Select = forwardRef<HTMLSelectElement, TSelectProps>(
  (
    {
      options,
      placeholder,
      size = "md",
      invalid,
      className,
      id,
      required,
      disabled,
      "aria-describedby": describedBy,
      ...rest
    },
    ref
  ) => {
    const field = useField();
    const isInvalid = invalid ?? field?.invalid ?? false;
    const isDisabled = disabled ?? field?.disabled ?? false;
    const renderOption = (option: TSelectOption) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    );
    return (
      <span
        className={["vx-input", "vx-select", size !== "md" && `vx-input--${size}`, className]
          .filter(Boolean)
          .join(" ")}
        data-invalid={isInvalid || undefined}
        data-disabled={isDisabled || undefined}
      >
        <select
          ref={ref}
          className="vx-input__control vx-select__control"
          id={id ?? field?.controlId}
          required={required ?? field?.required}
          disabled={isDisabled}
          aria-invalid={isInvalid || undefined}
          aria-describedby={joinIds(field?.describedBy, describedBy)}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled={required ?? field?.required}>
              {placeholder}
            </option>
          )}
          {options.map((entry) =>
            "group" in entry ? (
              <optgroup key={entry.group} label={entry.group}>
                {entry.options.map(renderOption)}
              </optgroup>
            ) : (
              renderOption(entry)
            )
          )}
        </select>
        <Chevron />
      </span>
    );
  }
);
Select.displayName = "Select";
