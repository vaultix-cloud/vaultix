// Plants one bug at a time in the delivery-gate documents (kernel/contracts/documents/src/gate-*.ts, feature.v1.ts) and checks that
// tests/gate.test.mjs fails on each. A test that cannot fail proves nothing (docs/0142, section 3).
//
//   node scripts/mutation-gate-documents.mjs
//
// The bugs go into throwaway copies (scripts/lib/mutation-copy.mjs), never into the real source.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMutations } from "./lib/mutation-copy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documents = "kernel/contracts/documents";

const mutations = [
  ["a failure kind accepts undeclared keys", "kernel/contracts/documents/src/gate-failure.v1.ts", /const answerEdit = type\(\{([^\n]*)\}\)\s*\.onUndeclaredKey\("reject"\)/, (_match, inner) => `const answerEdit = type({${inner}})`],
  ["the rule is free text, not the one sentence", "kernel/contracts/documents/src/gate-failure.v1.ts", /rule: `'\$\{FIX_THE_SOURCE\}'`,/, 'rule: "string",'],
  ["text may contain a newline", "kernel/contracts/documents/src/gate-parts.ts", /\^\[\\x20-\\x7e\]\+\$/, "^[\\x09-\\x7e]+$"],
  ["a path may climb out with ..", "kernel/contracts/documents/src/gate-parts.ts", /\(\?!\(\?:\.\*\/\)\?\\\.\\\.\(\?:\/\|\$\)\)\[A-Za-z0-9\._@\+\\-\/\]\+\$`\)\);\n\n\/\*\* A glob/, "[A-Za-z0-9._@+\\-/]+$`));\n\n/** A glob"],
  ["a flow may have no mutation", "kernel/contracts/documents/src/feature.v1.ts", /mutations: slug\.array\(\)\.atLeastLength\(1\)/, "mutations: slug.array().atLeastLength(0)"],
  ["a capability may have no flow", "kernel/contracts/documents/src/feature.v1.ts", /flows: flow\.array\(\)\.atLeastLength\(1\)/, "flows: flow.array().atLeastLength(0)"],
  ["a flow may be a shell", "kernel/contracts/documents/src/gate-parts.ts", /const program = type\("'node' \| 'cargo' \| 'npm' \| 'npx'"\)/, "const program = type(\"'node' | 'cargo' | 'npm' | 'npx' | 'sh'\")"],
  ["a skipped check need not say why", "kernel/contracts/documents/src/gate-receipt.v1.ts", /reason: line\(1, 160\)/, '"reason?": line(1, 160)'],
  ["a commit may be a short id", "kernel/contracts/documents/src/gate-parts.ts", /characters\(40, 40\)\.and\(pattern\(String\.raw`\^\[0-9a-f\]\{40\}\$`\)\)/, "characters(7, 40).and(pattern(String.raw`^[0-9a-f]{7,40}$`))"],
  ["a timestamp may omit the zone", "kernel/contracts/documents/src/gate-parts.ts", /\(\?:\\\.\\d\{1,3\}\)\?Z\$/, "(?:\\.\\d{1,3})?Z?$"],
  ["an answer edit may name no edit", "kernel/contracts/documents/src/gate-failure.v1.ts", /edits: edit\.array\(\)\.atLeastLength\(1\)/, "edits: edit.array().atLeastLength(0)"],
  ["a failure may carry a check's output", "kernel/contracts/documents/src/gate-failure.v1.ts", /"logPath\?": logPath\n/, '"logPath?": logPath,\n  "output?": "string"\n']
];

const ok = await runMutations({
  root, name: "documents", mutations,
  // the tests read the delivery standard and the Go-side fixtures by relative path, so the copy carries them
  entries: [`${documents}/src`, `${documents}/tests`, `${documents}/package.json`, `${documents}/tsconfig.json`, "docs/0142-delivery-standard.md", "platform/engine/backend-go/internal/services/assistant/spec"],
  links: [`${documents}/node_modules`],
  cwd: documents, testArgs: ["--test", "tests/gate.test.mjs"]
});
process.exit(ok ? 0 : 1);
