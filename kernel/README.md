# kernel: the Vaultix engine, rewritten

The foundation from `docs/0134-foundation-rewrite.md`, in Rust. It does not port the inherited engine;
it is built from the lessons in `docs/0135-process-review-and-redesign.md`. One process, one Postgres,
no cache and no queue service.

## Layout

Nested by context, two levels deep, enforced by `node scripts/check-kernel-boundaries.mjs`
(docs/0136): `foundation/` is shared and never depends on a domain; `domains/<domain>/<role>` holds
everything about one context; `server/`, `clients/` and `services/` assemble them. The kernel never
depends on `platform/` or `control/`.

| Crate (folder) | What it is |
| --- | --- |
| `vx-secret` (`foundation/secret`) | `Secret`: the type a value lives in. No `Clone`, `Display`, `Serialize` or `PartialEq`; `Debug` is redacted; wiped on drop. Compile-fail tests prove it. |
| `vx-store` (`foundation/store`) | Postgres pool and forward-only migrations (`vx_operate_*`, `vx_kms_*` tables, per `docs/0119`). |
| `vx-jobs` (`foundation/jobs`) | The one background-work system: `SKIP LOCKED` claims, `LISTEN/NOTIFY` wake-ups, schedules, retries, a visible dead state. An idle worker runs no queries. |
| `vx-audit` (`foundation/audit`) | The audit chain: written in the action's own transaction (fail closed), hash-chained per tenant, values recorded as keyed fingerprints only. |
| `vx-keys` (`foundation/keys`) | The key hierarchy and the value path: root, per-scope key-encryption key, data keys, AES-256-GCM with the value's identity bound in. Starts sealed. |
| `vx-gate` (`foundation/gate`) | The output gate: credential shapes, canaries and learned values (plain, hex, base64) are blocked on the way out, naming the rule and never the match. |
| `vx-contract` (`foundation/contract`) | The v1 contract: every request and response as a typed struct. The server builds its answers from these, and the OpenAPI document is generated from them. |
| `vx-secrets` (`domains/secrets/core`) | Secrets: sealed per version, listed as metadata, read only by redeeming a single-use handle bound to an identity; every read is audited in the same transaction. |
| `vx-client` (`clients/cli`) | `vx` (a person enters a value at their own terminal) and `vx-mcp` (the tool server an AI client connects to). |
| `vaultixd` (`server`) | The server: `/healthz`, `/api/vx/v1/status`, `secrets` (write, list, injections, redeem) and the guarded operate routes (jobs, schedules, audit). `vaultixd init` writes the root key to a file without printing it. |

## Rules the build enforces

- **Reading a secret is `Secret::expose`, and `clippy.toml` forbids it everywhere.** Only the value path
  (`vx-keys`, `vx-gate`) allows it, with a stated reason. Run `cargo clippy --workspace --all-targets`.
- **A job payload or an audit detail with a secret-like key is refused.** Work receives identifiers and
  fetches a value by redeeming a handle.
- **Every JSON answer passes the output gate** before it leaves the server.
- **Forward-only migrations.** A released migration is never edited.

## Run it

### Independent build candidate

`node scripts/build-kernel.mjs` from the repository root prepares an isolated
kernel source directory and builds `kernel/Dockerfile.standalone-vaultix`.
`--prepare-only` prepares the directory without Docker. The manifest in the
printed `result.json` records the exact input hashes, source revision and dirty
state. Only Rust sources, Cargo manifests/lockfile, migrations and the build
recipe enter it. The inherited application, browser UI and local configuration
do not. The local image contains `vaultixd`, `vx`, and `vx-mcp`; Postgres remains
external. The image runs as UID 10001 and needs read access to its mounted root
key file. A sealed start remains supported.

This is an additive candidate, **not a completed cutover or an inherited-store
upgrade**. Never point it at an existing application's database as a migration
shortcut. Its image check exercises OpenAPI generation and a real HTTP journey
through setup, login, secret write/list/redeem, session denial, logout and
encrypted backup/restore on disposable Postgres databases.
The existing self-hosted build command still builds the inherited application.
See [minimal build status](../docs/0146-minimal-independent-build.md).

```text
VX_DATABASE_URL=postgres://...  VX_LISTEN=127.0.0.1:8210  cargo run -p vaultixd
```

`VX_ROOT_KEY_FILE` (the root key as hex or the recovery key) unseals it; without it the instance starts
sealed. Every operate and secrets route needs a session. There is no bootstrap token and `VX_BOOTSTRAP_TOKEN`
is ignored: an operator runs `vaultixd setup-code` once, the first owner redeems that code at
`POST /api/vx/v1/auth/setup` within 15 minutes, and people then sign in at `POST /api/vx/v1/auth/sessions`.

## Test it

```text
node scripts/test-vx.mjs
```

This starts a disposable Postgres, runs `cargo test --workspace` and removes the database. Tests that
need Postgres skip when `VX_TEST_DATABASE_URL` is not set.

## The v1 contract

```text
node scripts/test-contract-v1.mjs            drift check, generator tests, static types, contract tests on a real server
node scripts/test-contract-v1.mjs --update   regenerate openapi.json and the TypeScript after changing the Rust types
```

Rust types (`foundation/contract`) are the source. `vaultixd openapi` prints the OpenAPI 3.1 document, checked
in as `contracts/v1/openapi.json`. A strict generator (`contracts/v1/scripts/generate.mjs`) turns it into ArkType
source under `contracts/v1/generated/`, with static types by inference, and refuses any construct it cannot map
rather than weakening a validator. No Zod. The contract tests call every operation on a real server, validate
every answer (errors included), mutate answers to prove the validators reject drift, and check that the server and
the request validators agree on what is invalid.

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
- **The tool server's credential sits in the client's configuration.** `VX_TOKEN` is a session bearer
  (it expires after 15 minutes and carries its owner's grants), so a model that can read the client's
  config file (a tool with file access) could find it while it is live. The live sessions gave Claude only the Vaultix tools. The real
  fix is device-bound pairing and per-identity policy (docs/0124 step 4).
- **A profile's program runs with the person's rights.** It can reach the network and files, so a profile
  is code a person reviews, not a setting.
- The standalone kernel image has passed its scoped auth/secrets/recovery journey
  on Linux. Nothing here has been tested at scale.

## What exists and what does not

Built and tested: the secret type, store, jobs, audit chain, key hierarchy, output gate, secrets (store,
metadata, single-use handles, redeem), the server's secrets and operate routes, the `vx` command and the
`vx-mcp` tool server.

Also built: the OpenAPI contract, generated ArkType validators, first-owner setup,
built-in password login and expiring/revocable sessions with scope grants.

Not built yet (docs/0134 section 5): complete human and machine identity workflows,
the full policy evaluator, the other domains, the web
frontend on this API, the importer, folders and environments as a tree, versions and rollback, approvals,
and the local endpoint with device pairing. Nothing here replaces the inherited engine yet; it grows
beside it and takes over domain by domain.
