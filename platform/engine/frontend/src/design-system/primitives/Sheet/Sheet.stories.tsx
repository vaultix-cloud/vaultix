import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { TextArea } from "../TextArea/TextArea";
import { TextInput } from "../TextInput/TextInput";
import { Sheet } from "./Sheet";

const SheetDemo = ({ defaultOpen = false }: { defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show details</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="DATABASE_URL"
        description="Production · payments-api"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput mono defaultValue="DATABASE_URL" />
        </Field>
        <Field label="Reference" help="Use this in code and config instead of the value.">
          <TextInput mono readOnly defaultValue="vx://payments-api/production/DATABASE_URL" />
        </Field>
        <Field label="Description">
          <TextArea defaultValue="Primary Postgres for payments. Rotated monthly." />
        </Field>
      </Sheet>
    </>
  );
};

const meta = {
  title: "Design System/Primitives/Sheet",
  component: SheetDemo,
  decorators: [withSurface],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A modal panel along the inline end of the window, for details and longer forms. It is the Dialog with a different shape and has the same behavior: **Keyboard:** focus moves into it on open and stays inside; Escape, the Close button and a press on the backdrop close it; focus returns to what opened it."
      }
    }
  }
} satisfies Meta<typeof SheetDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Show details" });
    await userEvent.click(trigger);
    const sheet = await waitFor(() =>
      within(document.body).getByRole("dialog", { name: "DATABASE_URL" })
    );
    await expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveFocus();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(sheet).not.toHaveAttribute("open"));
    await expect(trigger).toHaveFocus();
  }
};

export const Open: Story = { args: { defaultOpen: true } };
