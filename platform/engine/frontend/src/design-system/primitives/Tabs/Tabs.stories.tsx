import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Tabs, TTab } from "./Tabs";

const panel = (text: string) => (
  <div style={{ display: "grid", gap: "var(--vx-space-3)", maxWidth: "520px" }}>
    <p style={{ margin: 0 }}>{text}</p>
    <div>
      <Button size="sm">Open</Button>
    </div>
  </div>
);

const tabs: TTab[] = [
  {
    id: "secrets",
    label: "Secrets",
    count: 42,
    content: panel("Every secret in this environment.")
  },
  {
    id: "access",
    label: "Access",
    content: panel("People and machines that can read or change secrets.")
  },
  {
    id: "audit",
    label: "Audit log",
    content: <p style={{ margin: 0 }}>Every read and change, newest first.</p>
  },
  { id: "rotation", label: "Rotation", disabled: true, content: null },
  { id: "settings", label: "Settings", content: panel("Name, environments and deletion.") }
];

const meta = {
  title: "Design System/Primitives/Tabs",
  component: Tabs,
  decorators: [withSurface],
  args: { tabs, label: "Project sections", onValueChange: fn() },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
    activation: { control: "inline-radio", options: ["automatic", "manual"] }
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "The WAI-ARIA tabs pattern. The tab list is named by `label`; each tab controls its panel and each panel is labelled by its tab. **Keyboard:** Tab reaches the selected tab only, and Tab again moves into the panel. Left and Right Arrow (Up and Down when vertical) move between tabs and wrap; Home and End go to the first and last. Disabled tabs are skipped. With **automatic** activation a panel shows as soon as its tab has focus; with **manual**, Enter or Space shows it. The selected tab is marked by a bar, colour and weight together, never colour alone."
      }
    }
  }
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Automatic: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("tablist", { name: "Project sections" });
    const tab = (name: RegExp | string) => within(list).getByRole("tab", { name });
    await expect(tab(/Secrets/)).toHaveAccessibleName("Secrets 42");
    await userEvent.tab();
    await expect(tab(/Secrets/)).toHaveFocus();
    await expect(canvas.getByRole("tabpanel", { name: "Secrets 42" })).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect(tab("Access")).toHaveFocus();
    await expect(tab("Access")).toHaveAttribute("aria-selected", "true");
    await expect(args.onValueChange).toHaveBeenLastCalledWith("access");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(tab("Settings")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(tab(/Secrets/)).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(tab("Settings")).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("tabpanel", { name: "Settings" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Open" })).toHaveFocus();
  }
};

export const PanelWithoutControls: Story = {
  args: { defaultValue: "audit" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("tab", { name: "Audit log" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("tabpanel", { name: "Audit log" })).toHaveFocus();
  }
};

export const Manual: Story = {
  args: { activation: "manual" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    const access = canvas.getByRole("tab", { name: "Access" });
    await expect(access).toHaveFocus();
    await expect(access).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("{Enter}");
    await expect(access).toHaveAttribute("aria-selected", "true");
  }
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("tab", { name: "Access" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    await expect(canvas.getByRole("tab", { name: "Settings" })).toHaveFocus();
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
