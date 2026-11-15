import { KeyboardEvent, ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { toastStore, TToast, TToastTone } from "./toast-store";

import "./Toast.css";

const TONE_NAME: Record<TToastTone, string> = {
  info: "Information",
  success: "Success",
  warning: "Warning",
  danger: "Error"
};

const path: Record<TToastTone, string> = {
  info: "M8 7.25v4M8 4.75v.5",
  success: "m5 8.25 2 2 4-4.5",
  warning: "M8 5v3.75M8 10.75v.5",
  danger: "m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5"
};

// Each tone has its own shape as well as colour, so it is never told by colour alone.
const ToneIcon = ({ tone }: { tone: TToastTone }) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true" focusable="false">
    {tone === "warning" ? (
      <path
        d="M8 1.75 14.75 13.5H1.25z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ) : (
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    )}
    <path d={path[tone]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" focusable="false">
    <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const ToastItem = ({ item, paused }: { item: TToast; paused: boolean }) => {
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => toastStore.dismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, item.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    toastStore.dismiss(item.id);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape inside a toast closes it
    <li className="vx-toast" data-tone={item.tone} onKeyDown={onKeyDown}>
      <span className="vx-toast__icon">
        <ToneIcon tone={item.tone} />
      </span>
      <div className="vx-toast__text">
        <p className="vx-toast__title">
          <span className="vx-toast__tone">{TONE_NAME[item.tone]}: </span>
          {item.title}
        </p>
        {item.description && <p className="vx-toast__description">{item.description}</p>}
        {item.action && (
          <div className="vx-toast__actions">
            <Button
              size="sm"
              onClick={() => {
                item.action?.onAction();
                toastStore.dismiss(item.id);
              }}
            >
              {item.action.label}
            </Button>
          </div>
        )}
      </div>
      <IconButton
        className="vx-toast__close"
        size="sm"
        label="Dismiss"
        icon={<CloseIcon />}
        tooltipSide="left"
        onClick={() => toastStore.dismiss(item.id)}
      />
    </li>
  );
};

const announcement = (item: TToast) =>
  [
    `${TONE_NAME[item.tone]}: ${item.title}`,
    item.description,
    item.action && `${item.action.label} is available. Press F8 to reach notifications.`
  ]
    .filter(Boolean)
    .join(". ");

export type TToasterProps = {
  // Moves focus to the notifications so a keyboard user can act on or dismiss them.
  hotkey?: string;
  // Toasts beyond this wait their turn.
  max?: number;
  label?: ReactNode;
};

// Mount once near the root. Toasts are announced through two live regions that are always in the
// page (polite for information, success and warning; an alert for errors), which screen readers
// announce more reliably than inserted elements. Timers pause while the pointer or focus is on
// the notifications (WCAG 2.2.1).
export const Toaster = ({ hotkey = "F8", max = 4, label = "Notifications" }: TToasterProps) => {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.snapshot,
    toastStore.snapshot
  );
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const announced = useRef(0);
  const region = useRef<HTMLElement>(null);

  useEffect(() => {
    const fresh = toasts.filter((item) => item.id > announced.current);
    if (fresh.length === 0) return;
    announced.current = Math.max(...fresh.map((item) => item.id));
    const urgent = fresh.filter((item) => item.tone === "danger");
    const calm = fresh.filter((item) => item.tone !== "danger");
    if (urgent.length) setAssertive(urgent.map(announcement).join(" "));
    if (calm.length) setPolite(calm.map(announcement).join(" "));
  }, [toasts]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== hotkey || !region.current?.querySelector(".vx-toast")) return;
      event.preventDefault();
      region.current.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkey]);

  const visible = toasts.slice(-max);
  const paused = hovered || focused;

  return (
    <section
      ref={region}
      className="vx-toaster"
      aria-label={typeof label === "string" ? label : "Notifications"}
      aria-keyshortcuts={hotkey}
      tabIndex={-1}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <ol className="vx-toaster__list">
        {visible.map((item) => (
          <ToastItem key={item.id} item={item} paused={paused} />
        ))}
      </ol>
      <div className="vx-toaster__live" role="status" aria-live="polite">
        {polite}
      </div>
      <div className="vx-toaster__live" role="alert">
        {assertive}
      </div>
    </section>
  );
};
