import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Checkbox } from "../Choice/Checkbox";
import { Fieldset } from "./Fieldset";

const meta = {
  title: "Design System/Primitives/Fieldset",
  component: Fieldset,
  decorators: [withSurface],
  args: {
    legend: "Who can request access",
    help: "Requests go to the project's approvers.",
    children: (
      <>
        <Checkbox label="Members" defaultChecked />
        <Checkbox label="Machine identities" />
        <Checkbox label="Guests" />
      </>
    )
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native `<fieldset>` whose `<legend>` names a group of checkboxes, radios or switches; screen readers announce the legend when focus enters the group. The hint and error describe the group. **Disabled** disables every control inside. **Keyboard:** the fieldset adds no Tab stop; each control inside keeps its own keyboard behaviour."
      }
    }
  }
} satisfies Meta<typeof Fieldset>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("group", { name: "Who can request access" });
    await expect(group).toHaveAccessibleDescription("Requests go to the project's approvers.");
    await userEvent.tab();
    await expect(within(group).getByRole("checkbox", { name: "Members" })).toHaveFocus();
  }
};

export const Disabled: Story = {
  args: { disabled: true, help: "Managed by your organization." },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("group", { name: "Who can request access" });
    await Promise.all(
      within(group)
        .getAllByRole("checkbox")
        .map((box) => expect(box).toBeDisabled())
    );
  }
};

export const Horizontal: Story = { args: { orientation: "horizontal" } };

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
