import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { RadioGroup } from "./RadioGroup";

const meta = {
  title: "Design System/Primitives/Radio Group",
  component: RadioGroup,
  decorators: [withSurface],
  args: {
    legend: "When a secret is read",
    defaultValue: "log",
    onValueChange: fn(),
    options: [
      { value: "allow", label: "Allow", description: "No record beyond the access log." },
      {
        value: "log",
        label: "Allow and record a reason",
        description: "People say why; the reason is audited."
      },
      { value: "approve", label: "Require approval", description: "An approver must agree first." },
      { value: "deny", label: "Deny", disabled: true }
    ]
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "Native radios in a **Fieldset**. The browser provides the keyboard model: **Tab** enters the group at the checked radio (or the first) and leaves it in one step; **arrow keys** move and check the next or previous radio, skipping disabled ones. Each option can have a description linked with `aria-describedby`. A hint and error describe the whole group."
      }
    }
  }
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole("radiogroup", { name: "When a secret is read" });
    const radio = (name: string) => within(group).getByRole("radio", { name });
    await expect(radio("Allow and record a reason")).toBeChecked();
    await expect(radio("Require approval")).toHaveAccessibleDescription(
      "An approver must agree first."
    );
    await userEvent.tab();
    await expect(radio("Allow and record a reason")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(radio("Require approval")).toBeChecked();
    await expect(args.onValueChange).toHaveBeenLastCalledWith("approve");
    await userEvent.click(canvas.getByText("Allow"));
    await expect(radio("Allow")).toBeChecked();
    await expect(radio("Deny")).toBeDisabled();
  }
};

export const WithError: Story = {
  args: {
    defaultValue: undefined,
    required: true,
    error: "Choose what happens when a secret is read."
  },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("radiogroup", { name: "When a secret is read" });
    await expect(group).toHaveAccessibleDescription(
      "Error: Choose what happens when a secret is read."
    );
    await expect(group).toBeInvalid();
    await expect(group).toBeRequired();
  }
};

export const Horizontal: Story = {
  args: {
    legend: "Environment",
    defaultValue: "staging",
    orientation: "horizontal",
    options: [
      { value: "dev", label: "Development" },
      { value: "staging", label: "Staging" },
      { value: "prod", label: "Production" }
    ]
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
