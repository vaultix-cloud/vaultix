// The Vaultix design system (docs/0130 phase 1). Import UI from here: tokens, primitives and
// behavior utilities. No shadcn, no Radix: every primitive is native HTML with WAI-ARIA patterns.
import "./tokens/tokens.css";

export type { TButtonProps, TButtonSize, TButtonVariant } from "./primitives/Button/Button";
export { Button } from "./primitives/Button/Button";
export type { TIconButtonProps } from "./primitives/IconButton/IconButton";
export { IconButton } from "./primitives/IconButton/IconButton";
export type { TTooltipProps } from "./primitives/Tooltip/Tooltip";
export { Tooltip } from "./primitives/Tooltip/Tooltip";
export { contrastReport, tokenList, vx } from "./tokens/tokens";
