import { forwardRef, InputHTMLAttributes, MouseEvent, ReactNode } from "react";

import { useField } from "../Field/Field";

import "./TextInput.css";

export type TTextInputSize = "sm" | "md" | "lg";

export type TTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: TTextInputSize;
  // Invalid without a Field; inside a Field the Field's error decides.
  invalid?: boolean;
  // Content inside the border before and after the text: an icon, a unit, a button.
  leading?: ReactNode;
  trailing?: ReactNode;
  // Monospaced text for keys, names and references.
  mono?: boolean;
};

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

// Joins ids for aria-describedby, keeping both the Field's and the caller's.
export const joinIds = (...ids: (string | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined;

// A native <input> inside a bordered box that also holds optional leading and trailing content.
// The box shows hover, focus and invalid states so the adornments read as part of the control.
export const TextInput = forwardRef<HTMLInputElement, TTextInputProps>(
  (
    {
      size = "md",
      invalid,
      leading,
      trailing,
      mono = false,
      className,
      id,
      required,
      disabled,
      readOnly,
      type = "text",
      "aria-describedby": describedBy,
      ...rest
    },
    ref
  ) => {
    const field = useField();
    const isInvalid = invalid ?? field?.invalid ?? false;
    const isDisabled = disabled ?? field?.disabled ?? false;

    // A press on the box's padding or an adornment that is not itself interactive moves focus
    // to the text, as a press inside a native input would.
    const focusText = (event: MouseEvent<HTMLSpanElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, button, a, select, textarea, [tabindex]")) return;
      event.preventDefault();
      event.currentTarget.querySelector("input")?.focus();
    };

    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the input inside is the control; this only forwards a pointer press on the padding to it
      <span
        className={classes(
          "vx-input",
          size !== "md" && `vx-input--${size}`,
          mono && "vx-input--mono",
          className
        )}
        data-invalid={isInvalid || undefined}
        data-disabled={isDisabled || undefined}
        data-readonly={readOnly || undefined}
        onMouseDown={focusText}
      >
        {leading && <span className="vx-input__adornment">{leading}</span>}
        <input
          ref={ref}
          className="vx-input__control"
          type={type}
          id={id ?? field?.controlId}
          required={required ?? field?.required}
          disabled={isDisabled}
          readOnly={readOnly}
          aria-invalid={isInvalid || undefined}
          aria-describedby={joinIds(field?.describedBy, describedBy)}
          {...rest}
        />
        {trailing && <span className="vx-input__adornment">{trailing}</span>}
      </span>
    );
  }
);
TextInput.displayName = "TextInput";
