import { ReactNode, useId } from "react";

import { Icon } from "../../icons/Icon";

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
          <Icon name="alert" />
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
