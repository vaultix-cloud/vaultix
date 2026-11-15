import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { Tooltip } from "./Tooltip";

const KeyIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <circle cx="5" cy="8" r="3" />
    <path d="M8 8h7M12 8v3M14.5 8v2" />
  </svg>
);

const meta = {
  title: "Design System/Primitives/Tooltip",
  component: Tooltip,
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'Meets WCAG 2.2 SC 1.4.13. Opens after `--vx-duration-tooltip-delay` on mouse hover and **immediately on keyboard focus**; stays open while the pointer moves onto it; **Escape** closes it without moving focus or pointer; never opens on touch. `kind="label"` names an icon-only control (the tooltip is hidden from assistive tech, so it is not read twice). `kind="description"` links extra text with `aria-describedby`. Rendered in the top layer with the native Popover API.'
      }
    }
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "var(--vx-space-12)" }}>
        <Story />
      </div>
    ),
    withSurface
  ]
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Description: Story = {
  args: {
    content: "Copies the reference, never the value.",
    children: <Button>Copy reference</Button>
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Copy reference" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    const tip = await within(document.body).findByRole("tooltip");
    await expect(tip).toHaveTextContent("Copies the reference, never the value.");
    await expect(button).toHaveAttribute("aria-describedby", tip.id);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("tooltip")).toBeNull());
    await expect(button).toHaveFocus();
  }
};

export const IconLabel: Story = {
  args: { content: "", children: <span /> },
  render: () => <IconButton icon={<KeyIcon />} label="Secrets" tooltipSide="right" />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Secrets" });
    await userEvent.hover(button);
    await waitFor(
      () => expect(document.querySelector(".vx-tooltip")).toHaveTextContent("Secrets"),
      { timeout: 2000 }
    );
    await expect(document.querySelector(".vx-tooltip")).toHaveAttribute("aria-hidden", "true");
    await userEvent.unhover(button);
    await waitFor(() => expect(document.querySelector(".vx-tooltip")).toBeNull());
  }
};

export const AllSides: Story = {
  args: { content: "", children: <span /> },
  render: () => (
    <div style={{ display: "flex", gap: "var(--vx-space-6)" }}>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <IconButton
          key={side}
          icon={<KeyIcon />}
          label={`Tooltip on the ${side}`}
          tooltipSide={side}
          variant="secondary"
        />
      ))}
    </div>
  )
};
