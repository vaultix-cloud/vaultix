import type { Decorator } from "@storybook/react-vite";

// Renders a design-system story on a Vaultix surface, as it appears in the product, so contrast
// and axe checks measure real backgrounds rather than Storybook's white canvas.
export const withSurface: Decorator = (Story, context) => (
  <div
    data-theme={context.parameters.vxTheme === "light" ? "light" : undefined}
    style={{
      padding: "var(--vx-space-8)",
      minHeight: "160px",
      background: "var(--vx-color-surface-canvas)",
      color: "var(--vx-color-text-primary)",
      fontFamily: "var(--vx-font-family-sans)"
    }}
  >
    <Story />
  </div>
);
