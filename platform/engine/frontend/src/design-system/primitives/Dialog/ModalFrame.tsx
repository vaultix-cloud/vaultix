import {
  MouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef
} from "react";

import { Icon } from "../../icons/Icon";
import { IconButton } from "../IconButton/IconButton";

import "./Dialog.css";

export type TModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  // A sentence under the title saying what the dialog is for or what will happen.
  description?: ReactNode;
  children?: ReactNode;
  // Actions, usually the cancel button first and the confirming button last.
  footer?: ReactNode;
  // Escape, the close button and a press on the backdrop close it. Turn off while work is
  // running or when a choice must be made.
  dismissible?: boolean;
  // The element to focus when it opens. By default the first control in the content, then the
  // footer; with neither, the title.
  initialFocus?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  className?: string;
};

type TFrameProps = TModalProps & {
  kind: "dialog" | "sheet";
  role?: "dialog" | "alertdialog";
  size?: "sm" | "md" | "lg";
};

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// A modal on the native <dialog>: showModal() puts it in the top layer, makes the rest of the
// page inert (which keeps focus inside) and turns Escape into a cancel event. This component keeps
// React state in charge of open, chooses the first focus, and returns focus to where it was.
export const ModalFrame = ({
  kind,
  role = "dialog",
  size = "md",
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocus,
  closeLabel = "Close",
  className
}: TFrameProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const first =
        initialFocus?.current ??
        dialog.querySelector<HTMLElement>(`.vx-modal__body :is(${FOCUSABLE})`) ??
        dialog.querySelector<HTMLElement>(`.vx-modal__footer :is(${FOCUSABLE})`) ??
        dialog.querySelector<HTMLElement>(".vx-modal__title");
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  useEffect(() => {
    if (open) return undefined;
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
    return undefined;
  }, [open]);

  // Unmounting while open also hands focus back.
  useEffect(
    () => () => {
      if (returnTo.current?.isConnected) returnTo.current.focus();
    },
    []
  );

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dismissible) onOpenChange(false);
  };

  // The browser can close a dialog on its own (a form with method="dialog", or a second Escape).
  const handleClose = () => {
    if (open) onOpenChange(false);
  };

  // The dialog box has no padding, so a press whose target is the <dialog> itself landed on the
  // backdrop. Both ends of the press must be there, so selecting text and releasing outside the
  // box does not close it.
  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  };
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    const onBackdrop = pressStartedOnBackdrop.current && event.target === event.currentTarget;
    pressStartedOnBackdrop.current = false;
    if (onBackdrop && dismissible) onOpenChange(false);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the backdrop press mirrors Escape, which the native dialog already handles
    <dialog
      ref={ref}
      className={["vx-modal", `vx-${kind}`, kind === "dialog" && `vx-dialog--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={handleCancel}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {open && (
        <div className="vx-modal__panel">
          <header className="vx-modal__header">
            <h2 id={titleId} className="vx-modal__title" tabIndex={-1}>
              {title}
            </h2>
            {dismissible && (
              <IconButton
                className="vx-modal__close"
                icon={<Icon name="close" />}
                label={closeLabel}
                size="sm"
                tooltipSide="bottom"
                onClick={() => onOpenChange(false)}
              />
            )}
          </header>
          {description && (
            <p id={descriptionId} className="vx-modal__description">
              {description}
            </p>
          )}
          {children && <div className="vx-modal__body">{children}</div>}
          {footer && <footer className="vx-modal__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
};
