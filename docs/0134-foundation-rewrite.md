# 0134: The foundation rewrite

**Status:** proposed, 2026-11-15. **Supersedes the structure parts of:** 0122 stage ordering, 0132 section 3
(the backbone). **Builds on:** 0127 (one API), 0128 (API lessons), 0130 (program plan), 0133 (clean-slate
core and AI-safe space). **Evidence:** four research passes on 2026-11-15 (OpenBao, other leaders, our own
tree, Nomen and Wardenclyffe); this doc cites their findings, not memory.

Vaultix is one lightweight product. Solo founders and small teams are the same customer, so there are no
size tiers in the code. The foundation is rewritten around what OpenBao does well and what Infisical's
users suffer, with the heavy, well-planned UI on top of it (0130, 0131).

## 1. What the evidence says about our tree

| Finding | Source |
| --- | --- |
| About 90% of backend and frontend files are inherited and unread (8,612 of 12,478 product files unread). The authored parts are the Go backend, the design system, the MCP layer and a thin `vx` route set. | `docs/code-audit/inventory.tsv` |
| Four inherited API trees (v1 to v4, 315 route files) are mounted beside `/api/vx/v1` (5 files). `routes/index.ts` is 4,178 lines. | route counts |
| 120 flat service folders organised by the upstream object model, not by our 15 domains. About 124 queue names. | counts |
| An idle instance does about 97 cache operations a second and holds about 1 GB (dry run, 2 minutes; the hour run replaces this). | `scripts/measure-idle-baseline.mjs` |
| `backend/src/shippin` is 770 files of inherited paid-tier code, with a name that collides with the commercial boundary. | counts |
| No Rust exists in the product yet. | file search |

## 2. Principles, from the study

**Take from OpenBao** (its docs, `openbao.org`): a sealed-by-default key hierarchy with one clear unseal story;
deny-by-default policies with one-sentence precedence; audit that hashes values and refuses to run if it can't
record; single-use, short-lived handles instead of values (its response wrapping); leases for anything dynamic;
transactional storage; declarative first-start setup; namespaces designed in; a written threat model.

**Take from Infisical:** the project, environment and folder model people already understand; secret versions and
point-in-time recovery; approvals; the breadth of syncs; the CLI, operator and SDK experience; two-service
self-hosting (database plus app).

**Do not copy:**

- OpenBao's Shamir ceremony as the default human experience, verb-mapped capabilities (use named actions:
  `reveal`, `inject`, `rotate`), unfiltered list, or external plugin binaries that churn between releases.
- Infisical's API sprawl, idle queue polling, flat service folders, open-core split, or the dependency on a
  separate cache and queue stack.
- From the wider market: never-expiring tokens, per-machine pricing, and bolting an agent broker onto a human
  store. The gap nobody fills is a vault designed so no value ever crosses MCP or reaches a model, with the
  broker built in.

## 3. The shape

**Language, decided 2026-11-15 (owner):** the core is Rust, not Go. Pre-release removes the main cost of
Rust (migrating later), and Rust gives the AI-safe space a guarantee Go cannot: a secret lives in a type that
cannot be cloned, formatted or serialised, and reading it is a lint error outside the value path
(`kernel/crates/vx-secret`, proven by compile-fail tests). The inherited Node backend and the
partial Go port are retired domain by domain; this supersedes the Go and Rust split in 0027 and in the
earlier sections of this document and of 0133.

**One Rust service, `vaultixd`, one database.** Postgres only. This is the main lightness decision:

- **No required Redis, Dragonfly or BullMQ.** Jobs live in Postgres (`FOR UPDATE SKIP LOCKED`, with
  `LISTEN/NOTIFY` waking workers). Work is event-driven; a scheduler wakes only for the next due job. Nothing
  polls while nobody is using it. Caches are in process.
- **Domains are crates**, one per canonical domain (0120), each with service, store, routes, events and
  tests. They call each other through traits, never through each other's tables. Built so far, with tests
  against a real Postgres: `vx-secret`, `vx-store`, `vx-jobs`, `vx-audit`, `vx-keys`, `vx-gate` and the
  `vaultixd` server (`kernel/README.md`).
- **Seams are interfaces** for storage, seal and key custody, identity issuer, event bus and audit sink.
  The first implementation of each is in process. Splitting the identity service or workers into separate
  deployments later is a wiring change behind the same API and issuer URL, not a rewrite. That is how it
  keeps appearing as one as it grows.
- **Key hierarchy:** root key, then a key per tenant namespace, then a key per project. Default is unattended
  start from a key held outside the database plus an offline recovery key; cloud-KMS auto-unseal and attended
  unseal are alternatives behind the same interface. Upgrades never need an unseal.
- **Policy:** deny by default, named actions, identity-templated paths.
- **Audit:** every read is an event; values are hashed, never stored. If audit cannot record, writes and reads
  of secrets fail closed, with a bounded spool so one slow sink cannot stall the instance.
- **Values:** returned only by redeeming a single-use, short-lived handle bound to the caller's identity.
  GET is metadata only (AGENTS.md rule).
- **The value path and its gates** are `vx-keys` (envelope encryption, zeroising buffers), `vx-gate` (nothing
  value-shaped leaves toward a model, log, signal or trace) and, next, `vx-local-endpoint` (loopback pairing
  and redeem). They get fuzzing before any release. Every part stays only if it beats its measured baseline.
- **Identity:** a built-in OIDC issuer inside the same binary, with its own tables and an opaque
  issuer-plus-subject link to vault data. Nomen's protocol surface (discovery, PKCE, device flow, client
  credentials, JWKS, introspection) is the reference. No Nomen runtime is imported until section 6 is decided.
- **One API**, `/api/vx/v1`, described by an OpenAPI document that generates the server stubs, the frontend
  hooks, the CLI client and the MCP tool list, so a change is made once.

## 4. Folder structure

```text
platform/engine/
  vx/                   the new core: a Cargo workspace
    crates/vx-secret    the Secret type
    crates/vx-store     Postgres, forward-only migrations (the baseline schema grows here)
    crates/vx-jobs      the event-driven scheduler
    crates/vx-audit  vx-keys  vx-gate  vaultixd
    crates/<domain>     one crate per canonical domain as each moves (secrets, access, ...)
    api/                OpenAPI contract and generated clients (next)
  frontend/             one frontend: design system, shell, a screen per domain
  backend/              the inherited Node backend: shrinks by domain, then deleted
  backend-go/           the partial Go port: folded into vx or deleted per domain
  ops/  e2e/  docs/
```

Importer connectors (Infisical, Doppler, Vaultix) become one crate. The CLI and MCP call `/api/vx/v1` only.

`platform/shippin/` stays the only commercial folder; `backend/src/shippin` is split by domain into the
domains it belongs to or deleted.

## 5. Order of work

1. **Prove the lightness claim first, before moving anything.** A small `vaultixd` skeleton with the Postgres
   job scheduler and one domain's health route, run through `measure-idle-baseline.mjs`. Success is a number:
   idle operations, memory and outbound bytes far below the inherited core. This is also the check that the
   no-cache decision is right.
2. **Freeze the store.** Record the schema as a baseline; forward migrations only; a restore rehearsal for
   every move. Keys survive.
3. **Contract first.** Write the OpenAPI for the first domain (secrets) from 0127's decisions: stable error
   code plus message, address `{project, environment, folder, name}`, `Vaultix-Version` header, HMAC and
   ed25519 webhooks.
4. **Gateway.** Go serves `/api/vx/v1`; it proxies a domain to `legacy-node` only until that domain moves.
5. **Move one domain at a time**, in 0127's order: auth, workspace, secrets, access, then connect and
   automation, then kms, pki and pam, then detect, governance and operate. Each move includes its screens on
   the design system, CLI, MCP, tests, the deletion of the old routes and the capability-baseline update.
6. **Rust crates** during steps 3 to 5, starting with the output gate, since it protects every later domain.
7. **Delete** `legacy-node`, routes v2 to v4, `components/v2` and `v3`, and unused hooks last.

Done when each domain move passes the canonical build, the canary check (0133), the idle budgets and a
keyboard walkthrough of its screens.

## 6. Decisions only the owner can make

These are the real forks; everything else above is decided.

1. **Postgres-only jobs and no Redis.** I recommend it for lightness; it removes a dependency and the idle
   polling. Step 1 tests it. Say if Redis compatibility is a customer requirement.
2. **Which Nomen.** I assume `nomen-react-go` (Go, Zitadel-derived, a working OIDC issuer). AGENTS.md forbids
   importing Nomen runtimes and asks before mesh work, so folding Nomen in needs an explicit amendment, and a
   licence review first: its Zitadel waiver in the tree is a pasted transcription, Zitadel is AGPL upstream,
   and that could block a non-compete licence.
3. **Which Wardenclyffe.** One is an infrastructure panel (Warden and Clyffe), the other a rebrand of the
   mesh fork. Neither is mentioned in Vaultix docs. Name the one meant as "the foundation for any app".
4. **Rewrite versus strangler.** I plan the strangler above, because the encrypted store and every shipped
   behaviour must survive and each move can be proven on the image. A full rewrite in one cut cannot be.
