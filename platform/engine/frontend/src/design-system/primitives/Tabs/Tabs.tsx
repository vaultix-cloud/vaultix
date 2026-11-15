import { KeyboardEvent, ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import "./Tabs.css";

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export type TTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  // A count shown after the label and read as part of the tab's name, e.g. "Secrets 42".
  count?: number;
  disabled?: boolean;
  content: ReactNode;
};

export type TTabsProps = {
  tabs: TTab[];
  // Names the tab list for assistive technology, e.g. "Project sections".
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  // "automatic" shows a panel as soon as its tab has focus; "manual" waits for Enter or Space,
  // for panels that are slow to load.
  activation?: "automatic" | "manual";
  className?: string;
};

// The WAI-ARIA tabs pattern. Only the selected tab is in the Tab order; arrow keys move between
// tabs. Every panel element exists (so aria-controls always resolves), but only the selected
// panel's content is rendered.
export const Tabs = ({
  tabs,
  label,
  value,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  activation = "automatic",
  className
}: TTabsProps) => {
  const firstEnabled = tabs.find((tab) => !tab.disabled)?.id ?? "";
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? firstEnabled);
  const selected = value ?? uncontrolled;
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const panelRefs = useRef(new Map<string, HTMLDivElement | null>());
  const id = useId();
  const tabId = (tab: string) => `${id}-tab-${tab}`;
  const panelId = (tab: string) => `${id}-panel-${tab}`;

  // A panel is a Tab stop only when it has no controls of its own; otherwise Tab goes straight
  // from the tab to the panel's first control.
  useLayoutEffect(() => {
    const panel = panelRefs.current.get(selected);
    if (!panel) return;
    if (panel.querySelector(FOCUSABLE)) panel.removeAttribute("tabindex");
    else panel.tabIndex = 0;
  });

  const choose = (tab: string) => {
    if (value === undefined) setUncontrolled(tab);
    onValueChange?.(tab);
  };

  const enabled = tabs.filter((tab) => !tab.disabled);
  const move = (from: string, to: "next" | "previous" | "first" | "last") => {
    const at = enabled.findIndex((tab) => tab.id === from);
    let target = enabled[0];
    if (to === "last") target = enabled[enabled.length - 1];
    if (to === "next") target = enabled[(at + 1) % enabled.length];
    if (to === "previous") target = enabled[(at - 1 + enabled.length) % enabled.length];
    if (!target) return;
    tabRefs.current.get(target.id)?.focus();
    if (activation === "automatic") choose(target.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: string) => {
    const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    if (event.key === next) move(tab, "next");
    else if (event.key === previous) move(tab, "previous");
    else if (event.key === "Home") move(tab, "first");
    else if (event.key === "End") move(tab, "last");
    else return;
    event.preventDefault();
  };

  return (
    <div className={["vx-tabs", `vx-tabs--${orientation}`, className].filter(Boolean).join(" ")}>
      <div
        className="vx-tabs__list"
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
      >
        {tabs.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current.set(tab.id, node);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              className="vx-tabs__tab"
              aria-selected={isSelected}
              aria-controls={panelId(tab.id)}
              tabIndex={isSelected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => choose(tab.id)}
              onKeyDown={(event) => onKeyDown(event, tab.id)}
            >
              {tab.icon && (
                <span className="vx-tabs__icon" aria-hidden="true">
                  {tab.icon}
                </span>
              )}
              <span>{tab.label}</span>
              {tab.count !== undefined && <span className="vx-tabs__count">{tab.count}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelId(tab.id)}
          role="tabpanel"
          aria-labelledby={tabId(tab.id)}
          ref={(node) => {
            panelRefs.current.set(tab.id, node);
          }}
          className="vx-tabs__panel"
          hidden={tab.id !== selected}
        >
          {tab.id === selected && tab.content}
        </div>
      ))}
    </div>
  );
};
