# vx: the Vaultix core, rewritten

The foundation from `docs/0134-foundation-rewrite.md`, in Rust. It does not port the inherited engine;
it is built from the lessons in `docs/0135-process-review-and-redesign.md`. One process, one Postgres,
no cache and no queue service.

## Crates

| Crate | What it is |
| --- | --- |
| `vx-secret` | `Secret`: the type a value lives in. No `Clone`, `Display`, `Serialize` or `PartialEq`; `Debug` is redacted; wiped on drop. Compile-fail tests prove it. |
| `vx-store` | Postgres pool and forward-only migrations (`vx_operate_*`, `vx_kms_*` tables, per `docs/0119`). |
| `vx-jobs` | The one background-work system: `SKIP LOCKED` claims, `LISTEN/NOTIFY` wake-ups, schedules, retries, a visible dead state. An idle worker runs no queries. |
| `vx-audit` | The audit chain: written in the action's own transaction (fail closed), hash-chained per tenant, values recorded as keyed fingerprints only. |
| `vx-keys` | The key hierarchy and the value path: root, per-scope key-encryption key, data keys, AES-256-GCM with the value's identity bound in. Starts sealed. |
| `vx-gate` | The output gate: credential shapes, canaries and learned values (plain, hex, base64) are blocked on the way out, naming the rule and never the match. |
| `vaultixd` | The server: `/healthz`, `/api/vx/v1/status`, and the guarded operate routes (jobs, schedules, audit verify). |

## Rules the build enforces

- **Reading a secret is `Secret::expose`, and `clippy.toml` forbids it everywhere.** Only the value path
  (`vx-keys`, `vx-gate`) allows it, with a stated reason. Run `cargo clippy --workspace --all-targets`.
- **A job payload or an audit detail with a secret-like key is refused.** Work receives identifiers and
  fetches a value by redeeming a handle.
- **Every JSON answer passes the output gate** before it leaves the server.
- **Forward-only migrations.** A released migration is never edited.

## Run it

```text
VX_DATABASE_URL=postgres://...  VX_LISTEN=127.0.0.1:8210  cargo run -p vaultixd
```

`VX_ROOT_KEY_FILE` (the root key as hex or the recovery key) unseals it; without it the instance starts
sealed. `VX_BOOTSTRAP_TOKEN` guards the operate routes until the identity domain exists; without it they
answer 503.

## Test it

```text
node scripts/test-vx.mjs
```

This starts a disposable Postgres, runs `cargo test --workspace` and removes the database. Tests that
need Postgres skip when `VX_TEST_DATABASE_URL` is not set.

## What exists and what does not

Built and tested: the secret type, store, jobs, audit chain, key hierarchy, output gate, and the server's
status and operate routes.

Not built yet (docs/0134 section 5): the OpenAPI contract and generated clients, identity and sessions,
the policy evaluator, the secrets, access and other domains, the redeem handle flow, the local endpoint,
the importer, and the web frontend on this API. Nothing here replaces the inherited engine yet; it grows
beside it and takes over domain by domain.
