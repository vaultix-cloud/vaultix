import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { TextInput } from "../TextInput/TextInput";
import { Popover } from "./Popover";

const meta = {
  title: "Design System/Primitives/Popover",
  component: Popover,
  decorators: [withSurface],
  args: {
    trigger: <Button>Filter</Button>,
    title: "Filter secrets",
    children: ({ close }: { close: () => void }) => (
      <>
        <Field label="Name contains">
          <TextInput placeholder="DATABASE" />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="sm" variant="primary" onClick={close}>
            Apply
          </Button>
        </div>
      </>
    )
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'A non-modal panel anchored to a button, in the top layer. The button has `aria-expanded`, `aria-controls` and `aria-haspopup="dialog"`; the panel is a `dialog` named by its title or `label`. **Keyboard:** Enter or Space on the button opens it and moves focus to `initialFocus` or the first control inside; Tab moves through it and on to the rest of the page in reading order; Escape closes it and returns focus to the button. A press outside closes it and leaves focus where the press landed. Use Dialog instead when the person must finish or cancel before going on.'
      }
    }
  }
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Filter" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const panel = await waitFor(() =>
      within(document.body).getByRole("dialog", { name: "Filter secrets" })
    );
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", panel.id);
    const input = within(panel).getByRole("textbox", { name: "Name contains" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  }
};

export const CloseFromInside: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Filter" });
    await userEvent.click(trigger);
    const panel = await waitFor(() =>
      within(document.body).getByRole("dialog", { name: "Filter secrets" })
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  }
};

export const OutsidePress: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Filter" });
    await userEvent.click(trigger);
    const panel = await waitFor(() => within(document.body).getByRole("dialog"));
    await userEvent.click(trigger);
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    await userEvent.click(trigger);
    const again = await waitFor(() => within(document.body).getByRole("dialog"));
    await userEvent.click(canvasElement);
    await waitFor(() => expect(again).not.toBeInTheDocument());
  }
};

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Filter" }));
    await waitFor(() => within(document.body).getByRole("dialog"));
  }
};
