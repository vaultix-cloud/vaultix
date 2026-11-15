import { ReactElement, ReactNode, useEffect, useId, useState } from "react";

import { Icon } from "../icons/Icon";
import { IconButton } from "../primitives/IconButton/IconButton";
import { Tooltip } from "../primitives/Tooltip/Tooltip";
import { BrandLockup } from "./Brand";

import "./AppFrame.css";

export type TRailItem = {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  current?: boolean;
};

export type TRailGroup = { id: string; label: string; items: TRailItem[] };

// The app supplies its router's link (TanStack Router in the product); the frame never imports it.
export type TRenderLink = (props: {
  href: string;
  className: string;
  "aria-current"?: "page";
  "aria-label"?: string;
  children: ReactNode;
}) => ReactElement;

const defaultLink: TRenderLink = ({ href, className, children, ...rest }) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

const STORAGE_KEY = "vaultix.frame.expanded";

const readExpanded = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export type TAppFrameProps = {
  groups: TRailGroup[];
  // Defaults to the Vaultix lockup linked to homeHref.
  brand?: ReactNode;
  homeHref?: string;
  header?: ReactNode;
  footer?: ReactNode;
  renderLink?: TRenderLink;
  children: ReactNode;
  defaultExpanded?: boolean;
};

// The Vaultix app frame (docs/0130 phase 2): an icon rail whose items show their names as tooltips,
// a full menu that opens out of the rail with group headings and labels, a header, and the main
// region. The person's choice to keep the menu open is remembered on this device.
export const AppFrame = ({
  groups,
  brand,
  homeHref = "/",
  header,
  footer,
  renderLink = defaultLink,
  children,
  defaultExpanded
}: TAppFrameProps) => {
  const [expanded, setExpanded] = useState(() => defaultExpanded ?? readExpanded());
  const mainId = useId();
  const navId = useId();

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(expanded));
    } catch {
      // Storage can be unavailable (private windows); the menu still works for this visit.
    }
  }, [expanded]);

  const item = (entry: TRailItem) => {
    const link = renderLink({
      href: entry.href,
      className: "vx-rail__item",
      "aria-current": entry.current ? "page" : undefined,
      children: (
        <>
          <span className="vx-rail__icon" aria-hidden="true">
            {entry.icon}
          </span>
          <span className="vx-rail__label">{entry.label}</span>
        </>
      )
    });
    return (
      <li key={entry.id}>
        {expanded ? (
          link
        ) : (
          // Collapsed, the visible label is hidden; the link keeps it as its accessible name and the
          // tooltip shows it on hover and keyboard focus without being read a second time.
          <Tooltip content={entry.label} kind="label" side="right">
            {link}
          </Tooltip>
        )}
      </li>
    );
  };

  const home = renderLink({
    href: homeHref,
    className: "vx-rail__home",
    "aria-label": "Vaultix home",
    children: <BrandLockup />
  });
  const homeLink = expanded ? (
    home
  ) : (
    <Tooltip content="Vaultix home" kind="label" side="right">
      {home}
    </Tooltip>
  );

  return (
    <div className="vx-frame">
      <a className="vx-frame__skip" href={`#${mainId}`}>
        Skip to content
      </a>
      <aside className="vx-rail" data-expanded={expanded}>
        <div className="vx-rail__top">
          {brand ?? homeLink}
          <IconButton
            icon={<Icon name={expanded ? "chevron-left" : "menu"} size={20} />}
            label={expanded ? "Collapse menu" : "Expand menu"}
            tooltipSide="right"
            size="lg"
            aria-expanded={expanded}
            aria-controls={navId}
            onClick={() => setExpanded((open) => !open)}
          />
        </div>
        <nav id={navId} className="vx-rail__nav" aria-label="Main">
          {groups.map((group) => (
            <section
              key={group.id}
              className="vx-rail__group"
              aria-labelledby={`${navId}-${group.id}`}
            >
              <h2 id={`${navId}-${group.id}`} className="vx-rail__heading">
                {group.label}
              </h2>
              <ul className="vx-rail__list">{group.items.map(item)}</ul>
            </section>
          ))}
        </nav>
        {footer && <div className="vx-rail__bottom">{footer}</div>}
      </aside>
      {header && <header className="vx-frame__header">{header}</header>}
      <main id={mainId} className="vx-frame__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
};
