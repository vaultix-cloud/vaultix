import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { TextInput } from "../TextInput/TextInput";
import { Dialog, TDialogProps } from "./Dialog";

type TDemoProps = Omit<TDialogProps, "open" | "onOpenChange"> & {
  trigger: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const RenameDemo = ({ trigger, defaultOpen = false, onOpenChange, ...props }: TDemoProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <Button onClick={() => change(true)}>{trigger}</Button>
      <Dialog
        {...props}
        open={open}
        onOpenChange={change}
        footer={
          <>
            <Button onClick={() => change(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => change(false)}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Project name" help="Lowercase letters, numbers and dashes.">
          <TextInput defaultValue="payments-api" />
        </Field>
      </Dialog>
    </>
  );
};

const DeleteDemo = ({ defaultOpen = false }: { defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      <Dialog
        role="alertdialog"
        size="sm"
        open={open}
        onOpenChange={setOpen}
        initialFocus={cancel}
        title="Delete payments-api?"
        description="Its 42 secrets and their history are deleted for everyone. This cannot be undone."
        footer={
          <>
            <Button ref={cancel} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete project
            </Button>
          </>
        }
      />
    </>
  );
};

const meta = {
  title: "Design System/Primitives/Dialog",
  component: RenameDemo,
  decorators: [withSurface],
  args: {
    trigger: "Rename project",
    title: "Rename project",
    description: "The new name is used in the CLI, the API and every reference.",
    onOpenChange: fn()
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'A modal dialog on the native `<dialog>` with `showModal()`: it sits in the top layer, the page behind is inert and does not scroll, and focus stays inside. It is named by its title (`aria-labelledby`) and described by its description (`aria-describedby`). **Keyboard:** on open, focus goes to `initialFocus`, else the first control in the content, else the footer, else the title. Tab and Shift+Tab move through the dialog only. **Escape** closes it, as do the Close button and a press on the backdrop, unless `dismissible` is off. On close, focus returns to the element that opened it. Use `role="alertdialog"` for an interrupting confirmation, with a description and the safe choice focused first.'
      }
    }
  }
} satisfies Meta<typeof RenameDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialogNamed = async (name: string) =>
  waitFor(() => within(document.body).getByRole("dialog", { name }));

export const Basic: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Rename project" });
    await userEvent.click(trigger);
    const dialog = await dialogNamed("Rename project");
    await expect(dialog).toHaveAccessibleDescription(
      "The new name is used in the CLI, the API and every reference."
    );
    const input = within(dialog).getByRole("textbox", { name: "Project name" });
    await expect(input).toHaveFocus();
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true);
    // Escape reaches the dialog as a cancel event; this is the event the browser sends.
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
    await expect(trigger).toHaveFocus();
  }
};

export const CloseButtonAndBackdrop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Rename project" });
    await userEvent.click(trigger);
    let dialog = await dialogNamed("Rename project");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    await expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    dialog = await dialogNamed("Rename project");
    // A press inside the box that is released on the backdrop does not close it.
    within(dialog)
      .getByRole("textbox")
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(dialog).toHaveAttribute("open");
    dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  }
};

export const NotDismissible: Story = {
  args: {
    dismissible: false,
    title: "Rotating keys",
    description: "Wait for the rotation to finish."
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Rename project" }));
    const dialog = await dialogNamed("Rotating keys");
    await expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(dialog).toHaveAttribute("open");
  }
};

export const ConfirmDelete: Story = {
  render: () => <DeleteDemo />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete project" }));
    const dialog = await waitFor(() =>
      within(document.body).getByRole("alertdialog", { name: "Delete payments-api?" })
    );
    await expect(dialog).toHaveAccessibleDescription(
      "Its 42 secrets and their history are deleted for everyone. This cannot be undone."
    );
    await expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  }
};

export const Open: Story = { args: { defaultOpen: true } };

export const OpenLightTheme: Story = {
  args: { defaultOpen: true },
  parameters: { vxTheme: "light" }
};
