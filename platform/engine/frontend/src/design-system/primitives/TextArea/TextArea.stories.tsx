import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Field } from "../Field/Field";
import { TextArea } from "./TextArea";

const meta = {
  title: "Design System/Primitives/Text Area",
  component: TextArea,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "480px" }}>
        <Story />
      </div>
    )
  ],
  args: { placeholder: "What this secret is for and who owns it" },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native `<textarea>` with the same box, states and Field wiring as Text Input. **Keyboard:** Tab focuses it; Enter adds a line; Tab leaves it (it never traps Tab). **Grow** sizes it to its text where the browser supports `field-sizing`, up to 24 lines; elsewhere it keeps its rows and can be resized vertically."
      }
    }
  },
  render: (args) => (
    <Field label="Description" help="Shown to everyone who can see this secret.">
      <TextArea {...args} />
    </Field>
  )
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const area = within(canvasElement).getByRole("textbox", { name: "Description" });
    await expect(area).toHaveAccessibleDescription("Shown to everyone who can see this secret.");
    await userEvent.tab();
    await expect(area).toHaveFocus();
    await userEvent.keyboard("Rotated monthly.{Enter}Owner: platform team.");
    await expect(area).toHaveValue("Rotated monthly.\nOwner: platform team.");
    await userEvent.tab();
    await expect(area).not.toHaveFocus();
  }
};

export const Grow: Story = { args: { grow: true, rows: 2 } };

export const Monospaced: Story = {
  args: {
    mono: true,
    defaultValue: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh…\n-----END PUBLIC KEY-----"
  }
};

export const Invalid: Story = {
  render: (args) => (
    <Field label="Description" error="Keep it under 500 characters.">
      <TextArea {...args} defaultValue="…" />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const area = within(canvasElement).getByRole("textbox", { name: "Description" });
    await expect(area).toBeInvalid();
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
