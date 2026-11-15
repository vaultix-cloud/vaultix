import { ReactNode } from "react";

import "./EmptyState.css";

export type TEmptyStateProps = {
  title: string;
  // What this place is for and how to fill it.
  description?: ReactNode;
  icon?: ReactNode;
  // The next step, usually one primary Button and perhaps a secondary one.
  actions?: ReactNode;
  // The heading level that fits the page outline.
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

// What a list or page shows when it has nothing yet, or when a filter matches nothing: say what
// belongs here and offer the next step.
export const EmptyState = ({
  title,
  description,
  icon,
  actions,
  headingLevel = 2,
  className
}: TEmptyStateProps) => {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={["vx-empty", className].filter(Boolean).join(" ")}>
      {icon && (
        <span className="vx-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <Heading className="vx-empty__title">{title}</Heading>
      {description && <p className="vx-empty__description">{description}</p>}
      {actions && <div className="vx-empty__actions">{actions}</div>}
    </div>
  );
};
