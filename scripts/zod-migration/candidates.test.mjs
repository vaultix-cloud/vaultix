import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zodCandidates } from "../lib/zod-candidates.mjs";

test("tracked working-tree candidates retain every supported import shape and binary content", () => {
  const root = mkdtempSync(join(tmpdir(), "vx-zod-candidates-"));
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  git(["init", "-q"]);
  const imports = {
    "kernel/a.ts": 'import {z} from "zod";',
    "platform/engine/spaced file.tsx": "import z from 'zod/v3';",
    "scripts/a.js": 'const z = require("zod");',
    "scripts/b.jsx": 'import adapter from "@tanstack/zod-adapter";',
    "scripts/c.mjs": 'import r from "@hookform/resolvers/zod";',
    "scripts/d.cjs": 'import t from "fastify-type-provider-zod";',
    "scripts/e.ts": 'import t from "zod-validation-error";',
    "scripts/f.ts": 'import t from "@asteasolutions/zod-to-openapi";',
    "kernel/binary.ts": '\0import z from "zod";',
    "kernel/edited.ts": "no import yet",
    "kernel/removed.ts": 'import z from "zod";'
  };
  for (const [file, content] of Object.entries(imports)) write(file, content);
  write(".gitattributes", "kernel/binary.ts binary\n");
  write("leftover/snapshot.ts", 'import z from "zod";');
  write("docs/example.md", 'import z from "zod";');
  git(["add", "."]);
  write("kernel/edited.ts", 'import z from "zod";');
  write("kernel/removed.ts", "no import now");
  write("kernel/untracked.ts", 'import z from "zod";');
  assert.deepEqual(zodCandidates(root).sort(), Object.keys(imports).filter(path => path !== "kernel/removed.ts").sort());
});

test("no matches means an empty candidate set, not a failed inventory", () => {
  const root = mkdtempSync(join(tmpdir(), "vx-zod-empty-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  assert.deepEqual(zodCandidates(root), []);
});
