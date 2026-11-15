import { createContext, ReactNode, useContext, useId, useMemo } from "react";

import "./Field.css";

type TFieldContext = {
  controlId: string;
  // For controls with a popup (Combobox) whose list is named by the same label.
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
};

const FieldContext = createContext<TFieldContext | null>(null);

// Controls read this to take their id, description, validity and required state from the
// surrounding Field, so a label, hint and error are always associated with the control.
export const useField = () => useContext(FieldContext);

export type TFieldProps = {
  label: ReactNode;
  // Hint shown under the label: what to enter, or what happens with it.
  help?: ReactNode;
  // When set, the control is invalid and this message describes how to fix it.
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
};

const ErrorIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.75v4M8 10.75v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Label, hint and error order follows the control: people read what is asked and what is wrong
// before they reach the input, by sight and by screen reader.
export const Field = ({
  label,
  help,
  error,
  required = false,
  disabled = false,
  id,
  className,
  children
}: TFieldProps) => {
  const generated = useId();
  const controlId = id ?? `vx-field-${generated}`;
  const labelId = `${controlId}-label`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error);
  const context = useMemo(
    () => ({ controlId, labelId, describedBy, invalid, required, disabled }),
    [controlId, labelId, describedBy, invalid, required, disabled]
  );

  return (
    <FieldContext.Provider value={context}>
      <div
        className={["vx-field", className].filter(Boolean).join(" ")}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
      >
        <label id={labelId} className="vx-field__label" htmlFor={controlId}>
          {label}
          {required && (
            // The control carries the native required state, which assistive technology
            // announces; this word is only the visible cue.
            <span className="vx-field__required" aria-hidden="true">
              Required
            </span>
          )}
        </label>
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
        {children}
      </div>
    </FieldContext.Provider>
  );
};
