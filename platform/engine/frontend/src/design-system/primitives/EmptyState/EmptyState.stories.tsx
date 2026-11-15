import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { EmptyState } from "./EmptyState";

const LockIcon = () => (
  <svg viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden="true">
    <rect x="10" y="20" width="28" height="22" rx="4" stroke="currentColor" strokeWidth="2.5" />
    <path d="M16 20v-5a8 8 0 0 1 16 0v5" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="24" cy="31" r="3" fill="currentColor" />
  </svg>
);

const meta = {
  title: "Design System/Primitives/Empty State",
  component: EmptyState,
  decorators: [withSurface],
  args: {
    icon: <LockIcon />,
    title: "No secrets yet",
    description: "Add the first secret for this environment, or import them from another tool.",
    actions: (
      <>
        <Button variant="primary">Add secret</Button>
        <Button>Import from Infisical or Doppler</Button>
      </>
    )
  },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "What a list or page shows when it has nothing yet, or when a filter matches nothing. It says what belongs here and offers the next step. The title is a real heading at the level the page outline needs (`headingLevel`); the icon is decorative. **Keyboard:** it adds no Tab stops of its own; Tab reaches its actions."
      }
    }
  }
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "No secrets yet", level: 2 })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Add secret" })).toBeVisible();
  }
};

export const NoMatches: Story = {
  args: {
    icon: undefined,
    title: "Nothing matches “stripe”",
    description: "Check the spelling, or search all environments.",
    actions: <Button>Clear search</Button>
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
