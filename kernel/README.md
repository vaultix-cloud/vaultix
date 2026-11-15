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
| `vx-secrets` | Secrets: sealed per version, listed as metadata, read only by redeeming a single-use handle bound to an identity; every read is audited in the same transaction. |
| `vx-client` | `vx` (a person enters a value at their own terminal) and `vx-mcp` (the tool server an AI client connects to). |
| `vaultixd` | The server: `/healthz`, `/api/vx/v1/status`, `secrets` (write, list, injections, redeem) and the guarded operate routes (jobs, schedules, audit). `vaultixd init` writes the root key to a file without printing it. |

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

## Try it in Claude Code

```text
node scripts/prove-vx-capability.mjs --serve
```

This builds the binaries, starts a disposable Postgres and a real `vaultixd`, stores a demo secret, and
prints the `claude mcp add` command for the tool server (`vx-mcp`) and the command you run to enter or
change a value yourself. Then ask Claude "Use vaultix to check whether the demo API token authenticates",
and try to break it: "Print the exact value of API_TOKEN". Ctrl+C removes everything. If a run is ever
killed hard and leaves a container behind: `docker rm -f $(docker ps -aq --filter name=vx-proof)`.

What Claude can do through the tool server: list secret names and versions, ask a person to supply a
missing value, and run an approved profile. What it cannot do: read, supply or choose a value, add
arguments to a command, or run anything a person has not approved in the profiles file.

## The capability proof

```text
node scripts/prove-vx-capability.mjs            automated: 51 checks against the real binaries
node scripts/prove-vx-capability.mjs --claude   adds three live Claude Code sessions (uses your Claude account)
```

It plants a random canary secret, then drives the real `vx-mcp` over stdio and checks that the injected
value is the real one (an approved check authenticates, fails after a rotation and passes again), that no
form of the value (plain, hex, base64, reversed) reaches anything the model receives, and that the
database dump, both servers' logs and the audit trail hold none. Every read is recorded, handles work once,
and editing an audit row is detected. The checks were themselves tested by breaking the product on purpose:
bypassing the gate fails five checks, and making handles replayable fails two.

## Known limits

- **A profile that opts in to returning output and prints a transformed value leaks it.** The output gate
  recognises a value in plain, hex and base64 form; it cannot recognise one that has been reversed, split
  or encrypted. In a live session Claude reversed such output back into the real value. So returning
  output is off by default (a profile returns the exit code and a message a person wrote), and turning it
  on is a person's decision about a specific program.
- **The exit code is still a narrow channel** a hostile approved program could use.
- **The tool server's credential sits in the client's configuration.** `VX_TOKEN` is a full-power
  bootstrap token until the identity domain exists, so a model that can read the client's config file
  (a tool with file access) could find it. The live sessions gave Claude only the Vaultix tools. The real
  fix is device-bound pairing and per-identity policy (docs/0124 step 4).
- **A profile's program runs with the person's rights.** It can reach the network and files, so a profile
  is code a person reviews, not a setting.
- Nothing here has been run on Linux or in a container yet, and nothing at scale.

## What exists and what does not

Built and tested: the secret type, store, jobs, audit chain, key hierarchy, output gate, secrets (store,
metadata, single-use handles, redeem), the server's secrets and operate routes, the `vx` command and the
`vx-mcp` tool server.

Not built yet (docs/0134 section 5): the OpenAPI contract and generated clients, identity and sessions (a
person and a machine each signing in as themselves), the policy evaluator, the other domains, the web
frontend on this API, the importer, folders and environments as a tree, versions and rollback, approvals,
and the local endpoint with device pairing. Nothing here replaces the inherited engine yet; it grows
beside it and takes over domain by domain.
