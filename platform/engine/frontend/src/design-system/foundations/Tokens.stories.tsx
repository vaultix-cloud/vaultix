import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Table, TColumn } from "../primitives/Table/Table";
import { withSurface } from "../storybook/Surface";
import { contrastReport, tokenList, TTokenEntry } from "../tokens/tokens";

type TPair = (typeof contrastReport)[number];

const swatch = (cssVar: string) => (
  <span
    style={{
      display: "inline-block",
      width: "32px",
      height: "20px",
      borderRadius: "var(--vx-radius-sm)",
      border: "1px solid var(--vx-color-border-default)",
      background: `var(${cssVar})`,
      verticalAlign: "middle"
    }}
  />
);

const mono = (text: string) => (
  <code style={{ fontFamily: "var(--vx-font-family-mono)", fontSize: "var(--vx-font-size-sm)" }}>
    {text}
  </code>
);

const colorColumns: TColumn<TTokenEntry>[] = [
  { id: "swatch", header: "Swatch", cell: (row) => swatch(row.cssVar), width: "72px" },
  { id: "name", header: "Role", rowHeader: true, cell: (row) => mono(row.name) },
  { id: "dark", header: "Dark", cell: (row) => mono(row.dark) },
  { id: "light", header: "Light", cell: (row) => mono(row.light) }
];

const semanticColors = tokenList.filter(
  (token) => token.layer === "semantic" && token.type === "color"
);

const SemanticColors = () => (
  <Table
    caption={`Semantic colour roles (${semanticColors.length})`}
    columns={colorColumns}
    rows={semanticColors}
    rowId={(row) => row.name}
    density="compact"
  />
);

const pairColumns: TColumn<TPair>[] = [
  {
    id: "sample",
    header: "Sample",
    width: "88px",
    cell: (row) => {
      const cssVar = (name: string) => `var(--vx-${name.replaceAll(".", "-")})`;
      // Text pairs show text; 3:1 pairs are for graphics (borders, icons, rings), so they show a
      // shape, which is what they are measured for.
      return (
        <span
          data-theme={row.theme}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--vx-space-1)",
            padding: "2px var(--vx-space-2)",
            borderRadius: "var(--vx-radius-sm)",
            background: cssVar(row.bg),
            color: cssVar(row.fg),
            fontWeight: 600
          }}
        >
          {row.min >= 4.5 ? (
            "Aa"
          ) : (
            <span
              aria-hidden="true"
              style={{
                width: "14px",
                height: "14px",
                border: `2px solid ${cssVar(row.fg)}`,
                borderRadius: "3px"
              }}
            />
          )}
        </span>
      );
    }
  },
  { id: "pair", header: "Pair", rowHeader: true, cell: (row) => mono(`${row.fg} on ${row.bg}`) },
  { id: "theme", header: "Theme", cell: (row) => row.theme },
  { id: "ratio", header: "Ratio", align: "end", cell: (row) => `${row.ratio.toFixed(2)}:1` },
  { id: "min", header: "Needs", align: "end", cell: (row) => `${row.min}:1` }
];

const Contrast = () => (
  <Table
    caption={`Contrast the build enforces (${contrastReport.length} checks, weakest first)`}
    columns={pairColumns}
    rows={[...contrastReport].sort((a, b) => a.ratio / a.min - b.ratio / b.min)}
    rowId={(row) => `${row.theme}:${row.fg}:${row.bg}`}
    density="compact"
  />
);

const byPrefix = (prefix: string) => tokenList.filter((token) => token.name.startsWith(prefix));

const Scales = () => (
  <div style={{ display: "grid", gap: "var(--vx-space-8)" }}>
    <section>
      <h2 style={{ fontSize: "var(--vx-font-size-lg)", margin: "0 0 var(--vx-space-3)" }}>Space</h2>
      <ul
        style={{
          display: "grid",
          gap: "var(--vx-space-2)",
          margin: 0,
          padding: 0,
          listStyle: "none"
        }}
      >
        {byPrefix("space.").map((token) => (
          <li
            key={token.name}
            style={{ display: "flex", alignItems: "center", gap: "var(--vx-space-3)" }}
          >
            <span style={{ width: "96px" }}>{mono(token.name)}</span>
            <span
              style={{
                width: `var(${token.cssVar})`,
                height: "12px",
                background: "var(--vx-color-accent-solid)",
                borderRadius: "2px"
              }}
            />
            <span style={{ color: "var(--vx-color-text-secondary)" }}>{token.dark}</span>
          </li>
        ))}
      </ul>
    </section>
    <section>
      <h2 style={{ fontSize: "var(--vx-font-size-lg)", margin: "0 0 var(--vx-space-3)" }}>
        Radius
      </h2>
      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--vx-space-4)",
          margin: 0,
          padding: 0,
          listStyle: "none"
        }}
      >
        {byPrefix("radius.").map((token) => (
          <li
            key={token.name}
            style={{ display: "grid", justifyItems: "center", gap: "var(--vx-space-2)" }}
          >
            <span
              style={{
                width: "56px",
                height: "56px",
                border: "2px solid var(--vx-color-border-strong)",
                borderRadius: `var(${token.cssVar})`
              }}
            />
            {mono(token.name)}
          </li>
        ))}
      </ul>
    </section>
    <section>
      <h2 style={{ fontSize: "var(--vx-font-size-lg)", margin: "0 0 var(--vx-space-3)" }}>Type</h2>
      <ul
        style={{
          display: "grid",
          gap: "var(--vx-space-2)",
          margin: 0,
          padding: 0,
          listStyle: "none"
        }}
      >
        {byPrefix("font.size.").map((token) => (
          <li
            key={token.name}
            style={{ display: "flex", alignItems: "baseline", gap: "var(--vx-space-3)" }}
          >
            <span style={{ width: "120px" }}>{mono(`${token.name} ${token.dark}`)}</span>
            <span style={{ fontSize: `var(${token.cssVar})` }}>Rotate DATABASE_URL now</span>
          </li>
        ))}
      </ul>
    </section>
    <section>
      <h2 style={{ fontSize: "var(--vx-font-size-lg)", margin: "0 0 var(--vx-space-3)" }}>
        Motion
      </h2>
      <ul
        style={{
          display: "grid",
          gap: "var(--vx-space-1)",
          margin: 0,
          padding: 0,
          listStyle: "none"
        }}
      >
        {[...byPrefix("duration."), ...byPrefix("easing.")].map((token) => (
          <li key={token.name}>
            {mono(token.name)}{" "}
            <span style={{ color: "var(--vx-color-text-secondary)" }}>{token.dark}</span>
          </li>
        ))}
      </ul>
    </section>
  </div>
);

const meta = {
  title: "Design System/Foundations/Tokens",
  component: SemanticColors,
  decorators: [withSurface],
  parameters: {
    a11y: { test: "error" },
    docs: {
      description: {
        component:
          "The token reference, read from the generated `tokens.ts`, so it always matches what the build ships. **Semantic colours** are the roles components draw with, with their dark and light values. **Contrast** lists every pair the build checks, in both themes, weakest first; a palette that fails any of them cannot build. **Scales** show space, radius, type and motion. Edit tokens in `tokens/source/*.json` and run `node scripts/build-tokens.mjs`."
      }
    }
  }
} satisfies Meta<typeof SemanticColors>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colors: Story = {
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table");
    await expect(within(table).getAllByRole("rowheader")).toHaveLength(semanticColors.length);
  }
};

export const ContrastChecks: Story = {
  render: () => <Contrast />,
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table");
    await expect(within(table).getAllByRole("rowheader")).toHaveLength(contrastReport.length);
    await expect(contrastReport.every((pair) => pair.ratio >= pair.min)).toBe(true);
  }
};

export const SpaceTypeAndMotion: Story = { render: () => <Scales /> };

export const LightTheme: Story = { parameters: { vxTheme: "light" } };
