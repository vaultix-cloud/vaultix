# 0139: The connector framework

**Status:** first slice built 2026-11-15 (`kernel/domains/connectors/core`, crate `vx-connectors`, 12 tests). **Builds on:**
0138 (the rewrite map: connectors are about 62k inherited lines), 0127 (more, never less), 0136 (kernel layout).

## 1. What is being replaced

The inherited product has 89 `app-connection` directories (credentials and their validation per provider) and 46
`secret-sync` directories (the write path), plus 46 provider names in one enum and a central union type that every new
provider has to be added to by hand. The shared code is a 800-line `secret-sync-fns.ts` and a queue. Sync functions
range from 83 to 1,055 lines (median 211).

Reading one small provider (Fly.io) showed that **a provider is not only data**: it lists through GraphQL, writes through
REST, and redeploys machines afterwards. A framework that is only a JSON spec would cover the easy providers and force
the rest back into one-off code. So there are two tiers.

## 2. Design

1. **Shared, network-free, value-free (built):** the key schema and the sync plan.
   - The key schema is a fixed grammar (text, one `{{secretKey}}`, optionally `{{environment}}`). The inherited one was a
     full Handlebars template, which allows helpers and HTML-escapes what it inserts, so a name containing `&` or `=`
     changed on the way out and could not be matched on the way back. A test pins that names are never escaped.
   - The plan takes names and keyed fingerprints and returns what to write, what to delete and what is unchanged. It never
     receives a value, so a bug in it cannot leak one. A destination that cannot return a value is always written ("unknown"
     is not "equal"). Deletes are limited to names the schema owns, so a sync never removes another environment's or an
     unrelated name, and a path schema owns one level only.
2. **The trait (next):** `Connector` with `describe` (fields, auth methods, what the destination can read), `check` (is the
   credential valid and what can it do), `list`, `put`, `delete`, and an optional `after_sync` hook (the Fly.io redeploy).
   One engine drives every connector: plan, call, retry with backoff, honour rate limits, write the audit event in the same
   transaction, and fail closed. A connector receives each value as a `Secret` for the single call that writes it.
3. **The declarative tier (after):** for providers that are key-value REST (a list call, a put call, a delete call), a spec
   file replaces the code. Which providers qualify is to be decided by reading each, not by guessing; the count is unknown.
4. **Egress:** a connector may only reach hosts in its declared allowlist, so a connector cannot be turned into an
   exfiltration path (this is also the test the assistant service will need).
5. **Registration:** a connector registers itself; there is no central enum or union to edit.

## 3. What is proven and what is not

Proven (`cargo test -p vx-connectors`, 24 tests): the schema and the planner (12 unit tests), and the engine against an
in-memory destination (12 tests in `tests/`):

- **No value in any report, error, log line or audit row.** A canary value is pushed through success, retry, permanent
  failure, delete, a failing hook and each audit failure; the rendered reports, errors, audit rows (Debug and JSON) and captured
  log output are searched for it, and the test asserts the audit rows and log lines were actually present. Planting a leak into
  an audit row and into a log line each made it fail. The test runs in its own binary because tracing caches log-site
  enablement per process and made it flaky beside other tests (found, not assumed).
- **A failed audit write blocks the sync.** If the plan cannot be recorded, no put, delete or hook runs and the destination
  is exactly as it was; ignoring that failure in the engine made the test fail. If only the outcome cannot be recorded, the
  caller gets `Unrecorded` with the report, never a success.
- Order: list, then record the plan, then apply, then the hook, then record the outcome.
- Retries only for transient errors, within a budget; one failing name does not stop the others; unchanged secrets are not
  rewritten; a destination that cannot return values is always written; the hook runs only when something changed.
- **A connector error is a kind and a fixed code, with no text field**, so an upstream error that echoes a request body has
  no path into a log or audit row. The type makes this a compile-time fact, not a test.

Not done: a differential test of the key schema against the inherited TypeScript (list each difference, as 0137 does for
Zod); the production audit sink (the plan record and outcome record are separate transactions, because the destination
cannot join one; the hash-chain append is `vx_audit::append`); a real provider; the database tables; the routes; the
screens. Nothing in the old backend has been deleted and `scripts/lineage-ceiling.json` is unchanged.

## 4. Order

1. **Done:** the trait and the engine against an in-memory destination (section 3).
2. Differential test of the key schema against the inherited code; list the differences.
3. First real provider: GitHub (the largest connection, 968 lines, so it tests the trait hardest), then Fly.io (the hook),
   then one pure key-value provider to prove the declarative tier.
4. The connection record (credentials stored as `Secret`, encrypted, never returned), the `/api/vx/v1/connectors` routes
   in the contract, and the screen from Vaultix primitives.
5. Port the rest; delete each inherited provider as its replacement passes, lowering the lineage ceiling each time.
