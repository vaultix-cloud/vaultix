import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { TextInput } from "./TextInput";

const SearchIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const meta = {
  title: "Design System/Primitives/Text Input",
  component: TextInput,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "360px" }}>
        <Story />
      </div>
    )
  ],
  args: { "aria-label": "Secret name", placeholder: "DATABASE_URL" },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native `<input>` in a bordered box that can also hold **leading** and **trailing** content (an icon, a unit, a button). Use it inside a **Field** for its label, hint and error; on its own it needs an `aria-label`. **Keyboard:** Tab focuses the text, then any button in the trailing slot; all native editing keys apply. The box shows the focus ring while anything inside it has focus. **Read-only** keeps the text focusable and selectable with a dashed border; **disabled** leaves the tab order. Pressing the padding or a decorative adornment focuses the text. On touch screens the text is 16 px so the page does not zoom."
      }
    }
  }
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Secret name" });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input.parentElement as Element).outlineStyle).toBe("solid");
    await userEvent.keyboard("STRIPE_KEY");
    await expect(input).toHaveValue("STRIPE_KEY");
  }
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: "var(--vx-space-3)" }}>
      <TextInput {...args} size="sm" aria-label="Small" />
      <TextInput {...args} size="md" aria-label="Medium" />
      <TextInput {...args} size="lg" aria-label="Large" />
    </div>
  )
};

export const Monospaced: Story = {
  args: { mono: true, defaultValue: "vx_ref_payments/prod/DB_URL" }
};

export const WithAdornments: Story = {
  args: { "aria-label": undefined, placeholder: "Search secrets" },
  render: (args) => (
    <Field label="Search">
      <TextInput
        {...args}
        type="search"
        leading={<SearchIcon />}
        trailing={
          <Button size="sm" variant="ghost" onClick={fn()}>
            Clear
          </Button>
        }
      />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("searchbox", { name: "Search" });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Clear" })).toHaveFocus();
    await expect(getComputedStyle(input.parentElement as Element).outlineStyle).toBe("none");
    await userEvent.click(canvasElement.querySelector(".vx-input__adornment svg") as Element);
    await expect(input).toHaveFocus();
  }
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: "https://vault.example.com", "aria-label": "Instance URL" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Instance URL" });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await expect(input).toHaveAttribute("readonly");
  }
};

export const Disabled: Story = { args: { disabled: true, defaultValue: "Managed by policy" } };

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  render: (args) => (
    <div style={{ display: "grid", gap: "var(--vx-space-3)" }}>
      <TextInput {...args} />
      <TextInput {...args} aria-label="Invalid" invalid defaultValue="bad name" />
      <TextInput {...args} aria-label="Read only" readOnly defaultValue="read only" />
    </div>
  )
};
