# 0147: The execution path to an owned Vaultix

**Current execution order, 2026-11-21. Next packet: P1.** Written against main
`6cbc8e765c3406d346680ec3b95d94ecadb684ef`, following the owner's request to extend
the absorbed work into a complete path with reusable patterns.

This is the scheduling authority for the remaining rewrite. It continues
[0146](0146-minimal-independent-build.md) and supersedes the work order and dated
status in [0141](0141-owned-rewrite-path.md), [0130](0130-vaultix-program-plan.md)
and earlier execution queues. Their capability, recovery and product obligations
remain. Architecture is [0136](0136-kernel-platform-control-and-schemas.md);
delivery and landing remain [0142](0142-delivery-standard.md) and
[0145](0145-absorb-and-alerts.md). This document specifies future work; only P0
below is verified today. It does not declare the application independently shipped.

## 1. Finish lines and the shortest useful path

**Extend the working kernel -> complete a signed-in secret workflow -> establish
scope and policy -> complete secrets and the owned UI -> switch fresh delivery ->
move existing instances safely -> replace the remaining capabilities -> delete
the inherited application.** Each packet leaves working behavior and a pattern
that the next packet uses. Do not restart the foundation or move copied code into
new folders and call that authorship.

| Milestone | What a person can actually do | Exit condition |
| --- | --- | --- |
| **A. Independent usable instance** | Install a fresh instance, create the owner, sign in, manage a project/environment, store and update secrets, use them through a human-approved application from CLI/MCP, use the owned browser workflow, revoke access and restore an encrypted backup. | P1-P6 pass from the independent artifact. Fresh installation defaults to it. Its runtime, UI and build inputs contain no inherited application. Explicitly scoped alpha; advanced domains remain in the queue. |
| **B. Existing-instance cutover** | Bring the existing accounts, keys, encrypted secrets and supported workflows to that instance without losing data or access. | P7 rehearses on a restored copy and proves the instance's required capabilities. Unsupported objects are reported and block that instance's cutover until their extension packets pass. No silent partial migration. |
| **C. Complete retirement** | Use every retained product capability through Vaultix's own implementation, clients and delivery. | E1-E9 and R1 pass; every capability has replacement and migration evidence; the inherited application is removed from the active source/build/runtime graph. |

Milestone A must not wait for every PKI, PAM or hosted-fleet capability. Milestone
C must not disappear just because A works. An instance needing an unfinished
capability stays on its existing runtime until that capability is ready; the
minimum release does not withdraw it. Existing stores are never overwritten to
make the new installer simpler.

The first usable increment is **P1 itself**: the independent image serves the
complete human CLI workflow. Keep that usable as P2-P5 extend it. P6 is the
default packaged browser/CLI/MCP installation, not the first point at which any
of the new work may be used. New fleet/hosting expansion follows separately and
does not delay removal of inherited application code.

The technical means of separation is independently authored implementation and
removal of inherited application inputs from delivery. Keep third-party notices
and provenance. Do not add license keys, tiers, checks or license files. Neither
a changed filename nor a source hash proves licensing clearance; this plan makes
no such claim and does not block technical work on choosing the product license.

## 2. Starting point: reuse what is already built

| Existing owner | Reuse | Concrete missing boundary |
| --- | --- | --- |
| `kernel/foundation/{secret,store,keys,audit,jobs,gate,contract,recover}` | Secret value type, persistence, cryptography, audit, jobs, contracts and encrypted recovery. | Wire these into complete domain workflows; do not create separate audit logs, queues or value types per domain. |
| `kernel/domains/auth/core` and `kernel/server` | First-owner setup, password login, expiring sessions, logout, grants and audited changes. | Full membership/resource ownership, recovery/MFA, federated and machine lifecycle. Current grants use project/environment strings; they are not the final tenant model. |
| `kernel/domains/secrets/core` | Encrypted write, metadata, value requests and session-bound one-use injection. | Complete resource lifecycle, concurrency, history/restore, imports, references and all required policy behavior. |
| `kernel/clients/cli` | Real `vx` and `vx-mcp`, API client, approved-profile execution and output controls. | `vx session` currently supports only `list` and `logout`. Separate `set` needs externally supplied authentication. Human session write/use and finished MCP sign-in are missing. |
| `kernel/domains/connectors/{core,github,flyio}` | Existing connector framework and adapters; extend [0139](0139-connector-framework.md). | Authorized product configuration and job flows, remaining providers, drift/retry behavior and provider-specific live acceptance. Fixtures do not prove a live integration. |
| `kernel/contracts/v1` and `kernel/contracts/documents` | Rust/OpenAPI/generated ArkType contract and existing feature/receipt schemas. | First real feature manifest, dispatch and coverage enforcement. Do not invent another manifest format. |
| `kernel/Dockerfile.standalone-vaultix`, `scripts/build-kernel.mjs` | Isolated build context and real container auth/secrets/recovery proof. | Default installer, UI, complete human/AI journeys and existing-store cutover. The regular inherited delivery path has not switched. |

P0 is **verified and absorbed** at the commit above: full gate 25/25 configured
checks passed; the kernel image passed ten recorded container checks, including
wrong-session/replayed redemption, logout and encrypted restore. Local receipts:
`.gate/receipts/6cbc8e765c3406d346680ec3b95d94ecadb684ef.full.json` and
`.cache/kernel-landing-proof/kernel-build-rcSpMs.json`. These are prior evidence,
not a claim that this documentation change reran those workflows.

Seven gate gaps remain recorded in `scripts/gate/checks.mjs`. No kernel web app
or feature manifest exists at this baseline. No complete enterprise parity,
live-provider acceptance or existing-instance cutover is established.

## 3. Patterns every subsequent packet must extend

Introduce a pattern in a working use case. Reuse it in the next real consumer
before generalizing it further. A new abstraction, generated inventory or renamed
module alone does not complete a packet.

| Pattern | First packet and canonical owner | Required use by later packets |
| --- | --- | --- |
| **One domain action** | P1; domain `core`, server assembly and shared client library. | UI, CLI, MCP and jobs call the same authorized action. Typed inputs/results; plain `error` on expected API failures. No alternate model API or UI-only permission check. |
| **Scope and live authority** | P2; workspace/access domain contracts assembled with auth in the server. | Organization -> project -> environment -> folder ownership uses stable IDs and validated relationships. Policy is enforced at the mutation/value boundary, including revocation and concurrent changes. Names are labels, not tenant authority. |
| **One wire contract** | Extend existing `foundation/contract`, server OpenAPI and `contracts/v1` in every packet. | Rust -> OpenAPI -> generated ArkType; reject unknown input as specified, validate pagination and versions. Change every caller together; delete replaced routes. `/api/vx/v1` only; no compatibility aliases. |
| **Values have one controlled path** | P1; `foundation/secret`, shared trusted runner and existing inject/redeem. | Metadata GETs never carry values. Human value entry and trusted target injection only. AI sees references and outcomes, never values, bearer credentials or redeem handles. Approved profiles cannot accept model-chosen commands/arguments; safe output remains the default. |
| **State, audit and durable work** | Reuse existing store/audit/jobs in P1; first extended consumer P3, then E2-E4. | State and required audit/outbox records commit together. Retry/idempotency, cancellation and dead-job outcomes are explicit. Jobs carry references, not secret payloads. No domain-specific queue or silent background failure. |
| **Plan, apply and conflict** | P3; secrets owns its plan and revision semantics. Shared mechanics belong in foundation only when reused. | Bulk changes, restore, imports and approvals preview a masked, authorized plan; apply checks expected state and current policy. Stale/replayed plans fail safely. No universal framework before the first working operation. |
| **Owned interaction** | P4; client shell and domain UI, [0131](0131-phase-2-frame-plan.md), [0135](0135-process-review-and-redesign.md), [0142](0142-delivery-standard.md). | Native HTML, Vaultix tokens, stories, keyboard specification and accessibility checks. Consistent loading/empty/denied/error/conflict states. UI projects server authority; Clyffy is an overlay, not a replacement viewport. |
| **Migration and recovery** | P2 forward migrations; P6/P7 install/cutover. | Explicit schema ownership, restored-copy rehearsal, encryption/key continuity, measured recovery and an executable rollback boundary. No dual writers or discarded account/secret history. |
| **Whole-flow delivery** | P1; existing feature schema and `scripts/gate/`. | A scoped capability names source owners, real consumer flow and a planted failure that the flow catches. Later packets extend coverage and parity mappings. A schema pass, inherited test or source count cannot stand in for behavior. |

Layering is unchanged: foundation has no domain dependencies; domains depend on
their own context and foundation, not another domain's private tables or crates;
server/clients assemble them. Cross-domain work uses explicit contracts and
injected interfaces. Commercial hosting remains in `platform/shippin`; the kernel
cannot depend on it. The assistant is a separate service with per-space settings.

## 4. Ordered packets to independent use and safe cutover

All packets below are **planned**, except **P1, ready to implement**, and P0 above.
Dependencies are prerequisites for completion. Work is a single ordered product
queue; independent preparation can proceed without creating a parallel rewrite.

### P1. Finish the signed-in human secret workflow — next

**Depends on P0. Outcome:** a person signs in once, writes a hidden secret, lists
metadata, updates it, uses an approved profile and signs out, all in the same
owned session. The target receives the value; terminal transcripts and AI do not.

Extend `kernel/clients/cli/src/bin/vx.rs`. Extract the profile parser/executor and
safe result handling from `src/bin/vx_mcp.rs` into the same client library, then
make both binaries use it. Preserve command restrictions, timeout, output limits,
value handling and failure cleanup. Use the existing `Client` and domain actions;
do not introduce a token-file workaround as the finished sign-in experience.

Deliver the first narrowly named feature, **signed-in-secret-use**, with its
manifest, actual CLI/process flow and mutation checks. Its scope is this whole
workflow, not all auth or all secrets. Complete feature dispatch and enforce
ownership for the newly declared scope; report the remaining unowned surface.
Wire the answer-edit guard from 0142 to that scope before treating its receipt as
feature acceptance. Do not mark the entire feature-flow gap closed prematurely.

**Proof:** real `vx` -> real server -> real database -> target process. Setup/login,
create/update/list/use, denied scope, expired/revoked session, wrong-session and
replayed redemption, failing/timed-out target, and a canary absent from CLI/MCP
results/logs. Plant authorization/revocation and output-boundary failures; the
flow must catch them. Reuse current encrypted restore proof. **Retirement:**
remove duplicated profile execution after both callers use the shared code.
No inherited domain is claimed retired yet. MCP pairing remains P5.

### P2. Give accounts, resources and permissions one ownership model

**Depends on P1.** Build workspace/project/environment/folder lifecycle and
membership in Rust domains, with access policy contracts assembled with auth.
Migrate current string-based grants and addresses to stable scoped IDs through
forward store migrations. Preserve existing kernel accounts, keys and secrets;
update every API/client caller together. Extend the existing store, not a second
secret database. Reconcile the capability catalog's stale target-path metadata
for these packets without dropping capability IDs.

**Proof:** two tenants with identical project names; cross-tenant IDs and folder
escape denied; membership/grant revocation effective during concurrent work;
direct action entry cannot bypass authority; restart and forward migration keep
access and ciphertext usable. **Pattern:** scope and live authority. **Retirement:**
remove superseded kernel string-grant code after its data migration; inherited
workspace/auth paths remain until the instance cutover gate.

### P3. Complete the everyday secrets lifecycle

**Depends on P2.** Extend secrets with version checks, pagination, delete/restore,
history, folders, references with cycle detection, bulk changes and file import.
Define and prove the exact baseline workflows in the feature manifest; remaining
approval, rotation and provider capabilities stay explicitly mapped to E2-E4.
Implement masked plan/apply and conflict outcomes. Update API, CLI and MCP
metadata actions together. A restore creates an auditable new state; it must not
silently overwrite a concurrent edit. Values still leave only through injection.

**Proof:** concurrent edits, stale restore/import plans, invalid/cyclic references,
partial failures, rollback, denied paths, version/history recovery and canary
checks. **Pattern:** plan/apply, versioning and transactional outcomes.
**Retirement:** retire superseded kernel endpoints/callers; inventory the exact
inherited secrets routes/jobs that P7 and R1 will remove, with replacement IDs.

### P4. Build the owned browser workflow on those actions

**Depends on P2; completes with P3.** Use the Svelte direction recorded in 0142.
Create the owned client shell and complete setup/login, project/environment and
secret workflows. First establish only the primitives those screens need, with
Storybook, tokens, keyboard specifications and accessibility tests; expand through
real screens. Preserve the public landing -> login -> authenticated application
entry. API-derived forms and events use the same contracts/actions as P1-P3.

**Layout prerequisite:** `kernel/Cargo.toml` currently globs `clients/*` and
`domains/*/*`. Before adding a non-Rust `kernel/clients/web` or domain `web`
directory, make Rust workspace membership explicit and update/test the boundary
checker. Otherwise Cargo treats the UI directory as a missing Rust crate.
Keep shell composition in the client and workflow ownership in its domain.

**Proof:** real packaged UI and server; first-owner and returning-user journeys;
keyboard/focus, screen-reader semantics, reflow, denied/loading/error/conflict
states; no values in URLs, browser storage or telemetry. **Pattern:** reusable
interaction and browser-flow delivery. **Retirement:** each replacement screen
gets an explicit caller/route switch record; inherited components are not used
as the new viewport. Do not remove a route before its replacement is usable.

### P5. Finish access for people, AI clients and workloads

**Depends on P2/P4; reuse P1's runner.** Complete built-in recovery, MFA and method
policy, session listing/revocation/renewal, and human-approved CLI/MCP connection.
Reuse applicable owned root CLI sign-in work after source/contract review;
integrate it with kernel sessions rather than maintain a second authority.
Keep credentials in the native credential boundary, outside model-readable tool
payloads/configuration. Bind machine access and approved execution to explicit
scope and revocable identity. Nomen and other issuers remain optional E1 work;
built-in identity must function by itself.

**Proof:** real human approval to real MCP/CLI secret use, without bearer copying;
expired/denied/cancelled pairing, wrong device/instance, refresh replay, revoked
identity, recovery and MFA policy, process restart and credential isolation.
Record fixture and actual AI-client evidence separately. **Pattern:** one session
provenance and credential broker. **Retirement:** replace old CLI auth/MCP callers
once their required workflows pass; remove superseded endpoints in the same change.

### P6. Make the independent artifact the fresh-install product — milestone A

**Depends on P3-P5.** Extend `scripts/build-kernel.mjs` and the standalone recipe
to package the owned browser and clients. Update the default build, Compose,
installer, `vaultix server` lifecycle consumers and operator documentation in one
cutover. Reuse reviewed owned lifecycle code; no proxy to inherited business
logic. Preserve instance keys and dependency identities. Make fresh-install and
adoption/upgrade paths explicit: a populated inherited store enters P7, never an
automatic destructive conversion.

Add usable backup scheduling, restore/recovery operation and visible failure
status using existing foundations. Trace the release source and dependency
closure, including assets, fonts, generated output and auxiliary processes.
Verify configured network destinations and remove inherited telemetry/update
calls from this delivery path. Keep ordinary dependency notices.

**Proof:** build `Dockerfile.standalone-vaultix` through the canonical default;
install from empty state; real browser/CLI/MCP flows; restart, DB outage, failed
backup, wrong-key restore, successful encrypted restore, upgrade rehearsal and
recovery. Inspect the resulting artifact/processes for inherited application
inputs, not just its package name. **Retirement:** inherited runtime/UI is absent
from fresh delivery. Gate the default image and frontend; retaining the old
source for unfinished capabilities is not permission to ship it in this artifact.

### P7. Import and switch an existing instance — milestone B, per instance

**Depends on P6 and every extension capability that the instance uses.** First
inventory accounts, identity methods, memberships, keys, secrets/history and
every other object family. Map each to an owned handler, verified conversion or
explicit blocker. External Infisical/Doppler connectors speak their source APIs;
they do not restore those routes inside Vaultix. Follow [0127](0127-one-api-infisical-as-a-source.md).

Restore an encrypted backup into isolation; migrate there; compare object counts,
relationships, authorization and decryptability without logging plaintext. Prove
real sign-in and target injection. Preserve account identity if a credential
format requires explicit reenrollment; do not silently reset or discard it.
Keep unsupported objects in the preserved source/backup and block cutover for
their workflows. A skipped-object report cannot establish parity.

Fence writes for final migration, record the checkpoint and activate one writer.
Rehearse both rollback before new writes and recovery after new writes. After
the new store accepts writes, starting the old image is not a safe rollback:
reconcile/replay the new writes or restore under a rehearsed, explicit loss bound.
**Pattern:** exhaustive import and reversible ownership transfer. **Retirement:**
disable the old instance's workers/routes/writer only after the accepted switch;
retain encrypted recovery artifacts under the existing retention policy.

## 5. Extension queue: full capability ownership

These packets extend the patterns above. They are required for complete retirement,
not prerequisites for every fresh minimal instance. Execute in the order below
after P6; run P7 for an instance when its required rows are ready. Each row must
be split into whole, dependency-ordered workflows at intake, using the capability
catalog and source map. A row cannot be marked complete by implementing one example.

| Packet / dependencies | Complete workflow families and implementation owner | Reuse and required proof | Removal unlocked |
| --- | --- | --- | --- |
| **E1 Access and federation** — P2/P5 | Auth, workspace and access: full organization/member/group/role lifecycle, invitations, OIDC/SAML/LDAP/SCIM and all retained machine identity methods, method/session policy. External Nomen integration only. | Scope, session provenance and one action; provider lifecycle and negative acceptance, cross-tenant mapping, issuer failure, disable/revoke and recovery. Built-in remains usable. | Inherited identity, org, permission and directory-sync implementations after callers/data switch. |
| **E2 Governance** — P3/E1 | Access and governance: approvals, quorum/separation of duties, policy changes, exceptional access, audit retention/search/export and notifications. | Plan/apply + transactional audit/outbox. Self-approval, stale approval, revocation during apply, expiry and delivery retry; no background bypass of policy. | Old approval engines, audit pipelines and notification workers. |
| **E3 Connectors and imports** — P3/E1/E2 | Connect domain, extending existing connector crates: connection credentials by reference, provider configuration, destination mapping, sync/import, full provider inventory. | Shared adapter/job contracts, fingerprint/no-op behavior, destination drift, retries, revocation and rate limits. Each provider has mapped capabilities and provider-specific acceptance; fixtures and live receipts distinguished. | Inherited connection/provider implementations and source-import services, one complete adapter workflow at a time. |
| **E4 Automation** — E2/E3 | Automation: rotation schedules, dynamic credentials, leases/revocation, workflows, webhook delivery and integrations that consume these. | Existing jobs/outbox, stable operation IDs, idempotency, cancellation. Crash between external change and local commit, duplicate delivery, expiry, rollback and revoked credentials must be exercised. | Inherited queues, pollers, rotation/dynamic-secret workers and webhook engines. |
| **E5 Assistant and guided actions** — P4/P5/E2 | AI and experience: separate assistant service, per-space provider/persona documents, guided learning, domain UI events and catalog-backed MCP actions. | Existing versioned documents, server authority, UI event contract and approved execution. Cross-space isolation, unsupported provider, cancelled action and canary tests; no values/handles or subscription credentials in AI. | Legacy assistant/service/UI paths and duplicated model APIs. |
| **E6 KMS and PKI** — E1/E2/E4 | KMS: keys, versions, policy, external KMS/HSM/KMIP workflows. PKI: CA/certificate requests, issue, import, renew, revoke and trust lifecycle, according to capability inventory. | Scope, audit, jobs and approval patterns. Key continuity, rotation/restore, failed external signer, revocation and compromised/expired material; protocol/provider acceptance separately. | Inherited KMS, HSM/KMIP, CA and certificate implementations. No PKI scope cut is assumed. |
| **E7 Privileged access** — E1/E2/E4, E6 where certificates are used | PAM: gateway/target access, leased credentials, sessions, recordings and required protocols. | Shared authority/leases/audit; denial, expiry and mid-session revocation, gateway failure, recording access and recovery. No imported Nomen/Zuul/Willandra runtime. | Inherited PAM proxy, session and recording paths. |
| **E8 Detection** — E2/E3/E4 | Detect: sources, scans, findings, triage and remediation workflows. | Shared jobs/connectors/policy. Finding fingerprints and redacted evidence; no matched secret values in AI/logs; failed/duplicate scans and tenant isolation. | Inherited scanning workers, findings APIs and screens. |
| **E9 Complete operation and experience** — P6 and E1-E8 as applicable | Operate/public/experience: remaining administration, public experience and all UI parity; existing hosted lifecycle capabilities that still depend on inherited application code. | Existing lifecycle and UI patterns; real administration, recovery and every retained screen/action. Independently replace any retained legacy hosting dependency; new fleet expansion is F1 below. | Remaining inherited admin/public/UI services and dependent hosted legacy paths after replacement proof. |

Mesh is a separate, explicitly authorized packet after Auth and Secrets, under
the existing router. This plan does not begin mesh work or require it to ship A.
Hosted/fleet release is also a separate acceptance gate; a single independent
instance does not establish public-cloud readiness.

**F1, subsequent platform expansion:** after the relevant kernel workflows pass,
extend `platform/shippin` and the separately owned private control plane for
managed and tailored-hosted provisioning, upgrades, backups and capacity. Follow
[0140](0140-roadmap-single-instance-to-fleet.md) for one-node failure/recovery,
multiple instances and measured fleet growth, and [0054](0054-public-cloud-service.md)
for enrollment, isolation, durability and availability gates. Keep billing in the
hosting boundary without software feature paywalls. This work has its own release
proof and does not hold A or C hostage to building future scale. Private control
and mesh runtime work require their own authorized checkout/task.

Coverage cross-check against `docs/lexicon.json`: **public** P4/E9; **auth**
P1/P5/E1; **workspace** P2/E1; **secrets** P1/P3; **access** P2/P5/E1/E2;
**automation** E4; **connect** E3; **pki** E6; **kms** E6; **pam** E7;
**detect** E8; **ai** E5; **governance** E2; **operate** P6/P7/E9;
**experience** P4/E5/E9. These are domain assignments, not substitute capability
IDs. The capability catalog and source audit remain the completeness inventory.

### R1. Remove the inherited application — milestone C

**Depends on P7 coverage for retained migration paths and all E1-E9 obligations.**
For every catalog capability and inherited module, record the owned implementation,
all callers/workers, data transition, real acceptance flow and deletion commit.
Review modified inherited code as well as byte-identical imports. Move any
already-authored code still in the legacy tree to its correct owner with proof;
do not discard it or rebrand copied implementations as new source.

Remove `platform/engine` application code when its obligations are discharged,
then remaining root database overlays, legacy clients/panels, assets/fonts,
dependency kits, build/Compose/install paths and stale routes that reference it.
Delete old callers and generated outputs in the same retirement changes. Keep
historical records and third-party notices that still apply. Do not grow
`leftover/` or hide application code there to make a count fall.

**Final proof:** no active application import, workspace dependency, runtime
process or build input needs the inherited tree; fresh install and migrated
instance pass the canonical image journeys; retained capabilities have complete
flow and migration evidence; Zod/inherited primitive dependencies leave with
their retired code; authorship review and source closure cover modified files.
A green lineage ceiling alone is insufficient. Lower baselines only to record
proved replacements/removals, never to conceal lost capabilities.

## 6. The delivery contract for every packet

Before writing code, append the packet's concrete workflow to this plan or its
linked domain spec. Use this record, keeping it small enough to review:

1. **Outcome and scope:** actor, starting state, successful result, catalog IDs;
   list adjacent capabilities still outstanding.
2. **Owners and reuse:** domain files, shared pattern already used, interface
   being extended, every UI/CLI/MCP/job consumer affected. Justify a new pattern.
3. **State and authority:** schema migration, key/secret continuity, permission
   boundary, audit transaction, job/idempotency/recovery behavior.
4. **Proof:** real success flow, denial, failure/recovery, concurrent/replayed
   cases, planted failures, accessibility/provider evidence when applicable.
5. **Switch and deletion:** exact old callers/routes/workers/build inputs, switch
   condition, rollback procedure and deletion target. Early foundation packets
   may explicitly unlock later deletion; they cannot claim it already happened.
6. **Receipt and next packet:** commit, artifact digest, checks and remaining
   gaps. Run the fast gate before push and full gate before main; absorb and
   remove the branch/worktree through 0145. Then advance to the next ready packet.

Track status as **planned -> ready -> implemented -> verified -> switched ->
retired**, using only stages applicable to that packet. Code written is not
verified; a passing candidate is not a default cutover; a cutover is not source
retirement. Keep one active product packet. If an external-provider credential
blocks its live proof, record that exact limit and continue other ready work;
never replace the missing receipt with a fixture pass.

Close existing gate gaps with their owning work: feature flows/answer-edit guard
in P1; frontend in P4; default standalone image in P6; audit and owned-tree checks
with each domain retirement and R1. Run retained script tests when their consumers
move, then gate them or remove them with the retired feature. Resolve formatting
as a bounded kernel convention, without using a formatting campaign as the next
product milestone. The notification sender follows a configured mail service;
local durable failure records remain mandatory without it.

## 7. P1 implementation handoff

**Start here; no new architecture proposal is needed.** Read the complete client
modules and auth/secrets server paths, then implement this bounded packet:

| Change | Exact owner |
| --- | --- |
| Session-backed hidden write/update and approved-profile use | `kernel/clients/cli/src/bin/vx.rs` |
| Shared profile parsing, execution and output policy; both clients consume it | `kernel/clients/cli/src/lib.rs`, new module under that crate, `src/bin/vx_mcp.rs` |
| Real CLI/session/value-use journey and failure assertions | Extend `kernel/server/tests/auth.rs` and existing client tests; register any new integration file |
| First feature manifest and actual flow/mutation dispatch, scoped ownership and answer-edit enforcement | Existing `kernel/contracts/documents/src/feature.v1.ts` contract; new manifest under `features/`; `scripts/gate/` |
| Packaged journey includes the real signed-in client and target | Extend `scripts/lib/kernel-image-proof.mjs` |
| Current instructions and capability evidence | `kernel/README.md`, this packet's status and the applicable capability/source records |

Use `node scripts/gate.mjs --list` to resolve current check IDs. During development
run the affected client/server/contract/feature checks through `--only`; before
landing, `node scripts/gate.mjs --full` must include the real container journey
and the new feature's flows/mutations. A passing `kernel-server-tests` command
alone does not prove the CLI executor or MCP output boundary. Inspect the flow's
assertions and planted failures before declaring the feature verified.

P1 ends with a person successfully doing the entire declared workflow, the same
runner shared by both clients, an accepted feature receipt and one absorbed
change. **P2 is next.** No additional inventory-only phase sits between them.
