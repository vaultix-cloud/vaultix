import { ChangeEvent, forwardRef, InputHTMLAttributes, ReactNode, useId } from "react";

import "../Choice/Choice.css";
import "./Switch.css";

export type TSwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> & {
  label: ReactNode;
  description?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
};

// An on/off setting that takes effect at once. A native checkbox with role="switch", so Space
// toggles it, the label is associated and forms submit it; it is announced as on or off.
export const Switch = forwardRef<HTMLInputElement, TSwitchProps>(
  (
    {
      label,
      description,
      onCheckedChange,
      onChange,
      className,
      id,
      "aria-describedby": describedBy,
      ...rest
    },
    ref
  ) => {
    const generated = useId();
    const inputId = id ?? `vx-switch-${generated}`;
    const labelId = `${inputId}-label`;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      onCheckedChange?.(event.target.checked);
    };
    return (
      <label className={["vx-switch-row", className].filter(Boolean).join(" ")} htmlFor={inputId}>
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
        <span className="vx-switch">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            role="switch"
            className="vx-switch__input"
            aria-labelledby={labelId}
            aria-describedby={[descriptionId, describedBy].filter(Boolean).join(" ") || undefined}
            onChange={handleChange}
            {...rest}
          />
          <span className="vx-switch__thumb" aria-hidden="true" />
        </span>
      </label>
    );
  }
);
Switch.displayName = "Switch";
