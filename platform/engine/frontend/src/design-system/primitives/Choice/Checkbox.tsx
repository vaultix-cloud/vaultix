import { forwardRef, InputHTMLAttributes, ReactNode, useEffect, useId, useRef } from "react";

import { assignRef } from "../../utils/refs";

import "./Choice.css";

export type TCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  // A line under the label, linked with aria-describedby.
  description?: ReactNode;
  // Some but not all of the things it stands for are chosen ("mixed").
  indeterminate?: boolean;
  invalid?: boolean;
};

// A native checkbox drawn with tokens. The whole label row is the press target.
export const Checkbox = forwardRef<HTMLInputElement, TCheckboxProps>(
  (
    {
      label,
      description,
      indeterminate = false,
      invalid,
      className,
      id,
      "aria-describedby": describedBy,
      ...rest
    },
    ref
  ) => {
    const own = useRef<HTMLInputElement | null>(null);
    const generated = useId();
    const inputId = id ?? `vx-checkbox-${generated}`;
    const labelId = `${inputId}-label`;
    const descriptionId = description ? `${inputId}-description` : undefined;

    // Mixed state exists only as a DOM property, never as an attribute.
    useEffect(() => {
      if (own.current) own.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label className={["vx-choice", className].filter(Boolean).join(" ")} htmlFor={inputId}>
        <span className="vx-choice__control">
          <input
            ref={(node) => {
              own.current = node;
              assignRef(ref, node);
            }}
            id={inputId}
            type="checkbox"
            className="vx-checkbox"
            // The label element also wraps the description; naming by the label text alone keeps
            // the description out of the name.
            aria-labelledby={labelId}
            aria-invalid={invalid || undefined}
            aria-describedby={[descriptionId, describedBy].filter(Boolean).join(" ") || undefined}
            {...rest}
          />
          <svg className="vx-choice__mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path className="vx-choice__check" d="m3.5 8.5 3 3 6-7" />
            <path className="vx-choice__dash" d="M4 8h8" />
          </svg>
        </span>
        <span className="vx-choice__text">
          <span id={labelId} className="vx-choice__label">
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="vx-choice__description">
              {description}
            </span>
          )}
        </span>
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";
