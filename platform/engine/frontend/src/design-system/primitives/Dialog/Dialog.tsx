import { ModalFrame, TModalProps } from "./ModalFrame";

export type TDialogProps = TModalProps & {
  size?: "sm" | "md" | "lg";
  // "alertdialog" for a confirmation that interrupts, such as deleting something. It needs a
  // description, and initialFocus should be the safe choice.
  role?: "dialog" | "alertdialog";
};

// A centered modal dialog (WAI-ARIA dialog and alertdialog patterns) on the native <dialog>.
export const Dialog = (props: TDialogProps) => <ModalFrame kind="dialog" {...props} />;
