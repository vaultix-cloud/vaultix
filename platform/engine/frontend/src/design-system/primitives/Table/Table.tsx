import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Skeleton } from "../Skeleton/Skeleton";

import "../Choice/Choice.css";
import "./Table.css";

export type TColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  width?: string;
  // Cells in this column name their row for screen readers (th scope="row"); usually the name.
  rowHeader?: boolean;
};

export type TSortDirection = "ascending" | "descending";
export type TSort = { column: string; direction: TSortDirection } | null;

export type TTableProps<T> = {
  // Names the table; shown above it unless captionHidden.
  caption: string;
  captionHidden?: boolean;
  columns: TColumn<T>[];
  rows: T[];
  rowId: (row: T) => string;
  // Sorting is the caller's: the table shows and announces the order and asks for changes.
  sort?: TSort;
  onSortChange?: (sort: TSort) => void;
  // With both, each row gets a checkbox and the header a select-all checkbox.
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  // Names a row's checkbox, e.g. (row) => row.name gives "Select DATABASE_URL".
  rowLabel?: (row: T) => string;
  density?: "comfortable" | "compact";
  loading?: boolean;
  loadingRows?: number;
  // Shown in place of rows when there are none, usually an EmptyState.
  empty?: ReactNode;
  className?: string;
};

const SortIcon = ({ direction }: { direction?: TSortDirection }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" focusable="false">
    <path
      d="m5 6.5 3-3 3 3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={direction === "descending" ? 0.35 : 1}
    />
    <path
      d="m5 9.5 3 3 3-3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={direction === "ascending" ? 0.35 : 1}
    />
  </svg>
);

const CheckCell = ({
  label,
  checked,
  mixed = false,
  onChange
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <span className="vx-choice__control vx-table__check">
      <input
        ref={ref}
        type="checkbox"
        className="vx-checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
      />
      <svg className="vx-choice__mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path className="vx-choice__check" d="m3.5 8.5 3 3 6-7" />
        <path className="vx-choice__dash" d="M4 8h8" />
      </svg>
    </span>
  );
};

// A semantic data table: caption, column headers, optional row headers, sortable columns
// (a button in the header and aria-sort), optional row selection, loading and empty states.
// It is a table, not an ARIA grid, so screen readers' table commands work and Tab moves only
// between controls.
export const Table = <T,>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowId,
  sort = null,
  onSortChange,
  selection,
  onSelectionChange,
  rowLabel,
  density = "comfortable",
  loading = false,
  loadingRows = 5,
  empty,
  className
}: TTableProps<T>) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const captionId = `${useId()}-caption`;
  const selectable = Boolean(selection && onSelectionChange);
  const ids = rows.map(rowId);
  const chosen = ids.filter((id) => selection?.has(id)).length;

  // A table wider than its box scrolls; the box then takes focus so keyboard users can scroll it.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;
    const check = () => setScrollable(box.scrollWidth > box.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const toggleSort = (column: TColumn<T>) => {
    const direction: TSortDirection =
      sort?.column === column.id && sort.direction === "ascending" ? "descending" : "ascending";
    onSortChange?.({ column: column.id, direction });
    setAnnouncement(`Sorted by ${column.header}, ${direction}`);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.(next);
  };
  const toggleAll = () => {
    const next = new Set(selection);
    if (chosen === ids.length) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectionChange?.(next);
  };

  const span = columns.length + (selectable ? 1 : 0);

  return (
    <div className={["vx-table", `vx-table--${density}`, className].filter(Boolean).join(" ")}>
      <span className="vx-table__status" role="status">
        {announcement}
      </span>
      <div
        ref={scrollRef}
        className="vx-table__scroll"
        // Only a box that scrolls is a Tab stop and a named region, so keyboard users can scroll it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable (WCAG 2.1.1)
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? "region" : undefined}
        aria-labelledby={scrollable ? captionId : undefined}
      >
        <table aria-busy={loading || undefined}>
          <caption
            id={captionId}
            className={captionHidden ? "vx-table__caption--hidden" : undefined}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="vx-table__select">
                  <CheckCell
                    label="Select all rows"
                    checked={ids.length > 0 && chosen === ids.length}
                    mixed={chosen > 0 && chosen < ids.length}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((column) => {
                const sorted = sort?.column === column.id ? sort.direction : undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sorted}
                    style={{ width: column.width }}
                    data-align={column.align}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="vx-table__sort"
                        onClick={() => toggleSort(column)}
                      >
                        {column.header}
                        <span className="vx-table__sort-icon">
                          <SortIcon direction={sorted} />
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
            {loading &&
              Array.from({ length: loadingRows }, (_, index) => (
                <tr key={`loading-${index}`} aria-hidden="true">
                  {Array.from({ length: span }, (__, cell) => (
                    <td key={cell}>
                      <Skeleton shape="text" width={cell === 0 && selectable ? "18px" : "70%"} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && empty && (
              <tr>
                <td colSpan={span} className="vx-table__empty">
                  {empty}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const id = rowId(row);
                const isSelected = Boolean(selection?.has(id));
                return (
                  <tr key={id} data-selected={isSelected || undefined}>
                    {selectable && (
                      <td className="vx-table__select">
                        <CheckCell
                          label={`Select ${rowLabel ? rowLabel(row) : id}`}
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                        />
                      </td>
                    )}
                    {columns.map((column) =>
                      column.rowHeader ? (
                        <th key={column.id} scope="row" data-align={column.align}>
                          {column.cell(row)}
                        </th>
                      ) : (
                        <td key={column.id} data-align={column.align}>
                          {column.cell(row)}
                        </td>
                      )
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
