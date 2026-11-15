import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { TextInput } from "../TextInput/TextInput";
import { Field } from "./Field";

const meta = {
  title: "Design System/Primitives/Field",
  component: Field,
  decorators: [withSurface],
  args: {
    label: "Project name",
    children: <TextInput placeholder="payments-api" />
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'Wraps one control with its visible **label**, optional **hint** and **error**. The label is a native `<label for>`, so pressing it focuses the control. The hint and error are joined into the control\'s `aria-describedby`; an error also sets `aria-invalid` and is prefixed with a hidden "Error:" so it is never conveyed by colour alone. **Required** sets the native attribute (announced by screen readers) and shows the word Required. **Keyboard:** the Field adds no tab stop; Tab reaches the control. Put the hint and error before the control so they are read first.'
      }
    }
  }
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Project name" });
    await userEvent.click(canvas.getByText("Project name"));
    await expect(input).toHaveFocus();
    await userEvent.keyboard("billing");
    await expect(input).toHaveValue("billing");
  }
};

export const WithHint: Story = {
  args: { help: "Lowercase letters, numbers and dashes. Used in the CLI and API." },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Project name" });
    await expect(input).toHaveAccessibleDescription(
      "Lowercase letters, numbers and dashes. Used in the CLI and API."
    );
  }
};

export const Required: Story = {
  args: { required: true },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Project name" });
    await expect(input).toBeRequired();
  }
};

export const WithError: Story = {
  args: {
    required: true,
    help: "Lowercase letters, numbers and dashes.",
    error: "Use only lowercase letters, numbers and dashes.",
    children: <TextInput defaultValue="Payments API" />
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Project name" });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription(
      "Lowercase letters, numbers and dashes. Error: Use only lowercase letters, numbers and dashes."
    );
  }
};

export const Disabled: Story = {
  args: { disabled: true, help: "Set by your organization." },
  render: (args) => (
    <div style={{ display: "grid", gap: "var(--vx-space-4)", maxWidth: "360px" }}>
      <Field {...args} />
      <Field label="Description">
        <TextInput />
      </Field>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Project name" })).toBeDisabled();
    await userEvent.tab();
    await expect(canvas.getByRole("textbox", { name: "Description" })).toHaveFocus();
  }
};

export const LightTheme: Story = {
  args: WithError.args,
  parameters: { vxTheme: "light" }
};
