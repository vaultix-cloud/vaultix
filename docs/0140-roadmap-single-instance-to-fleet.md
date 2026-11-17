# 0140: From one instance to a fleet, with the single point of failure on purpose

**Status:** proposed for the owner, 2026-11-16. **Builds on:** 0134 (the foundation, seams as interfaces), 0136 (kernel,
platform, control), 0130 (program plan), 0125 (hosting), 0139 (connectors). **Reader:** the owner first; later, whoever builds
the core.

The owner's brief: identity (Nomen) and secrets (Vaultix) must work as one optimised core, built on what Infisical's users
suffer and what OpenBao does well. A startup build will have a single point of failure, so choose it, shrink it, and plan it,
so each part can later stand alone for scale while the product still behaves as one.

## 1. The decision

> **Accept unavailability. Never accept loss or leakage.**

At the startup tier one `vaultixd` and one Postgres on one machine is the product, and it can be down for minutes or hours.
It must never lose a write it acknowledged, never read or write a secret without recording it, never put a value in a log, a
backup or a trace, and always be restorable from a backup plus the offline recovery key by a person who has read one page.

The single point of failure is therefore chosen: **one Postgres and the host it runs on.** Three things are deliberately *not*
single points of failure and must never be coupled to it:

1. **The process.** `vaultixd` holds no state, so another copy can run beside it or replace it.
2. **The identity issuer.** An instance verifies tokens from a cached key set, so people and machines already signed in keep
   working while the issuer is down or being replaced.
3. **The control plane (factory).** An instance never calls it to serve a request (0130, 0125).

## 2. What the research says (checked 2026-11-16)

| Product | Finding | Source |
| --- | --- | --- |
| OpenBao | One node is active; standbys forward requests to it. Integrated Raft storage is the recommended HA default. Writes go through the active node, so write throughput does not scale with nodes. Read scaling arrived in v2.5.0. | [OpenBao HA](https://openbao.org/docs/concepts/ha/), [consistency](https://openbao.org/docs/next/concepts/consistency/), [storage](https://openbao.org/docs/configuration/storage/) |
| Infisical | Self-hosting needs Postgres and Redis (6.x or 7.x; Sentinel for HA). The Docker Compose setup and the in-cluster Kubernetes databases are explicitly "not HA"; production HA means external managed Postgres and Redis, or a native stack with HAProxy and Patroni. | [HA deployment](https://infisical.com/docs/self-hosting/deployment-options/native/high-availability), [requirements](https://infisical.com/docs/self-hosting/configuration/requirements) |

What follows from it, as design (not from those pages):

- Both treat high availability as an operations project added later. Vaultix makes it the same binary run more than once.
- Infisical has two stateful systems to protect (Postgres and Redis). Vaultix has one (Postgres), so one fewer single point of failure
  before any HA work (0134: jobs and caches in Postgres and in process).
- OpenBao's write ceiling is its single active node. Ours is the Postgres primary, which managed HA Postgres already
  protects, so the scale story is "scale Postgres the usual way, add stateless replicas", not a new consensus system.

Not researched this session, and stated from general engineering knowledge: Postgres point-in-time recovery and WAL archiving,
workload identity federation (a workload proves who it is with a token its platform issues, instead of holding a long-lived
secret), signed-checkpoint anchoring of a hash chain, expand-then-contract migrations. Each is to be verified when its phase starts.

## 3. The single-point-of-failure register

Every row has an owner-visible answer to "what happens, how do I know, how do I recover, when do I split it out". Numbers in
**Target** are goals to be set by measurement in phase 0 and 3; none has been measured yet.

| # | Fails | At the startup tier | Mitigation built in from day one | Recovery | Split out when |
| --- | --- | --- | --- | --- | --- |
| 1 | `vaultixd` process | Down until restarted | Stateless; sealed start is a defined state; readiness endpoint says why it is not ready | Restart. Target: ready in seconds | Any customer needs no downtime: run a second copy (section 5, tier 1) |
| 2 | Postgres | Everything is down | Forward-only migrations; backups with WAL for point-in-time recovery; restore rehearsal in the test suite | Restore to a new host. Target RPO of minutes, RTO of tens of minutes | Tier 1: managed HA Postgres with automatic failover |
| 3 | The host or its disk | As 2, and the key file may go with it | Root key held outside the database and kept off the data disk; offline recovery key; backups off the host | Rebuild from backup plus recovery key | Tier 1 |
| 4 | Root key lost | Data is unreadable forever | Offline recovery key at install (printed, tested at install by restoring a dummy value); the recovery drill is a test | Recovery key | Never "split"; verify the drill every release |
| 5 | Root key stolen with the database | Breach | Key custody is an interface: file with strict permissions (default), OS keyring, cloud KMS, attended unseal; the install page says plainly that same-disk custody protects against a stolen backup, not a stolen machine | Rotate the root and every wrapped key | Tier 1 default moves to KMS |
| 6 | Audit cannot record | Secret reads and writes are refused (fail closed) | Already built and tested (0136 and the connector sink) | Fix the sink | Tier 2: export stream and signed head anchors |
| 7 | Someone with database admin rewrites the audit chain | Detectable inside the chain only if they leave a prefix intact; a full rewrite is not | Periodic signed head hash written outside the database (object store or the control plane) | Compare anchor to chain | Tier 1 |
| 8 | Identity issuer down | Nobody new can sign in; existing sessions and tokens keep working until they expire | Tokens verified from cached keys with stale-if-error; a local break-glass owner account that works with the issuer down; sessions renewable only while the issuer is up, so lifetimes are short and explicit | Restart the issuer; or use break-glass | Tier 2: issuer as its own deployment, two copies |
| 9 | Issuer signing key lost or leaked | No one can sign in, or forged tokens | Keys rotate on a schedule with an overlap; the key set publishes old and new; revocation list | Rotate | Tier 2 |
| 10 | Bootstrap token (known weakness: it is full-power) | Whoever holds it owns the instance | Replace with a one-time, expiring, audited setup code that destroys itself when the first owner exists (the one credential allowed in chat, 0118) | Reissue | Phase 1 |
| 11 | Job workers | Syncs and rotations stop; reads and writes of secrets do not | Jobs are rows; a restart resumes; nothing runs twice (claim with `SKIP LOCKED`) | Restart | Tier 2: workers on their own |
| 12 | A destination (GitHub, Fly.io) is down | That sync fails and is retried; Vaultix is unaffected | Retries with backoff and the destination's own wait; per-item failures reported (0139) | Wait | Not a split; a status screen |
| 13 | Clock skew | Handle and token lifetimes go wrong | Single time source check at start; refuse to run if the database and host clocks differ by more than a bound | Fix time | Tier 1 |
| 14 | An upgrade's migration fails | Down | Rehearse every changed migration on a restored copy first (0109); expand-then-contract so N and N-1 run on one database | Roll back by restoring | Tier 1 needs it for zero-downtime |
| 15 | TLS certificate expiry | Clients refuse to connect | Expiry is an alert 30 days out and a readiness warning | Renew | Tier 1 |
| 16 | The assistant or an AI provider | Chat is down; secrets and sync are not | Assistant is a separate service with no path to values (0136) | Restart | Already separate |

## 4. Rules that keep the single point small and the parts splittable

These are constraints on every crate, checked in review and, where possible, by the boundary script.

1. **All state is in Postgres.** The only things on disk are configuration and (by choice) a key file. The process can be
   killed at any moment without losing an acknowledged write.
2. **No process-local authority.** A cache may hold derived, immutable or short-lived data and is invalidated through
   `LISTEN/NOTIFY`; the truth is always the database. A second replica must give the same answers as the first.
3. **One binary, many roles.** `vaultixd --roles api,worker,identity`. A split is a flag and a deployment change, not a rewrite.
   The API and the issuer URL stay the same, so clients see one product (0134).
4. **Every cross-domain call is a trait,** later a network client, always behind the same contract. Domains never read each other's
   tables (the boundary script already enforces that domains meet only through foundation or the server).
5. **Identity is its own domain with its own tables, keys and issuer URL,** linked to vault data only by issuer plus subject.
   Built-in accounts and a federated issuer (Nomen, or anything else) are two sources behind one interface (0074).
6. **Key custody, audit sink, event bus, storage and issuer are interfaces** with a default in-process implementation (0134).
7. **Configuration is declarative and identical across tiers.** Scaling changes numbers and the number of replicas, never the shape.
8. **A backup is one file encrypted as a whole; the live database is not.** Values are sealed in the tables, but secret names and
   audit metadata are in the clear there, so the backup file is encrypted end to end with a key derived from the root key (not
   only "ciphertext inside"). A stolen backup shows nothing without the root or recovery key; a stolen live database shows names
   and metadata but no values. The root key is never in the database.
9. **Fail closed, say why.** Readiness reports the reason (sealed, database unreachable, audit unavailable, clock skew) in a
   fixed set of codes, not text that could carry a value.
10. **A destination or the control plane never blocks a request that does not need it.**

## 5. The ladder: same product, more of it

| Tier | Who | Shape | What it removes from the single point | What changes for the customer |
| --- | --- | --- | --- | --- |
| 0 | Solo founder, small team | `vaultixd` and Postgres on one host; backups and WAL to object storage; offline recovery key | Nothing, by design; the loss risks are closed (section 1) | Nothing to operate beyond backups |
| 1 | Managed for you; teams that cannot be down | Managed HA Postgres with point-in-time recovery; two or more `vaultixd` behind a load balancer; KMS key custody; signed audit anchors | The process, the database and the host as single points | Same API, same URL, same screens |
| 2 | Growing, or a customer with a contract | Roles split: identity in its own deployment (two copies), workers separate, read replica for lists and audit browsing | The issuer as a single point; reads and background work no longer compete with writes | Same |
| 3 | Hosted fleet, per-customer instances | One instance per customer provisioned by the control plane (0125); Nomen as a shared federated issuer where a customer wants it; regional placement | Blast radius is one customer; the issuer can be shared or private | Same |

Write throughput is bounded by the Postgres primary at every tier, as OpenBao's is by its active node. The known hotspot is the
audit chain: appends to one chain are serialised by a row lock (0136). The chain is per tenant, so tiers 0 to 2 are fine; if a
single tenant's write rate ever reaches that bound, the fix is group commit (batch several events into one chain step), to be
decided from a measurement and not before.

**Triggers to move up a tier are measured, not guessed.** Phase 3 sets them with a load test: the readiness and latency
percentile the product promises, job lag, database connections and CPU, and the recovery time a customer's contract needs. Until
then the only trigger is a customer saying they cannot be down.

## 6. Identity and secrets as one system

- **Two sources, one interface.** Built-in accounts (password and passkey, MFA, recovery, sessions, machine identities) and a
  federated issuer work side by side, share tenant policy and the same store (0074). Nomen is the reference for the protocol
  surface (discovery, PKCE, device flow, client credentials, JWKS, introspection); no Nomen runtime is imported before the
  decisions in 0134 section 6 (which Nomen, and the licence review of its Zitadel-derived code).
- **Why this survives a split.** Vault data refers to a person or machine only as issuer plus subject, so replacing the built-in
  issuer with Nomen, or running it as a separate service, is a configuration change.
- **No long-lived secrets for machines.** The goal is workload identity: a CI job or a cluster proves who it is with a token its
  platform issues, and Vaultix trades it for a short-lived, scoped, single-use handle. This removes "the secret that unlocks the
  secrets" from CI systems and is the main reason to build the issuer ourselves.
- **People who are signed out of the issuer are not locked out of the vault** (register row 8) and **the vault never needs the
  issuer to verify a token** it has already seen keys for.
- **AI agents are identities too:** scoped, short-lived, holding handles and never values (0133).

## 7. The roadmap

Each phase ends with a measured exit, not a feeling. Phases overlap with 0130's design-system and frame work, which continues in
parallel and is not repeated here.

**Phase 0: a survivable single node (now).** Build what turns "one box" from a gamble into a stated risk.
- **Built:** `/readyz` with fixed reason codes (`sealed`, `database_unavailable`, `audit_unavailable`, `clock_skew`,
  `migrations_behind`), checked by a drill that causes each one and shows recovery without a restart.
- **Built:** `vaultixd backup`, `restore`, `anchor`, `check-anchor` (crate `vx-recover`). The backup is a logical, consistent
  snapshot of every `vx_` table in one encrypted file; restore goes into an empty, migrated database in one transaction,
  refuses a wrong key, a damaged file, another schema and a non-empty target, and **proves every audit chain before it
  commits**. A restore rehearsal with the real binaries rebuilds an instance from a backup and only the recovery key and reads
  the original secret back. Point-in-time recovery from WAL is not built: this is a logical backup (a restore point per
  backup), which is enough for tier 0 and is stated as such.
- **Built:** signed audit chain-head anchors, which catch an old backup swapped in (rollback) and a rewritten chain (fork).
- **Built, partly:** the failure-drill suite (section 8, with a state per row).
- **Not built:** the install page (key custody, what is and is not protected); a scheduled anchor job; streaming backups
  (a backup is held in memory, fine for a startup instance and a limit to lift before large ones); an automatic backup schedule.
- *Exit:* the whole drill suite passes; restore from backup plus recovery key on a clean host is timed and written down;
  zero acknowledged writes lost across a thousand kill-at-random-point runs.

**Phase 1: identity.** The identity domain: built-in OIDC issuer, passkeys and MFA, sessions, machine identities with short-lived
tokens, workload federation, break-glass owner, the one-time setup code replacing the bootstrap token (register 8, 9, 10). Decide
Nomen (0134 section 6) before any import.
- *Exit:* sign-in works with the issuer process stopped (cached keys); the break-glass drill passes; a stolen-token test suite
  (replay, wrong audience, expired, revoked, algorithm confusion) passes; token and key rotation drill passes.

**Phase 2: secrets complete.** Projects, environments, folders, versions with point-in-time recovery, approvals, policy
(deny by default, named actions), the v1 contract, CLI, MCP, and the screens. Connectors: `run_sync` in the server, the remembered
fingerprints (0139), real runs against GitHub and Fly.io by the owner.
- *Exit:* the capability baseline (0127) shows every Infisical capability present with proof or named as not yet; idle and load
  budgets (0132a) are met.

**Phase 3: stateless proof and zero-downtime upgrades.** Run two `vaultixd` on one Postgres under load: no job runs twice,
no handle redeems twice, the audit chain stays gap-free, a rolling upgrade (expand then contract) drops no request. Set the
tier triggers from measurement. Add the roles flag.
- *Exit:* the above, in the test suite, with numbers recorded in a doc.

**Phase 4: split for scale.** Issuer as its own deployment; workers separate; read replica; signed audit anchors; the control plane
provisions per-customer instances and runs the upgrade and restore rehearsal for each (0125).
- *Exit:* one customer instance restored from backup into a new region by the control plane, unattended, within the target.

**Phase 5: the rest of the kernel and the assistant,** in 0130's order (PKI and KMS, then PAM and scanning), with the assistant
as its own service and its egress test (0136).

## 8. Failure drills: the ratchet against regression

Every row of section 3 is turned into a test that makes the failure happen and checks the stated behaviour. They run in
`scripts/test-vx.mjs` against a disposable Postgres. A drill may be added or made stricter, never removed or loosened.

| Drill | Expected | State |
| --- | --- | --- |
| Kill `vaultixd` at a random point in a write, a sync, a redeem, a rotation (1,000 runs) | No acknowledged write lost; no value readable twice; chain verifies; no value in any log | Built for writes: 12 abrupt kills per run (more with `VX_DRILL_CYCLES`), 500 to 900 acknowledged writes each run, none lost, every one recorded, no write without its record or the reverse. **Not yet** syncs, redeems, rotations or 1,000 runs. |
| Stop Postgres, then restore it | Service refuses with a fixed readiness code, recovers without a restart | Partly: the database vanishing under a running server gives `database_unavailable`. Recovery after a restart of Postgres is not yet tested. |
| Pause the database mid-transaction | The action did not happen and was not recorded; or both happened | Partly: the kill drill and the audit crate's rollback test cover "both or neither"; a paused connection is not. |
| Restore from backup into a fresh database with only the recovery key | The instance opens, the chain verifies, a known secret reads | **Built** (real binaries, value read back, handle works once). |
| Restore an **old** backup over a newer instance | Detected by the audit anchor (rollback attack) | **Built** (anchor: rollback, and fork when the restored copy has since diverged). |
| Wrong root key; corrupted backup; truncated WAL | Refuses with a code; nothing partial | **Built** for key, flipped bit, truncation, garbage and a forged manifest. WAL does not apply to a logical backup. |
| Disk full | Writes refused (fail closed), reads of metadata keep working, recovery without data loss | Not built. |
| Clock skew beyond the bound | Refuses to start; handles and tokens are not issued | Partly: `/readyz` reports `clock_skew`. Refusing to start and refusing to issue tokens are not built (no tokens yet). |
| Issuer stopped | Existing tokens verify; break-glass works; new sign-in fails with a clear code | Not built (no identity domain). |
| Signing key rotated | Old tokens verify until expiry; new ones use the new key; revoked ones are refused | Not built (no identity domain). |
| Two replicas, one job queue | No job runs twice | Not built. |
| Audit sink refuses | Secret reads and writes are refused | **Built**: writes are refused and leave nothing behind, and `/readyz` says why. |
| A destination down for an hour | Syncs fail and retry; reads and writes unaffected; the report says which | Partly: GitHub and Fly.io tests retry and report; an hour-long outage is not simulated. |

**Running them.** `node scripts/test-vx.mjs` runs the whole kernel against a disposable Postgres, drills included (the drill file
is `kernel/server/tests/drills.rs`; the backup and anchor drills are `kernel/foundation/recover/tests/recover.rs`). A plain
`cargo test` skips every database test and still reports success, so it proves nothing about them. To check that the drills
themselves can fail, `node scripts/with-test-postgres.mjs -- sh scripts/mutation-recover.sh` and
`node scripts/with-test-postgres.mjs -- node scripts/mutation-drills.mjs` plant one bug at a time and show which test catches
it; each confirms the bug really changed the file, and the second restores the source even if an earlier run was killed.
The kill drill is probabilistic by nature (a bug that opens a window of microseconds is caught only if a kill lands in it), so
`VX_DRILL_CYCLES` raises the number of kills and the count of writes it must account for.

## 9. What this accepts, and what it does not

**Accepted at the startup tier:** minutes to hours of downtime on a host or database failure; a manual failover; maintenance
windows; a single Postgres.

**Not accepted at any tier:** a lost acknowledged write; a read or write without an audit record; a value in a log, trace, backup
or error; an unrecoverable instance when the recovery key exists; silent corruption; a long-lived credential where a short-lived
one is possible.

**Residual risks to state to customers, not hide:** same-disk key custody protects against a stolen backup but not a stolen
machine; an administrator with database access can alter data between audit anchors; a lost recovery key with a lost root key is
permanent data loss by design.

## 10. Open for the owner

1. **Default key custody at tier 0:** a file kept off the data disk (my recommendation, with a loud note), or an OS keyring, or
   attended unseal.
2. **At the managed tier, who runs Postgres:** a managed cloud Postgres (recommended: it is the part not worth running yourself),
   or AngryVibes' own HA (Patroni-style), which costs an on-call practice.
3. **Active-active or active-standby at tier 1:** stateless replicas make active-active possible; the audit chain's row lock is the
   one place they contend. Recommend active-active, measured in phase 3.
4. **The promises per tier** (recovery time and data-loss window) that marketing and contracts may state. They must come from the
   phase 0 and phase 3 measurements, not from this document.
5. **Which Nomen** and the licence review (0134 section 6), before phase 1 imports anything.
6. **Whether tier 3 shares one Nomen across customers** or gives each customer its own issuer.
