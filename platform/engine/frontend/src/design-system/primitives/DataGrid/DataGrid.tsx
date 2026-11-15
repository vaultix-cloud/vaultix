import { KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "../../icons/Icon";

import "../Table/Table.css";
import "./DataGrid.css";

export type TGridColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  width?: string;
  rowHeader?: boolean;
};

export type TGridSort = { column: string; direction: "ascending" | "descending" } | null;

export type TDataGridProps<T> = {
  // Names the grid, e.g. "Secrets in Production".
  label: string;
  columns: TGridColumn<T>[];
  rows: T[];
  rowId: (row: T) => string;
  sort?: TGridSort;
  onSortChange?: (sort: TGridSort) => void;
  // Rows moved by Page Up and Page Down.
  pageSize?: number;
  className?: string;
};

const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([data-grid-cell])";

type TPosition = { row: number; col: number };

const SORT_ICON = { ascending: "chevron-up", descending: "chevron-down", none: "sort" } as const;

// The WAI-ARIA data grid: a table that is one Tab stop, with arrow-key movement between cells
// (the header row included). A cell holding one control gives focus straight to that control;
// a cell holding several takes focus itself, and Enter or F2 moves into it, Escape back out.
export const DataGrid = <T,>({
  label,
  columns,
  rows,
  rowId,
  sort = null,
  onSortChange,
  pageSize = 10,
  className
}: TDataGridProps<T>) => {
  const tableRef = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<TPosition>({ row: 0, col: 0 });
  const [announcement, setAnnouncement] = useState("");
  const focusOnUpdate = useRef(false);
  const lastRow = rows.length; // row 0 is the header row
  const lastCol = columns.length - 1;

  const cellAt = ({ row, col }: TPosition) =>
    tableRef.current?.querySelector<HTMLElement>(`[data-grid-cell="${row}:${col}"]`) ?? null;
  const targetIn = (cell: HTMLElement) => {
    const controls = cell.querySelectorAll<HTMLElement>(FOCUSABLE);
    return controls.length === 1 ? controls[0] : cell;
  };

  // Only the active cell (or its single control) is in the Tab order.
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    table
      .querySelectorAll<HTMLElement>(`[data-grid-cell], [data-grid-cell] :is(${FOCUSABLE})`)
      .forEach((node) => node.setAttribute("tabindex", "-1"));
    const cell = cellAt(active);
    if (!cell) return;
    const target = targetIn(cell);
    target.tabIndex = 0;
    if (focusOnUpdate.current) {
      focusOnUpdate.current = false;
      target.focus();
    }
  });

  // Keep the active cell inside the grid when rows or columns change.
  useEffect(() => {
    setActive((current) => ({
      row: Math.min(current.row, lastRow),
      col: Math.min(current.col, Math.max(0, lastCol))
    }));
  }, [lastRow, lastCol]);

  const moveTo = (row: number, col: number) => {
    focusOnUpdate.current = true;
    setActive({
      row: Math.max(0, Math.min(lastRow, row)),
      col: Math.max(0, Math.min(lastCol, col))
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-grid-cell]");
    if (!cell) return;
    const insideControl = target !== cell && target !== targetIn(cell);
    // Inside a cell's controls, keys belong to the control until Escape.
    if (insideControl) {
      if (event.key === "Escape") {
        event.preventDefault();
        cell.focus();
      }
      return;
    }
    const { row, col } = active;
    const ctrl = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case "ArrowRight":
        moveTo(row, col + 1);
        break;
      case "ArrowLeft":
        moveTo(row, col - 1);
        break;
      case "ArrowDown":
        moveTo(row + 1, col);
        break;
      case "ArrowUp":
        moveTo(row - 1, col);
        break;
      case "Home":
        moveTo(ctrl ? 0 : row, 0);
        break;
      case "End":
        moveTo(ctrl ? lastRow : row, lastCol);
        break;
      case "PageDown":
        moveTo(row + pageSize, col);
        break;
      case "PageUp":
        moveTo(row - pageSize, col);
        break;
      case "Enter":
      case "F2": {
        if (target !== cell) return;
        const controls = [...cell.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!controls.length) return;
        // Inside the cell, Tab moves between its controls; leaving the cell restores one Tab stop.
        controls.forEach((control) => control.setAttribute("tabindex", "0"));
        controls[0].focus();
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const toggleSort = (column: TGridColumn<T>) => {
    const direction =
      sort?.column === column.id && sort.direction === "ascending" ? "descending" : "ascending";
    onSortChange?.({ column: column.id, direction });
    setAnnouncement(`Sorted by ${column.header}, ${direction}`);
  };

  // A press on a cell makes it the active one, so the keyboard continues from there.
  const onFocusCapture = (event: React.FocusEvent<HTMLTableElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-grid-cell]");
    const [row, col] = (cell?.dataset.gridCell ?? "").split(":").map(Number);
    if (cell && (row !== active.row || col !== active.col)) setActive({ row, col });
  };

  return (
    <div className={["vx-table", "vx-grid", className].filter(Boolean).join(" ")}>
      <span className="vx-table__status" role="status">
        {announcement}
      </span>
      <div className="vx-table__scroll">
        <table
          ref={tableRef}
          role="grid"
          aria-label={label}
          aria-rowcount={rows.length + 1}
          onKeyDown={onKeyDown}
          onFocusCapture={onFocusCapture}
        >
          <thead>
            <tr>
              {columns.map((column, col) => {
                const sorted = sort?.column === column.id ? sort.direction : undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sorted}
                    data-grid-cell={`0:${col}`}
                    data-align={column.align}
                    style={{ width: column.width }}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="vx-table__sort"
                        onClick={() => toggleSort(column)}
                      >
                        {column.header}
                        <span className="vx-table__sort-icon">
                          <Icon name={SORT_ICON[sorted ?? "none"]} size={14} />
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowId(row)} aria-rowindex={index + 2}>
                {columns.map((column, col) => {
                  const position = `${index + 1}:${col}`;
                  return column.rowHeader ? (
                    <th
                      key={column.id}
                      scope="row"
                      data-grid-cell={position}
                      data-align={column.align}
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={column.id}
                      role="gridcell"
                      data-grid-cell={position}
                      data-align={column.align}
                    >
                      {column.cell(row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
