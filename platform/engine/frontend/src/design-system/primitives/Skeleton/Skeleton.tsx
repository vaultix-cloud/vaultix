import { CSSProperties, ReactNode } from "react";

import "./Skeleton.css";

export type TSkeletonProps = {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  // "text" lines take the font's line height; "circle" is for avatars and icons.
  shape?: "block" | "text" | "circle";
  className?: string;
};

// A placeholder shape while content loads. Hidden from assistive technology: wrap loading areas in
// <Loading>, which says what is loading once.
export const Skeleton = ({ width, height, shape = "block", className }: TSkeletonProps) => (
  <span
    className={["vx-skeleton", `vx-skeleton--${shape}`, className].filter(Boolean).join(" ")}
    style={{ width, height }}
    aria-hidden="true"
  />
);

export type TLoadingProps = {
  // What is loading, read once by screen readers, e.g. "Loading secrets".
  label: string;
  loading: boolean;
  children: ReactNode;
  // Shown while loading; usually Skeleton shapes laid out like the content.
  placeholder: ReactNode;
};

// Marks an area busy while it loads and announces what is loading, then shows the content.
export const Loading = ({ label, loading, children, placeholder }: TLoadingProps) => (
  <div className="vx-loading" aria-busy={loading || undefined}>
    <span className="vx-loading__status" role="status">
      {loading ? label : ""}
    </span>
    {loading ? placeholder : children}
  </div>
);
