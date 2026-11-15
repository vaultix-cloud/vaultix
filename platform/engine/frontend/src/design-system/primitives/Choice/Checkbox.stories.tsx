import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Fieldset } from "../Fieldset/Fieldset";
import { Checkbox } from "./Checkbox";

const environments = ["Development", "Staging", "Production"];

const SelectAll = () => {
  const [chosen, setChosen] = useState<string[]>(["Development"]);
  const all = chosen.length === environments.length;
  const some = chosen.length > 0 && !all;
  return (
    <Fieldset
      legend="Copy to environments"
      help="The secret is created in each environment you choose."
    >
      <Checkbox
        label="All environments"
        checked={all}
        indeterminate={some}
        onChange={() => setChosen(all ? [] : environments)}
      />
      {environments.map((name) => (
        <Checkbox
          key={name}
          label={name}
          checked={chosen.includes(name)}
          onChange={(event) =>
            setChosen((current) =>
              event.target.checked ? [...current, name] : current.filter((item) => item !== name)
            )
          }
        />
      ))}
    </Fieldset>
  );
};

const meta = {
  title: "Design System/Primitives/Checkbox",
  component: Checkbox,
  decorators: [withSurface],
  args: { label: "Mask values in the audit log", onChange: fn() },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native checkbox drawn with tokens; the whole label row is the press target (at least 24 px tall). **Keyboard:** Tab focuses it and Space toggles it. A **description** is linked with `aria-describedby`. **Indeterminate** (mixed) is for a checkbox that stands for several others, some chosen; pressing it chooses all or none. Group related checkboxes in a **Fieldset**, whose legend names the group and whose hint and error describe it. The checked box meets 3:1 against its surface in both themes, and Windows high contrast keeps the state visible."
      }
    }
  }
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { description: "People with read access see ••••• instead of the value." },
  play: async ({ canvasElement, args }) => {
    const box = within(canvasElement).getByRole("checkbox", {
      name: "Mask values in the audit log"
    });
    await expect(box).toHaveAccessibleDescription(
      "People with read access see ••••• instead of the value."
    );
    await userEvent.tab();
    await expect(box).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(box).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledOnce();
    await userEvent.click(within(canvasElement).getByText("Mask values in the audit log"));
    await expect(box).not.toBeChecked();
  }
};

export const Indeterminate: Story = {
  render: () => <SelectAll />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole("group", { name: "Copy to environments" });
    await expect(group).toHaveAccessibleDescription(
      "The secret is created in each environment you choose."
    );
    const all = canvas.getByRole("checkbox", { name: "All environments" });
    await expect(all).toBePartiallyChecked();
    await userEvent.click(all);
    await expect(all).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Production" })).toBeChecked();
    await userEvent.click(all);
    await expect(all).not.toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Development" })).not.toBeChecked();
  }
};

export const GroupWithError: Story = {
  render: () => (
    <Fieldset legend="Notify me about" error="Choose at least one.">
      <Checkbox label="Secret changes" invalid />
      <Checkbox label="Access requests" invalid />
      <Checkbox label="Rotation failures" invalid disabled />
    </Fieldset>
  ),
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("group", { name: "Notify me about" });
    await expect(group).toHaveAccessibleDescription("Error: Choose at least one.");
    await expect(within(group).getByRole("checkbox", { name: "Secret changes" })).toBeInvalid();
    await expect(within(group).getByRole("checkbox", { name: "Rotation failures" })).toBeDisabled();
  }
};

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  render: () => (
    <div style={{ display: "grid", gap: "var(--vx-space-3)" }}>
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Mixed" indeterminate />
      <Checkbox label="Disabled" disabled defaultChecked />
    </div>
  )
};
