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
  an audit row and into a log line each made it fail. The test runs in its own binary: beside busy neighbour tests it lost
  its INFO log line 40 runs out of 40; rebuilding the tracing interest cache did not fix that, so the mechanism is not
  fully explained, and isolation (enforced by `check-kernel-boundaries.mjs`: one test per file that installs a subscriber)
  is the proven fix.
- **A failed audit write blocks the sync.** If the plan cannot be recorded, no put, delete or hook runs and the destination
  is exactly as it was; ignoring that failure in the engine made the test fail. If only the outcome cannot be recorded, the
  caller gets `Unrecorded` with the report, never a success.
- Order: list, then record the plan, then apply, then the hook, then record the outcome.
- Retries only for transient errors, within a budget; one failing name does not stop the others; unchanged secrets are not
  rewritten; a destination that cannot return values is always written; the hook runs only when something changed.
- **A connector error is a kind and a fixed code, with no text field**, so an upstream error that echoes a request body has
  no path into a log or audit row. The type makes this a compile-time fact, not a test.

### The key schema against the inherited code (`tests/differential.rs`)

`node scripts/connectors-differential.mjs` runs the inherited `getKeyWithSchema`, `stripSchema` and `matchesSchema` (copied
verbatim, types removed) on the real `handlebars` 4.7.10 for 22 schemas, 6 environments, 15 keys and about 2,000 destination
names, and freezes the answers in `tests/fixtures/inherited-schema.json` (`--check` proves the fixture still matches). The
Rust test compares every answer and fails on any difference that is not in a named class. Result: 666 `apply`, 2,005
`matches` and 1,978 `strip` answers agree; every other answer falls in one of these classes, none of them a bug in the new
code, several of them bugs in the inherited code that existing data may depend on:

| Difference | Inherited behaviour | New behaviour |
| --- | --- | --- |
| Escaping (504 `apply` cases) | The name is HTML-escaped: `A&B` becomes `A&amp;B`, `K=V` becomes `K&#x3D;V` | Never escaped |
| Escaped environment (118 `matches`, 120 `strip`) | The environment is escaped too, so a sync could not recognise its own names | Not escaped |
| Empty secret name (70 + 70) | `APP_` matches `APP_{{secretKey}}` and strips to an empty name | Not a secret |
| Path rule in `strip` (22) | `matches` enforces one level for `/` schemas, `strip` does not, so the two disagree | One rule for both |
| Nine schemas refused | `plain` and `{{environment}}` (every secret is written to one name and they overwrite each other); `{{secretKey}}` twice; `{{{secretKey}}}` (triple braces switch escaping off); `{{#if}}` blocks; `{{upper secretKey}}` (errors at run time); `{{unknown}}{{secretKey}}` (the unknown part silently renders as nothing); an unclosed `{{secretKey` | Refused when the schema is saved, with a reason |

The empty schema text means "no schema", and in both it leaves names alone. **Migration:** a stored schema that the grammar
refuses, or a destination holding escaped names, must be found and reported at import, not silently renamed. That check
is not written yet; the first provider must include it.

Mutation checks: making `Environment` render as empty produced 670 unexplained differences, and allowing empty names made
a class stop occurring and fail the test (a class that never occurs would be explaining nothing).

### Storage and the production audit sink (`src/store.rs`, migration `0003_connectors.sql`, `tests/store.rs`)

Tables `vx_connectors_connections` (credentials as one sealed document) and `vx_connectors_syncs` (which secrets go to which
destination, under which key schema), and `PgAudit`, the sink that appends each event to the hash chain. Proven against a real
Postgres (`node scripts/test-vx.mjs`; a plain `cargo test` skips these 11 tests and proves nothing about them):

- **Never in the clear, anywhere.** After storing a credential holding a canary, every row of every table in the database is
  rendered as text and searched; the canary is not there, and the scan is shown to have read the audit rows. Listings and
  `get` return metadata only.
- **Opening is one function and is recorded.** `open_credentials` returns exactly what was stored and appends
  `connector.credentials.opened` with a keyed fingerprint (so "this was read" is provable) in the same transaction. With the
  audit table taken away, opening, creating and deleting all fail and leave the data as it was; making the read ignore a
  failed audit write made that test fail.
- **Isolation.** Another project cannot see or open a connection, and gets the same error as for a missing one. A sealed
  document copied onto another connection's row will not open (it is bound to project and id). A different root key opens
  nothing.
- **Refused when saved, not when run:** a bad kind or name, a duplicate name, empty credentials, a key schema the grammar
  refuses (`plain`, `{{{secretKey}}}`, helpers, a doubled `{{secretKey}}`), and a sync that names another project's connection.
- **A real sync through `PgAudit`** records `planned` then `finished` in a chain that verifies, with no value anywhere in the
  database; with the audit database down, the sync changes nothing in the destination.

`vx_keys::current_or_create` and `unwrap_stored` were added so connections and secrets share one key path. The secrets crate
still has its own private copy of the same logic; moving it onto the shared one is a small follow-up, left alone so a
working, tested crate is not changed in the same step.

Not done: a real provider (GitHub, then Fly.io); the migration check for stored schemas and escaped names; `run_sync` (it needs
values from the secrets domain, so it belongs in the server, because domains meet only through foundation or the server);
the `/api/vx/v1/connectors` routes in the contract; the screens. Nothing in the old backend has been deleted and
`scripts/lineage-ceiling.json` is unchanged.

### The GitHub connector (`domains/connectors/github`, crate `vx-connector-github`)

Actions secrets for a **repository**, a **repository environment** or an **organisation** (visibility `all`, `private` or
`selected` with repository ids, the same three scopes and rules as the inherited sync), authenticated by a **personal access
token** or a **GitHub App**. The credential document stored sealed in a connection is
`{"method":"pat","token":"..."}` or `{"method":"app","appId":"...","installationId":"...","privateKey":"-----BEGIN RSA PRIVATE KEY-----..."}`.

- **App auth:** the connector signs an RS256 JWT (issuer = app id, ten-minute window), asks for an installation token, caches
  it until two minutes before it expires and reuses it, and mints a new one if GitHub revokes it (a 401 becomes a retry).
- **Encryption:** each value is sealed to the destination's public key with libsodium's `crypto_box_seal` before it leaves the
  process, so a request body never holds a value. Checked against the real libsodium both ways (`tests/interop.rs`).
- **One host, no redirects:** requests go to `https://api.github.com`, an Enterprise Server host (`https://<host>/api/v3`), or a
  loopback address for tests, fixed at construction. Redirects are not followed, so a credential cannot be sent elsewhere.
- **Failures are a kind and a fixed code** (`bad_credentials`, `forbidden`, `rate_limited`, `target_not_found`,
  `unprocessable`, `server_error`, `invalid_secret_name`, `value_too_large`, ...). A 403 with no quota left, or a 429, is a
  rate limit and carries the wait GitHub asked for; a plain 403 is a permission error and is not retried.
- **Names:** GitHub upper-cases them, so the connector reports its own spelling (`fold`). The engine now compares, writes and
  decides ownership in that spelling, and refuses a sync in which two Vaultix names (`db_url`, `DB_URL`) would become one.
  The inherited code upper-cased silently and let one overwrite the other. Names GitHub refuses (`GITHUB_` prefix, a leading
  digit, characters other than letters, digits and underscores) fail that one item and not the rest.

Proof (`cargo test -p vx-connector-github`, 28 tests) is against a fake GitHub on loopback that decrypts the sealed values with
its own key, verifies the App's JWT signature, issuer and window, enforces upper-case names, paginates, and injects failures:
secrets arrive decrypted and exact; the App flow mints one token for a whole sync and a second after revocation; all three
scopes use their own paths and send visibility correctly; five secrets over three pages are all listed and only the
schema-owned stale ones deleted; collisions are refused before any write; rate limits are waited out; redirects are not
followed (a second server received nothing); and no value appears in any URL, request body, report, error or audit row.
Mutation checks: following redirects, dropping the name folding and ignoring `Retry-After` each made tests fail (the first
attempt at the last one did not change the file and showed no failure, which is why the diff is now checked).

Found while writing it, and fixed in the engine: **the destination listing was not retried**, so a rate limit or an expired
App token on the first request ended the whole sync. A connector error can now carry a wait time (a number, not text) and the
engine honours it up to a minute.

**What this does not prove: nothing was run against api.github.com or a real GitHub App.** The fake is built from GitHub's
documented behaviour, and the encryption is checked against libsodium, but a first run against a real repository with a real
token and a real App installation is still needed and must be done by the owner (it needs credentials that must not pass
through chat). Also not done: the third inherited connection method (GitHub OAuth, which needs a web callback), Enterprise
Server beyond host validation, Dependabot and Codespaces secrets (the inherited sync did not have them either), and
`run_sync`, the routes and the screens.

## 4. Order

1. **Done:** the trait and the engine against an in-memory destination (section 3).
2. **Done:** differential test of the key schema against the inherited code (section 3). Still to do: the import check for stored schemas and escaped names.
3. **GitHub done (section 3, fake server plus libsodium; not yet against real GitHub).** Next: Fly.io (the hook),
   then one pure key-value provider to prove the declarative tier.
4. **Connection record, tables and `PgAudit` done (section 3).** Still to do: the `/api/vx/v1/connectors` routes
   in the contract, and the screen from Vaultix primitives.
5. Port the rest; delete each inherited provider as its replacement passes, lowering the lineage ceiling each time.
