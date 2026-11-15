import { AnchorHTMLAttributes, forwardRef } from "react";

import { Icon } from "../../icons/Icon";

import "./Link.css";

export type TLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  // Opens in a new tab with an icon and a spoken "(opens in a new tab)", and never shares the
  // opener or referrer.
  external?: boolean;
  // "subtle" takes the surrounding text colour; both keep the underline so a link is never told
  // apart by colour alone (WCAG 1.4.1).
  variant?: "default" | "subtle";
};

// The class a router's own link component can use to look the same, e.g. TanStack Router's <Link>.
export const linkClassName = (variant: TLinkProps["variant"] = "default") =>
  ["vx-link", variant === "subtle" && "vx-link--subtle"].filter(Boolean).join(" ");

export const Link = forwardRef<HTMLAnchorElement, TLinkProps>(
  ({ external = false, variant = "default", className, children, ...rest }, ref) => (
    <a
      ref={ref}
      className={[linkClassName(variant), className].filter(Boolean).join(" ")}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      {...rest}
    >
      {children}
      {external && (
        <>
          <Icon name="external" size={12} className="vx-link__external" />
          <span className="vx-link__hint"> (opens in a new tab)</span>
        </>
      )}
    </a>
  )
);
Link.displayName = "Link";
