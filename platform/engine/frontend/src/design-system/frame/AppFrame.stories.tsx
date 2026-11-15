import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AppFrame, TRailGroup } from "./AppFrame";

const icon = (d: string) => (
  <svg
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const groups: TRailGroup[] = [
  {
    id: "work",
    label: "Workspace",
    items: [
      {
        id: "overview",
        label: "Overview",
        icon: icon("M3 10.5 10 4l7 6.5V16a1 1 0 0 1-1 1h-3.5v-4h-5v4H4a1 1 0 0 1-1-1z"),
        href: "#overview"
      },
      {
        id: "secrets",
        label: "Secrets",
        icon: icon("M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9M5 9h10v8H5zM10 12v2"),
        href: "#secrets",
        current: true
      },
      {
        id: "access",
        label: "Access",
        icon: icon("M10 3l6 2.5v4.5c0 3.5-2.6 6.3-6 7-3.4-.7-6-3.5-6-7V5.5z"),
        href: "#access"
      },
      {
        id: "automation",
        label: "Automation",
        icon: icon(
          "M4 10a6 6 0 0 1 10.2-4.2L16 7.5M16 4v3.5h-3.5M16 10a6 6 0 0 1-10.2 4.2L4 12.5M4 16v-3.5h3.5"
        ),
        href: "#automation"
      },
      {
        id: "connect",
        label: "Connect",
        icon: icon(
          "M8 12l4-4M7 9.5 5 11.5a2.5 2.5 0 0 0 3.5 3.5l2-2M13 10.5l2-2A2.5 2.5 0 0 0 11.5 5l-2 2"
        ),
        href: "#connect"
      }
    ]
  },
  {
    id: "assist",
    label: "Assist",
    items: [
      {
        id: "ai",
        label: "Clyffy",
        icon: icon(
          "M10 3v2M4.5 7.5h11v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM8 11h.01M12 11h.01M8 14h4"
        ),
        href: "#ai"
      },
      {
        id: "governance",
        label: "Audit and governance",
        icon: icon("M5 3.5h7l3 3V16.5H5zM8 9h5M8 12h5M8 6h2"),
        href: "#governance"
      }
    ]
  }
];

const meta = {
  title: "Design System/Frame/App Frame",
  component: AppFrame,
  args: {
    groups,
    header: <strong>Payments API · Production</strong>,
    children: <p>Page content goes here.</p>,
    defaultExpanded: false
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'The Vaultix app frame. **Rail:** every item is a link inside a `nav` landmark named Main; collapsed, each shows its name as a tooltip on hover and on keyboard focus, and the current page has `aria-current="page"` and the gold indicator. **Full menu:** the menu button (`aria-expanded`, `aria-controls`) opens labelled groups; the choice is remembered per device. **Skip to content** is the first stop for keyboard users. Below 720 px the rail becomes a drawer opened by the same button.'
      }
    }
  }
} satisfies Meta<typeof AppFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Main" });
    const current = within(nav).getByRole("link", { name: "Secrets" });
    await expect(current).toHaveAttribute("aria-current", "page");
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Vaultix home" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Expand menu" })).toHaveFocus();
    await userEvent.tab();
    const overview = within(nav).getByRole("link", { name: "Overview" });
    await expect(overview).toHaveFocus();
    await waitFor(() =>
      expect(document.querySelector(".vx-tooltip")).toHaveTextContent("Overview")
    );
  }
};

export const Expanded: Story = {
  args: { defaultExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Collapse menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("heading", { name: "Workspace" })).toBeVisible();
    await expect(canvas.getByText("Vaultix")).toBeVisible();
    await expect(canvas.getByText("Audit and governance")).toBeVisible();
    await userEvent.click(toggle);
    await expect(canvas.getByRole("button", { name: "Expand menu" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  }
};

export const LightTheme: Story = {
  args: { defaultExpanded: true },
  decorators: [
    (Story) => (
      <div data-theme="light">
        <Story />
      </div>
    )
  ]
};
