import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { DataGrid, TGridColumn, TGridSort } from "./DataGrid";

type TSecret = { name: string; environment: string; rotated: string };

const secrets: TSecret[] = [
  { name: "DATABASE_URL", environment: "Production", rotated: "2026-11-14" },
  { name: "STRIPE_KEY", environment: "Production", rotated: "2026-11-02" },
  { name: "SENTRY_DSN", environment: "Staging", rotated: "2026-10-28" },
  { name: "REDIS_URL", environment: "Development", rotated: "2026-11-11" }
];

const onRotate = fn();
const onCopy = fn();
const onHistory = fn();

const columns: TGridColumn<TSecret>[] = [
  { id: "name", header: "Name", sortable: true, rowHeader: true, cell: (row) => row.name },
  { id: "environment", header: "Environment", sortable: true, cell: (row) => row.environment },
  { id: "rotated", header: "Last rotated", cell: (row) => row.rotated },
  {
    id: "rotate",
    header: "Rotate",
    cell: (row) => (
      <Button size="sm" onClick={() => onRotate(row.name)}>
        Rotate {row.name}
      </Button>
    )
  },
  {
    id: "more",
    header: "Reference",
    cell: (row) => (
      <span style={{ display: "inline-flex", gap: "var(--vx-space-1)" }}>
        <Button size="sm" variant="ghost" onClick={() => onCopy(row.name)}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onHistory(row.name)}>
          History
        </Button>
      </span>
    )
  }
];

const Demo = () => {
  const [sort, setSort] = useState<TGridSort>(null);
  const rows = useMemo(() => {
    if (!sort) return secrets;
    const key = sort.column as keyof TSecret;
    const order = [...secrets].sort((a, b) => a[key].localeCompare(b[key]));
    return sort.direction === "ascending" ? order : order.reverse();
  }, [sort]);
  return (
    <DataGrid
      label="Secrets in payments-api"
      columns={columns}
      rows={rows}
      rowId={(row) => row.name}
      sort={sort}
      onSortChange={setSort}
    />
  );
};

const meta = {
  title: "Design System/Primitives/Data Grid",
  component: Demo,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "The WAI-ARIA data grid, for dense keyboard work across many rows. Use Table when rows are only read. The grid is **one Tab stop**. **Keyboard:** arrow keys move between cells, the header row included; Home and End go to the start and end of the row; Ctrl+Home and Ctrl+End to the first and last cell; Page Up and Page Down move by pages. A cell holding **one control** (a sort button, a Rotate button) gives focus straight to it, and Enter or Space presses it. A cell holding **several** takes focus itself: Enter or F2 moves into it, Tab and the arrows then work inside, and Escape returns to the cell. Sorting announces the new order."
      }
    }
  }
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvas.getByRole("grid", { name: "Secrets in payments-api" });
    await userEvent.tab();
    const nameSort = within(grid).getByRole("button", { name: "Name" });
    await expect(nameSort).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(within(grid).getByRole("rowheader", { name: "DATABASE_URL" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    const rotate = within(grid).getByRole("button", { name: "Rotate DATABASE_URL" });
    await expect(rotate).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(onRotate).toHaveBeenCalledWith("DATABASE_URL");
    await userEvent.keyboard("{ArrowRight}");
    const refCell = rotate.closest("td")?.nextElementSibling as HTMLElement;
    await expect(refCell).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(within(refCell).getByRole("button", { name: "Copy" })).toHaveFocus();
    await userEvent.tab();
    await expect(within(refCell).getByRole("button", { name: "History" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(refCell).toHaveFocus();
    await userEvent.keyboard("{Control>}{Home}{/Control}");
    await expect(nameSort).toHaveFocus();
    await userEvent.keyboard("{Control>}{End}{/Control}");
    await expect(within(grid).getAllByRole("gridcell").at(-1)).toHaveFocus();
    // Tab leaves the grid in one step.
    await userEvent.tab();
    await expect(grid.contains(document.activeElement)).toBe(false);
  }
};

export const Sorting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvas.getByRole("grid");
    await userEvent.click(within(grid).getByRole("button", { name: "Environment" }));
    await expect(within(grid).getByRole("columnheader", { name: "Environment" })).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
    await expect(within(grid).getAllByRole("rowheader")[0]).toHaveTextContent("REDIS_URL");
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent("Sorted by Environment, ascending")
    );
  }
};

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
