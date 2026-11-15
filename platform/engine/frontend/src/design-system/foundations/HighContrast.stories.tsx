import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "../primitives/Button/Button";
import { Checkbox } from "../primitives/Choice/Checkbox";
import { Field } from "../primitives/Field/Field";
import { Switch } from "../primitives/Switch/Switch";
import { Tabs } from "../primitives/Tabs/Tabs";
import { TextInput } from "../primitives/TextInput/TextInput";
import { withSurface } from "../storybook/Surface";

const Sample = () => (
  <div style={{ display: "grid", gap: "var(--vx-space-5)", maxWidth: "420px" }}>
    <Tabs
      label="Sections"
      tabs={[
        { id: "secrets", label: "Secrets", count: 42, content: null },
        { id: "access", label: "Access", content: null }
      ]}
    />
    <Field
      label="Project name"
      help="Lowercase letters, numbers and dashes."
      error="Use only lowercase letters."
    >
      <TextInput defaultValue="Payments API" />
    </Field>
    <Field label="Description">
      <TextInput placeholder="What this project is for" />
    </Field>
    <Checkbox label="Mask values in the audit log" description="Readers see ••••• instead." />
    <Switch label="Require a reason to read" defaultChecked />
    <div style={{ display: "flex", gap: "var(--vx-space-2)" }}>
      <Button variant="primary">Save</Button>
      <Button>Cancel</Button>
    </div>
  </div>
);

const meta = {
  title: "Design System/Foundations/High Contrast",
  component: Sample,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    vxContrast: "more",
    docs: {
      description: {
        component:
          'The high-contrast variant, used when the system asks for more contrast (`prefers-contrast: more`) or when `data-contrast="more"` is set on any ancestor (an in-app setting can set it). It strengthens borders and control outlines, raises secondary and muted text, and widens the focus ring to 3px, in both themes. Every contrast pair is checked in both high-contrast themes as well. Windows high contrast (forced colours) is handled separately by each component.'
      }
    }
  }
} satisfies Meta<typeof Sample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Description" });
    await userEvent.click(input);
    await userEvent.tab({ shift: true });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input.parentElement as Element).outlineWidth).toBe("3px");
  }
};

export const Light: Story = { parameters: { vxTheme: "light", vxContrast: "more" } };
