import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withSurface } from "../../storybook/Surface";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Table, TColumn, TSort, TTableProps } from "./Table";

type TSecret = { name: string; environment: string; updated: string; readers: number };

const secrets: TSecret[] = [
  { name: "DATABASE_URL", environment: "Production", updated: "2026-11-14", readers: 4 },
  { name: "STRIPE_KEY", environment: "Production", updated: "2026-11-02", readers: 2 },
  { name: "SENTRY_DSN", environment: "Staging", updated: "2026-10-28", readers: 7 },
  { name: "REDIS_URL", environment: "Development", updated: "2026-11-11", readers: 9 }
];

const columns: TColumn<TSecret>[] = [
  {
    id: "name",
    header: "Name",
    sortable: true,
    rowHeader: true,
    cell: (row) => <code style={{ fontFamily: "var(--vx-font-family-mono)" }}>{row.name}</code>
  },
  { id: "environment", header: "Environment", sortable: true, cell: (row) => row.environment },
  { id: "updated", header: "Updated", sortable: true, cell: (row) => row.updated },
  { id: "readers", header: "Readers", align: "end", cell: (row) => row.readers }
];

type TDemoProps = Partial<TTableProps<TSecret>> & { selectable?: boolean };

const Demo = ({ selectable = false, rows = secrets, ...props }: TDemoProps) => {
  const [sort, setSort] = useState<TSort>({ column: "name", direction: "ascending" });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const key = sort.column as keyof TSecret;
    const order = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    return sort.direction === "ascending" ? order : order.reverse();
  }, [rows, sort]);
  return (
    <Table
      caption="Secrets in payments-api"
      columns={columns}
      rows={sorted}
      rowId={(row) => row.name}
      rowLabel={(row) => row.name}
      sort={sort}
      onSortChange={setSort}
      selection={selectable ? selection : undefined}
      onSelectionChange={selectable ? setSelection : undefined}
      {...props}
    />
  );
};

const meta = {
  title: "Design System/Primitives/Table",
  component: Demo,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "A semantic data table, not an ARIA grid, so screen readers' table navigation works and Tab moves only between controls. The **caption** names it. A column can supply **row headers** (`th scope=\"row\"`) so each cell is read with its row's name. **Sortable** columns put a button in the header; the sorted column has `aria-sort`, and a polite status announces the new order. Sorting is the caller's (server or client). With **selection**, each row has a named checkbox and the header a select-all that shows the mixed state. **Loading** marks the table busy and shows skeleton rows; **empty** shows an EmptyState in place of rows. When the table is wider than its box, the box becomes a named, focusable region so keyboard users can scroll it. The header stays in view while the page scrolls."
      }
    }
  }
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sortable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("table", { name: "Secrets in payments-api" });
    const nameHeader = within(table).getByRole("columnheader", { name: "Name" });
    await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(within(table).getAllByRole("rowheader")[0]).toHaveTextContent("DATABASE_URL");
    await userEvent.click(within(nameHeader).getByRole("button", { name: "Name" }));
    await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    await expect(within(table).getAllByRole("rowheader")[0]).toHaveTextContent("STRIPE_KEY");
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent("Sorted by Name, descending")
    );
    const envButton = within(table).getByRole("button", { name: "Environment" });
    envButton.focus();
    await userEvent.keyboard("{Enter}");
    await expect(within(table).getByRole("columnheader", { name: "Environment" })).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
    await expect(nameHeader).not.toHaveAttribute("aria-sort");
  }
};

export const Selectable: Story = {
  args: { selectable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const all = canvas.getByRole("checkbox", { name: "Select all rows" });
    await userEvent.click(canvas.getByRole("checkbox", { name: "Select STRIPE_KEY" }));
    await expect(all).toBePartiallyChecked();
    await userEvent.click(all);
    await expect(all).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Select REDIS_URL" })).toBeChecked();
    await userEvent.click(all);
    await expect(canvas.getByRole("checkbox", { name: "Select REDIS_URL" })).not.toBeChecked();
  }
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table", { name: "Secrets in payments-api" });
    await expect(table).toHaveAttribute("aria-busy", "true");
    await expect(within(table).queryAllByRole("rowheader")).toHaveLength(0);
  }
};

export const Empty: Story = {
  args: {
    rows: [],
    empty: (
      <EmptyState
        headingLevel={3}
        title="No secrets yet"
        description="Add the first secret for this environment, or import them from another tool."
        actions={
          <>
            <Button variant="primary">Add secret</Button>
            <Button>Import</Button>
          </>
        }
      />
    )
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { name: "No secrets yet", level: 3 })
    ).toBeVisible();
  }
};

export const NarrowScrolls: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "360px" }}>
        <Story />
      </div>
    )
  ],
  play: async ({ canvasElement }) => {
    const region = await waitFor(() =>
      within(canvasElement).getByRole("region", { name: "Secrets in payments-api" })
    );
    await expect(region).toHaveAttribute("tabindex", "0");
  }
};

export const Compact: Story = { args: { density: "compact", selectable: true } };

export const LightTheme: Story = { args: { selectable: true }, parameters: { vxTheme: "light" } };
