import { ButtonHTMLAttributes, forwardRef, MouseEvent, ReactNode } from "react";

import "./Button.css";

export type TButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type TButtonSize = "sm" | "md" | "lg";

export type TButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: TButtonVariant;
  size?: TButtonSize;
  type?: "button" | "submit" | "reset";
  // Busy keeps the button focusable and announces the work; presses are ignored until it ends.
  busy?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

// A native <button>. Disabled uses the native attribute; busy uses aria-disabled so focus stays put.
export const Button = forwardRef<HTMLButtonElement, TButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      type = "button",
      busy = false,
      leadingIcon,
      trailingIcon,
      className,
      children,
      onClick,
      ...rest
    },
    ref
  ) => {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (busy) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };
    return (
      <button
        ref={ref}
        // eslint-disable-next-line react/button-has-type -- TButtonProps limits type to button, submit or reset
        type={type}
        className={classes(
          "vx-button",
          `vx-button--${variant}`,
          size !== "md" && `vx-button--${size}`,
          className
        )}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={handleClick}
        {...rest}
      >
        {busy ? (
          <span className="vx-button__spinner" aria-hidden="true" />
        ) : (
          leadingIcon && (
            <span className="vx-button__icon" aria-hidden="true">
              {leadingIcon}
            </span>
          )
        )}
        {children}
        {trailingIcon && (
          <span className="vx-button__icon" aria-hidden="true">
            {trailingIcon}
          </span>
        )}
      </button>
    );
  }
);
Button.displayName = "Button";
