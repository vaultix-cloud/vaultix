// The Vaultix mark from branding/mark.svg, drawn with tokens so it follows the theme: a lock on a
// rounded tile. Decorative; the link around it carries the name.
export const BrandMark = ({ size = 32 }: { size?: number }) => (
  <svg
    className="vx-brand__mark"
    viewBox="0 0 64 64"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="64" height="64" rx="14" className="vx-brand__tile" />
    <g className="vx-brand__lock" fill="none" strokeWidth="4.5" strokeLinecap="round">
      <rect x="15" y="27" width="34" height="25" rx="6" />
      <path d="M23 27v-6a9 9 0 0 1 18 0v6" />
    </g>
    <circle cx="32" cy="38" r="3.5" className="vx-brand__keyhole" />
    <rect x="30.5" y="38" width="3" height="7" rx="1.5" className="vx-brand__keyhole" />
  </svg>
);

// The wordmark: the mark and the name. The name shows only when there is room (the expanded rail).
export const BrandLockup = () => (
  <span className="vx-brand">
    <BrandMark />
    <span className="vx-brand__word">Vaultix</span>
  </span>
);
