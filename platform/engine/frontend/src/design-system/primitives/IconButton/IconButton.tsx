import { forwardRef, ReactNode } from "react";

import { TSide } from "../../utils/position";
import { Button, TButtonProps } from "../Button/Button";
import { Tooltip } from "../Tooltip/Tooltip";

export type TIconButtonProps = Omit<
  TButtonProps,
  "children" | "leadingIcon" | "trailingIcon" | "aria-label"
> & {
  icon: ReactNode;
  // Required: the button's accessible name and its tooltip. An icon alone is never enough.
  label: string;
  tooltipSide?: TSide;
};

export const IconButton = forwardRef<HTMLButtonElement, TIconButtonProps>(
  ({ icon, label, tooltipSide = "top", variant = "ghost", className, ...rest }, ref) => (
    <Tooltip content={label} kind="label" side={tooltipSide}>
      <Button
        ref={ref}
        variant={variant}
        className={["vx-button--icon", className].filter(Boolean).join(" ")}
        {...rest}
      >
        <span className="vx-button__icon" aria-hidden="true">
          {icon}
        </span>
      </Button>
    </Tooltip>
  )
);
IconButton.displayName = "IconButton";
