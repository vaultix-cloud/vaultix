import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Field } from "../Field/Field";
import { Combobox, TComboboxOption } from "./Combobox";

const projects: TComboboxOption[] = [
  { value: "payments-api", label: "payments-api", description: "Payments team" },
  { value: "billing-worker", label: "billing-worker", description: "Payments team" },
  { value: "web-frontend", label: "web-frontend", description: "Web team" },
  { value: "data-pipeline", label: "data-pipeline", description: "Data team", disabled: true },
  { value: "auth-service", label: "auth-service", description: "Platform team" },
  { value: "search-indexer", label: "search-indexer", description: "Data team" }
];

const meta = {
  title: "Design System/Primitives/Combobox",
  component: Combobox,
  decorators: [
    withSurface,
    (Story) => (
      <div style={{ maxWidth: "360px", minHeight: "340px" }}>
        <Story />
      </div>
    )
  ],
  args: { options: projects, placeholder: "Search projects", onValueChange: fn() },
  render: (args) => (
    <Field label="Project" help="Type to filter by name or team.">
      <Combobox {...args} />
    </Field>
  ),
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "The WAI-ARIA editable combobox with list autocomplete, for choosing from a long list. Focus stays in the text box; the active option is conveyed with `aria-activedescendant`, and a polite status says how many options match. The value must be one of the options: leaving the box puts back the chosen option's label. **Keyboard:** typing filters by label and description and opens the list; Down and Up Arrow open the list and move through options, skipping disabled ones; Alt+Down opens without moving and Alt+Up closes; Enter chooses the active option; Escape closes the list, or clears the box when the list is closed. A press on an option chooses it. Use Select for short lists."
      }
    }
  }
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Project" });
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveAccessibleDescription("Type to filter by name or team.");
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    const list = canvas.getByRole("listbox", { name: "Project" });
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const first = within(list).getByRole("option", { name: /payments-api/ });
    await expect(input).toHaveAttribute("aria-activedescendant", first.id);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    // data-pipeline is disabled and skipped.
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      within(list).getByRole("option", { name: /auth-service/ }).id
    );
    await userEvent.keyboard("{Enter}");
    await expect(input).toHaveValue("auth-service");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(args.onValueChange).toHaveBeenLastCalledWith("auth-service");
  }
};

export const Filter: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Project" });
    await userEvent.click(input);
    await userEvent.type(input, "data team");
    const list = canvas.getByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    await expect(canvas.getByRole("status")).toHaveTextContent("2 matches");
    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    await waitFor(() => expect(canvas.getByText("No matches")).toBeVisible());
    await expect(canvas.getByRole("status")).toHaveTextContent("0 matches");
    await userEvent.keyboard("{Escape}");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await userEvent.clear(input);
    await userEvent.type(input, "web");
    await userEvent.click(within(list).getByRole("option", { name: /web-frontend/ }));
    await expect(input).toHaveValue("web-frontend");
    await expect(args.onValueChange).toHaveBeenLastCalledWith("web-frontend");
  }
};

export const RevertsOnLeave: Story = {
  args: { defaultValue: "payments-api" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Project" });
    await expect(input).toHaveValue("payments-api");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "bill");
    await userEvent.tab();
    await waitFor(() => expect(input).toHaveValue("payments-api"));
  }
};

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Project" }));
  }
};
