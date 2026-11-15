import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { Loading, Skeleton } from "./Skeleton";

const Card = () => (
  <div style={{ display: "flex", gap: "var(--vx-space-3)", alignItems: "center" }}>
    <Skeleton shape="circle" />
    <div style={{ flex: 1 }}>
      <Skeleton shape="text" width="40%" />
      <Skeleton shape="text" width="70%" />
    </div>
  </div>
);

const Demo = () => {
  const [loading, setLoading] = useState(true);
  return (
    <div style={{ display: "grid", gap: "var(--vx-space-4)", maxWidth: "420px" }}>
      <Button onClick={() => setLoading((value) => !value)}>
        {loading ? "Finish loading" : "Load again"}
      </Button>
      <Loading label="Loading team members" loading={loading} placeholder={<Card />}>
        <p style={{ margin: 0 }}>Ada Lovelace · Owner</p>
      </Loading>
    </div>
  );
};

const meta = {
  title: "Design System/Primitives/Skeleton",
  component: Demo,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "Placeholder shapes laid out like the content that is loading. The shapes are hidden from assistive technology; wrap the area in **Loading**, which sets `aria-busy` and says once, politely, what is loading. With reduced motion the shimmer stops and the shapes stay still. **Keyboard:** nothing to reach; placeholders take no focus."
      }
    }
  }
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading team members");
    await userEvent.click(canvas.getByRole("button", { name: "Finish loading" }));
    await waitFor(() => expect(canvas.getByText("Ada Lovelace · Owner")).toBeVisible());
    await expect(canvas.getByRole("status")).toBeEmptyDOMElement();
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
