import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Fieldset } from "../Fieldset/Fieldset";
import { Switch } from "./Switch";

const meta = {
  title: "Design System/Primitives/Switch",
  component: Switch,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "420px" }}>
        <Story />
      </div>
    )
  ],
  args: {
    label: "Require a reason to read production secrets",
    description: "The reason is recorded in the audit log.",
    onCheckedChange: fn()
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'An on/off setting that takes effect at once; use a Checkbox when the choice is submitted with a form. A native checkbox with `role="switch"`, so it is announced as on or off. **Keyboard:** Tab focuses it and Space toggles it. The thumb\'s position shows the state, so it never relies on colour alone, and the on track meets 3:1 against its surface in both themes.'
      }
    }
  }
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement, args }) => {
    const toggle = within(canvasElement).getByRole("switch", {
      name: "Require a reason to read production secrets"
    });
    await expect(toggle).toHaveAccessibleDescription("The reason is recorded in the audit log.");
    await expect(toggle).not.toBeChecked();
    await userEvent.tab();
    await expect(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(toggle).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(
      within(canvasElement).getByText("Require a reason to read production secrets")
    );
    await expect(toggle).not.toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenLastCalledWith(false);
  }
};

export const SettingsGroup: Story = {
  render: () => (
    <Fieldset legend="Production safeguards">
      <Switch label="Require a reason to read" defaultChecked />
      <Switch label="Require approval to change" />
      <Switch
        label="Block reads from unknown networks"
        disabled
        description="Set by your organization."
      />
    </Fieldset>
  )
};

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  render: (args) => (
    <div style={{ display: "grid", gap: "var(--vx-space-3)" }}>
      <Switch {...args} />
      <Switch {...args} label="On" description={undefined} defaultChecked />
      <Switch {...args} label="Disabled" description={undefined} disabled />
    </div>
  )
};
