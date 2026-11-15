import { ModalFrame, TModalProps } from "../Dialog/ModalFrame";

export type TSheetProps = TModalProps;

// A modal panel along the inline end of the window for details and longer forms. Same behavior
// as Dialog: focus stays inside, Escape closes, focus returns to what opened it.
export const Sheet = (props: TSheetProps) => <ModalFrame kind="sheet" {...props} />;
