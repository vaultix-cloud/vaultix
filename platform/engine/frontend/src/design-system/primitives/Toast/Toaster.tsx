import { KeyboardEvent, ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Icon } from "../../icons/Icon";
import { TIconName } from "../../icons/paths";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { toastStore, TToast, TToastTone } from "./toast-store";

import "./Toast.css";

// Each tone has its own shape as well as colour, so it is never told by colour alone.
const TONE_ICON: Record<TToastTone, TIconName> = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "error"
};

const TONE_NAME: Record<TToastTone, string> = {
  info: "Information",
  success: "Success",
  warning: "Warning",
  danger: "Error"
};

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
        <Icon name={TONE_ICON[item.tone]} size={18} />
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
        icon={<Icon name="close" size={14} />}
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
