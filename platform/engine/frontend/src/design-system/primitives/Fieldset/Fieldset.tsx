import { ReactNode, useId } from "react";

import "../Field/Field.css";
import "./Fieldset.css";

export type TFieldsetProps = {
  // The group's question or name, read when focus enters the group.
  legend: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
  children: ReactNode;
  // "radiogroup" for RadioGroup, which can then carry the group's required and invalid states.
  role?: "group" | "radiogroup";
  required?: boolean;
};

const ErrorIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.75v4M8 10.75v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// A native <fieldset> and <legend> for a group of checkboxes, radios or switches. The hint and
// error describe the whole group; a disabled fieldset disables every control in it.
export const Fieldset = ({
  legend,
  help,
  error,
  disabled = false,
  orientation = "vertical",
  className,
  children,
  role,
  required
}: TFieldsetProps) => {
  const base = `vx-fieldset-${useId()}`;
  const helpId = help ? `${base}-help` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  return (
    <fieldset
      className={["vx-fieldset", className].filter(Boolean).join(" ")}
      disabled={disabled}
      role={role === "radiogroup" ? "radiogroup" : undefined}
      aria-required={role === "radiogroup" && required ? true : undefined}
      aria-invalid={role === "radiogroup" && error ? true : undefined}
      aria-describedby={[helpId, errorId].filter(Boolean).join(" ") || undefined}
      data-invalid={error ? true : undefined}
    >
      <legend className="vx-fieldset__legend">{legend}</legend>
      {help && (
        <p id={helpId} className="vx-field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="vx-field__error">
          <ErrorIcon />
          <span>
            <span className="vx-field__error-prefix">Error: </span>
            {error}
          </span>
        </p>
      )}
      <div className={`vx-fieldset__items vx-fieldset__items--${orientation}`}>{children}</div>
    </fieldset>
  );
};
