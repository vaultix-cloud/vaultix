import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { withSurface } from "../storybook/Surface";
import { Icon } from "./Icon";
import { iconNames } from "./paths";

const Gallery = ({ size = 20 }: { size?: number }) => (
  <ul
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
      gap: "var(--vx-space-2)",
      margin: 0,
      padding: 0,
      listStyle: "none"
    }}
  >
    {iconNames.map((name) => (
      <li
        key={name}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--vx-space-2)",
          padding: "var(--vx-space-3)",
          borderRadius: "var(--vx-radius-md)",
          background: "var(--vx-color-surface-base)",
          fontSize: "var(--vx-font-size-xs)",
          color: "var(--vx-color-text-secondary)"
        }}
      >
        <span style={{ color: "var(--vx-color-text-primary)" }}>
          <Icon name={name} size={size} />
        </span>
        <code>{name}</code>
      </li>
    ))}
  </ul>
);

const meta = {
  title: "Design System/Icons",
  component: Gallery,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'Vaultix\'s own line icons on a 16-unit grid with a 1.5 stroke, drawn in `currentColor`. Use `<Icon name="lock" />`. Icons are **decorative by default** (`aria-hidden`): put them beside text or inside a control that has a name, such as IconButton, which requires a label. Give `label` only when the icon alone carries meaning; it then has `role="img"` and that name. Sizes: 16 in dense UI and inline text, 20 in navigation and empty states.'
      }
    }
  }
} satisfies Meta<typeof Gallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {
  play: async ({ canvasElement }) => {
    const items = within(canvasElement).getAllByRole("listitem");
    await expect(items).toHaveLength(iconNames.length);
    // Decorative icons are hidden from assistive technology.
    await expect(canvasElement.querySelectorAll('svg.vx-icon[aria-hidden="true"]')).toHaveLength(
      iconNames.length
    );
  }
};

export const Small: Story = { args: { size: 16 } };

export const Labelled: Story = {
  render: () => (
    <p style={{ display: "flex", alignItems: "center", gap: "var(--vx-space-2)", margin: 0 }}>
      <span style={{ color: "var(--vx-color-status-success)" }}>
        <Icon name="success" label="Healthy" />
      </span>
      payments-api
    </p>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("img", { name: "Healthy" })).toBeVisible();
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
