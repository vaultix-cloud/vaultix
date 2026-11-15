import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { MenuButton, TMenuEntry } from "./MenuButton";

const glyph = (d: string) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const onRename = fn();
const onCopy = fn();
const onDuplicate = fn();
const onRotate = fn();
const onDelete = fn();

const items: TMenuEntry[] = [
  {
    id: "rename",
    label: "Rename",
    icon: glyph("M3 13h3l7-7-3-3-7 7z"),
    shortcut: { label: "F2", keys: "F2" },
    onSelect: onRename
  },
  {
    id: "copy",
    label: "Copy reference",
    icon: glyph("M5 5h8v8H5zM3 11V3h8"),
    shortcut: { label: "Ctrl Shift C", keys: "Control+Shift+C" },
    onSelect: onCopy
  },
  {
    id: "duplicate",
    label: "Duplicate",
    icon: glyph("M4 4h6v6H4zM7 7h6v6H7z"),
    onSelect: onDuplicate
  },
  { kind: "separator", id: "sep-1" },
  {
    kind: "group",
    id: "lifecycle",
    label: "Lifecycle",
    items: [
      {
        id: "rotate",
        label: "Rotate now",
        icon: glyph("M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3M12 2v3H9M4 14v-3h3"),
        onSelect: onRotate
      },
      {
        id: "archive",
        label: "Archive",
        disabled: true,
        icon: glyph("M2 4h12v3H2zM3 7v6h10V7M6 10h4"),
        onSelect: fn()
      }
    ]
  },
  { kind: "separator", id: "sep-2" },
  {
    id: "delete",
    label: "Delete secret",
    danger: true,
    icon: glyph("M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10"),
    onSelect: onDelete
  }
];

const meta = {
  title: "Design System/Primitives/Menu Button",
  component: MenuButton,
  decorators: [withSurface],
  args: { trigger: <Button>Secret actions</Button>, items },
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          'The WAI-ARIA menu button. The button has `aria-haspopup="menu"` and `aria-expanded`, and names the menu. Items come from data (`items`), so a catalog can supply them. **Keyboard on the button:** Enter, Space or Down Arrow opens the menu on the first item; Up Arrow opens it on the last. **In the menu:** Down and Up Arrow move and wrap; Home and End go to the first and last; typing letters jumps to the next item that starts with them; Enter or Space chooses the item, closes the menu and returns focus to the button; Escape closes and returns focus; Tab closes and moves on. Disabled items stay reachable so people learn they exist, and do nothing. A press outside closes the menu. Shortcuts are shown and exposed with `aria-keyshortcuts`; keyboard focus gets a ring as well as the fill.'
      }
    }
  }
} satisfies Meta<typeof MenuButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const menu = () =>
  waitFor(() => within(document.body).getByRole("menu", { name: "Secret actions" }));

export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Secret actions" });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const list = await menu();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const item = (name: string) => within(list).getByRole("menuitem", { name });
    await waitFor(() => expect(item("Rename")).toHaveFocus());
    await expect(item("Rename")).toHaveAttribute("aria-keyshortcuts", "F2");
    await userEvent.keyboard("{ArrowDown}");
    await expect(item("Copy reference")).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(item("Delete secret")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(item("Rename")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect(item("Delete secret")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("r");
    await expect(item("Rotate now")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(list).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
};

export const ChooseAnItem: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Secret actions" });
    trigger.focus();
    await userEvent.keyboard("{ArrowUp}");
    const list = await menu();
    await waitFor(() =>
      expect(within(list).getByRole("menuitem", { name: "Delete secret" })).toHaveFocus()
    );
    await userEvent.keyboard("{ArrowUp}");
    const archive = within(list).getByRole("menuitem", { name: "Archive" });
    await expect(archive).toHaveFocus();
    await expect(archive).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Enter}");
    await expect(list).toBeInTheDocument();
    await userEvent.keyboard("{ArrowUp}{Enter}");
    await expect(onRotate).toHaveBeenCalledOnce();
    await waitFor(() => expect(list).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  }
};

export const PointerAndOutsidePress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Secret actions" }));
    let list = await menu();
    await userEvent.click(within(list).getByRole("menuitem", { name: "Copy reference" }));
    await expect(onCopy).toHaveBeenCalled();
    await waitFor(() => expect(list).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Secret actions" }));
    list = await menu();
    await userEvent.click(canvasElement);
    await waitFor(() => expect(list).not.toBeInTheDocument());
  }
};

export const IconTrigger: Story = {
  args: {
    trigger: <IconButton label="Secret actions" icon={glyph("M8 3.5h.01M8 8h.01M8 12.5h.01")} />,
    align: "end"
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Secret actions" }));
    await menu();
  }
};

export const LightTheme: Story = {
  parameters: { vxTheme: "light" },
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole("button", { name: "Secret actions" }).focus();
    await userEvent.keyboard("{Enter}");
    await menu();
  }
};
