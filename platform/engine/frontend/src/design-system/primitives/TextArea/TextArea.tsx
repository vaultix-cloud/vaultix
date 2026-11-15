import { forwardRef, TextareaHTMLAttributes } from "react";

import { useField } from "../Field/Field";
import { joinIds } from "../TextInput/TextInput";

import "../TextInput/TextInput.css";

export type TTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
  mono?: boolean;
  // Grow with the text instead of scrolling, up to a limit.
  grow?: boolean;
};

// A native <textarea> with the same box, states and Field wiring as TextInput.
export const TextArea = forwardRef<HTMLTextAreaElement, TTextAreaProps>(
  (
    {
      invalid,
      mono = false,
      grow = false,
      className,
      id,
      required,
      disabled,
      rows = 4,
      "aria-describedby": describedBy,
      ...rest
    },
    ref
  ) => {
    const field = useField();
    const isInvalid = invalid ?? field?.invalid ?? false;
    return (
      <textarea
        ref={ref}
        className={[
          "vx-textarea",
          mono && "vx-textarea--mono",
          grow && "vx-textarea--grow",
          className
        ]
          .filter(Boolean)
          .join(" ")}
        id={id ?? field?.controlId}
        rows={rows}
        required={required ?? field?.required}
        disabled={disabled ?? field?.disabled}
        aria-invalid={isInvalid || undefined}
        aria-describedby={joinIds(field?.describedBy, describedBy)}
        {...rest}
      />
    );
  }
);
TextArea.displayName = "TextArea";
