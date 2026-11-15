import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Link } from "./Link";

const meta = {
  title: "Design System/Primitives/Link",
  component: Link,
  decorators: [withSurface],
  args: { href: "#audit", children: "audit log" },
  render: (args) => (
    <p style={{ margin: 0, maxWidth: "56ch" }}>
      Every read of a production secret is recorded in the <Link {...args} />, with who read it and
      why.
    </p>
  ),
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'A native `<a>` for navigation; use Button for actions. Links stay **underlined**, so they are never told apart by colour alone (WCAG 1.4.1); hover thickens the line. **External** links open in a new tab with an icon and a spoken "(opens in a new tab)", and never share the opener or referrer. **Subtle** takes the surrounding text colour. A router\'s own link can look the same with `linkClassName()`. **Keyboard:** Tab focuses it and Enter follows it.'
      }
    }
  }
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "audit log" });
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await expect(getComputedStyle(link).textDecorationLine).toContain("underline");
  }
};

export const External: Story = {
  args: {
    href: "https://www.w3.org/WAI/ARIA/apg/",
    external: true,
    children: "WAI-ARIA Authoring Practices"
  },
  render: (args) => <Link {...args} />,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: "WAI-ARIA Authoring Practices (opens in a new tab)"
    });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
};

export const Subtle: Story = { args: { variant: "subtle" } };

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
