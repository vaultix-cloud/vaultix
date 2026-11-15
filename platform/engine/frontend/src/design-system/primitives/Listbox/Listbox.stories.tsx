import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Listbox, TListboxOption } from "./Listbox";

const environments: TListboxOption[] = [
  { value: "dev", label: "Development", description: "Shared by the whole team" },
  { value: "staging", label: "Staging", description: "Mirrors production" },
  { value: "qa", label: "QA", disabled: true, description: "Paused" },
  { value: "prod", label: "Production", description: "Changes need approval" },
  { value: "preview", label: "Preview", description: "One per pull request" }
];

const meta = {
  title: "Design System/Primitives/Listbox",
  component: Listbox,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "320px" }}>
        <Story />
      </div>
    )
  ],
  args: { options: environments, label: "Environment", onValueChange: fn() },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "The WAI-ARIA listbox for choosing from a visible list. The list is one Tab stop; the active option is conveyed with `aria-activedescendant` and shows a ring while the list has keyboard focus. **Keyboard:** Up and Down Arrow move, skipping disabled options; Home and End go to the ends; typing letters jumps to an option. **Single:** selection follows focus. **Multiple** (`aria-multiselectable`): Space toggles the active option, Shift with an arrow extends the choice, Ctrl+A (Cmd+A) chooses all or none. Pressing an option chooses it. Use Select or Combobox when the list should stay closed until needed."
      }
    }
  }
} satisfies Meta<typeof Listbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { defaultValue: ["staging"] },
  play: async ({ canvasElement, args }) => {
    const list = within(canvasElement).getByRole("listbox", { name: "Environment" });
    const option = (name: RegExp) => within(list).getByRole("option", { name });
    await expect(option(/Staging/)).toHaveAttribute("aria-selected", "true");
    await userEvent.tab();
    await expect(list).toHaveFocus();
    await expect(list).toHaveAttribute("aria-activedescendant", option(/Staging/).id);
    await userEvent.keyboard("{ArrowDown}");
    // QA is disabled and skipped.
    await expect(list).toHaveAttribute("aria-activedescendant", option(/Production/).id);
    await expect(option(/Production/)).toHaveAttribute("aria-selected", "true");
    await expect(args.onValueChange).toHaveBeenLastCalledWith(["prod"]);
    await userEvent.keyboard("d");
    await expect(option(/Development/)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    await expect(option(/Preview/)).toHaveAttribute("aria-selected", "true");
  }
};

export const Multiple: Story = {
  args: { multiple: true, defaultValue: ["dev"] },
  play: async ({ canvasElement, args }) => {
    const list = within(canvasElement).getByRole("listbox", { name: "Environment" });
    const option = (name: RegExp) => within(list).getByRole("option", { name });
    await expect(list).toHaveAttribute("aria-multiselectable", "true");
    list.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(option(/Staging/)).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard(" ");
    await expect(option(/Staging/)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expect(option(/Production/)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Control>}a{/Control}");
    await expect(args.onValueChange).toHaveBeenLastCalledWith([
      "dev",
      "staging",
      "prod",
      "preview"
    ]);
    await userEvent.keyboard("{Control>}a{/Control}");
    await expect(args.onValueChange).toHaveBeenLastCalledWith([]);
    await userEvent.click(option(/Preview/));
    await expect(option(/Preview/)).toHaveAttribute("aria-selected", "true");
  }
};

export const LightTheme: Story = {
  args: { multiple: true, defaultValue: ["dev", "prod"] },
  parameters: { vxTheme: "light" }
};
