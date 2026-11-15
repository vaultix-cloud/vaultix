import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { toast, toastStore } from "./toast-store";
import { Toaster } from "./Toaster";

const onUndo = fn();

const Demo = () => {
  useEffect(() => () => toastStore.clear(), []);
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: "var(--vx-space-2)", minHeight: "320px" }}
    >
      <Button onClick={() => toast({ title: "Secret saved", tone: "success" })}>Save</Button>
      <Button
        onClick={() =>
          toast({
            title: "DATABASE_URL deleted",
            description: "It is removed from Production.",
            action: { label: "Undo", onAction: onUndo }
          })
        }
      >
        Delete
      </Button>
      <Button
        onClick={() =>
          toast({
            title: "Rotation failed",
            description: "The database rejected the new password. The old one still works.",
            tone: "danger"
          })
        }
      >
        Fail
      </Button>
      <Button
        onClick={() =>
          toast({
            title: "Key expires in 3 days",
            tone: "warning",
            description: "Rotate it from Settings."
          })
        }
      >
        Warn
      </Button>
      <Toaster />
    </div>
  );
};

const meta = {
  title: "Design System/Primitives/Toast",
  component: Demo,
  decorators: [withSurface],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "Brief news about something that just happened. Raise one from anywhere with `toast({ title, description, tone, action })`; mount `<Toaster />` once. **Announcements:** two live regions are always in the page, polite for information, success and warning and an alert for errors, so screen readers announce reliably; focus never moves on its own. **Timing (WCAG 2.2.1):** information and success close after 6 s and warnings after 10 s; anything with an action stays at least 10 s; errors stay until dismissed; every timer pauses while the pointer or focus is on the notifications. **Keyboard:** F8 moves focus to the notifications region; Tab reaches each action and Dismiss button; Escape closes the toast that has focus (an open tooltip closes first). Each tone has its own icon shape and a spoken tone word, so colour is never the only signal."
      }
    }
  }
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Announce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent("Success: Secret saved")
    );
    await userEvent.click(canvas.getByRole("button", { name: "Fail" }));
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "Error: Rotation failed. The database rejected the new password."
      )
    );
    const list = canvas.getByRole("region", { name: "Notifications" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  }
};

export const KeyboardAndAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    const region = canvas.getByRole("region", { name: "Notifications" });
    await waitFor(() => within(region).getByText("DATABASE_URL deleted"));
    await userEvent.keyboard("{F8}");
    await expect(region).toHaveFocus();
    await userEvent.tab();
    await expect(within(region).getByRole("button", { name: "Undo" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(onUndo).toHaveBeenCalledOnce();
    await waitFor(() => expect(within(region).queryByText("DATABASE_URL deleted")).toBeNull());
  }
};

export const EscapeDismisses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Fail" }));
    const region = canvas.getByRole("region", { name: "Notifications" });
    await waitFor(() => within(region).getByRole("listitem"));
    await userEvent.keyboard("{F8}");
    await userEvent.tab();
    await expect(within(region).getByRole("button", { name: "Dismiss" })).toHaveFocus();
    // Keyboard focus shows the button's tooltip; the first Escape closes that, the next the toast.
    await waitFor(() => expect(document.querySelector(".vx-tooltip")).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector(".vx-tooltip")).toBeNull());
    await expect(within(region).getByRole("listitem")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(region).queryByRole("listitem")).toBeNull());
  }
};

export const AllTones: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Raised one after another, in this order.
    await ["Save", "Warn", "Delete", "Fail"].reduce(
      (previous, name) =>
        previous.then(() => userEvent.click(canvas.getByRole("button", { name }))),
      Promise.resolve()
    );
  }
};

export const LightTheme: Story = { ...AllTones, parameters: { vxTheme: "light" } };
