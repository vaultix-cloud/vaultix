import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "./Button";

const meta = {
  title: "Design System/Primitives/Button",
  component: Button,
  args: { children: "Save changes", onClick: fn() },
  decorators: [withSurface],
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] }
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A native `<button>`. **Keyboard:** Tab focuses it; Enter and Space press it. Focus shows a token ring only for keyboard focus (`:focus-visible`). **Busy** keeps the button focusable and sets `aria-busy` and `aria-disabled`, so its state is announced and presses are ignored; **disabled** uses the native attribute and leaves the tab order."
      }
    }
  }
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete project" } };

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: "var(--vx-space-3)", alignItems: "center" }}>
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
  args: { variant: "primary" }
};

export const KeyboardPress: Story = {
  args: { variant: "primary" },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Save changes" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button.matches(":focus-visible")).toBe(true);
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await expect(args.onClick).toHaveBeenCalledTimes(2);
  }
};

export const Busy: Story = {
  args: { variant: "primary", busy: true, children: "Saving" },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Saving" });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  }
};

export const Disabled: Story = {
  args: { variant: "secondary", disabled: true },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Save changes" });
    await expect(button).toBeDisabled();
    await userEvent.tab();
    await expect(button).not.toHaveFocus();
    await expect(args.onClick).not.toHaveBeenCalled();
  }
};

export const LightTheme: Story = {
  args: { variant: "primary" },
  parameters: { vxTheme: "light" },
  render: (args) => (
    <div style={{ display: "flex", gap: "var(--vx-space-3)" }}>
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="danger">
        Danger
      </Button>
    </div>
  )
};
