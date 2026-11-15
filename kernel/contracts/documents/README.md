# Versioned documents, in ArkType

The AI connection and persona documents (`vaultix.ai-connection.v1`, `vaultix.ai-persona.v1`) authored in ArkType,
with a registry that reads a document by its `schemaVersion`. See `docs/0136-kernel-platform-control-and-schemas.md`
for the research, the findings and the versioning policy.

```text
node scripts/test-documents.mjs            type-check, export drift and release locks, fixtures, fuzz, version tests
node scripts/test-documents.mjs --export   rewrite schemas/*.schema.json first
node kernel/contracts/documents/scripts/export.mjs --lock <id>   pin a released version's schema
```

- `src/rules.ts`: `characters()` (counts characters, not UTF-16 units), `notArray`, `unique`, the JSON Schema export.
- `src/ai-connection.v1.ts`, `src/ai-persona.v1.ts`: the documents. One object type per kind or role, each declaring
  exactly its fields.
- `src/registry.ts`: `parseDocument`, upgrades, `describe` (problems that never repeat the input) and the release lock.
- `schemas/`: the exported JSON Schema 2020-12, committed, for Go, Rust and tools.
- `tests/`: the 77 existing fixtures in three judges, a differential fuzz against the hand-written schemas, and the
  version mechanics.

Structural rules only. The two rules a schema cannot say stay in the server (docs/0136).
