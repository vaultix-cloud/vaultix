import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Field } from "../Field/Field";
import { Select } from "./Select";

const environments = [
  { value: "dev", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "prod", label: "Production" }
];

const meta = {
  title: "Design System/Primitives/Select",
  component: Select,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "320px" }}>
        <Story />
      </div>
    )
  ],
  args: { options: environments, placeholder: "Choose an environment", onChange: fn() },
  render: (args) => (
    <Field label="Environment" help="Secrets are read from this environment.">
      <Select {...args} />
    </Field>
  ),
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native `<select>` in the text-control box, with Field wiring. It uses the platform's own picker, which is the most dependable for keyboard, screen readers and touch. **Keyboard:** Tab focuses it; Up and Down Arrow change the choice; Alt+Down (or Space) opens the list; typing letters jumps to an option. Options can be grouped. Use **Combobox** when people need to search a long list."
      }
    }
  }
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement, args }) => {
    const select = within(canvasElement).getByRole("combobox", { name: "Environment" });
    await expect(select).toHaveAccessibleDescription("Secrets are read from this environment.");
    await userEvent.selectOptions(select, "staging");
    await expect(select).toHaveValue("staging");
    await expect(args.onChange).toHaveBeenCalled();
  }
};

export const Grouped: Story = {
  args: {
    placeholder: undefined,
    defaultValue: "aws",
    options: [
      {
        group: "Cloud",
        options: [
          { value: "aws", label: "AWS Secrets Manager" },
          { value: "gcp", label: "Google Secret Manager" }
        ]
      },
      {
        group: "Platforms",
        options: [
          { value: "vercel", label: "Vercel" },
          { value: "github", label: "GitHub Actions" }
        ]
      }
    ]
  }
};

export const Required: Story = {
  args: { required: true },
  render: (args) => (
    <Field label="Environment" required error="Choose where to read secrets from.">
      <Select {...args} />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole("combobox", { name: "Environment" });
    await expect(select).toBeRequired();
    await expect(select).toBeInvalid();
  }
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "prod", placeholder: undefined }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
