import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { normalizePath, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import workbench from "./.storybook/vite.config";

// A clean build checkout links node_modules into another tree. The browser test server only
// serves allowed paths and builds its allow list itself, ignoring a project's server.fs, so the
// real node_modules path is added once that server's config is resolved.
const allowLinkedModules: Plugin = {
  name: "vaultix:allow-linked-node-modules",
  configResolved(config) {
    const real = normalizePath(
      realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))
    );
    if (!config.server.fs.allow.includes(real)) config.server.fs.allow.push(real);
  }
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        ...workbench,
        optimizeDeps: { include: ["react/jsx-dev-runtime", "@tanstack/react-router"] },
        plugins: [
          allowLinkedModules,
          storybookTest({ configDir: fileURLToPath(new URL("./.storybook", import.meta.url)) })
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }]
          }
        }
      }
    ]
  }
});
