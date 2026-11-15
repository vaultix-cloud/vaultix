import { iconPaths, TIconName } from "./paths";

export type TIconProps = {
  name: TIconName;
  // 16 for dense UI and inline text, 20 for navigation and empty states; any number works.
  size?: number;
  // Set only when the icon alone carries meaning (it then has role="img" and this name).
  // Most icons sit next to text or inside a named control and stay hidden from assistive tech.
  label?: string;
  className?: string;
};

// Draws in currentColor, so it takes the colour of the text or control it sits in.
export const Icon = ({ name, size = 16, label, className }: TIconProps) => (
  <svg
    className={["vx-icon", className].filter(Boolean).join(" ")}
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    focusable="false"
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {iconPaths[name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);
