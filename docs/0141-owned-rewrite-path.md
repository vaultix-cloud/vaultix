# 0141: Break from upstream, absorb the lessons, own the workflows

**Continued by [0147](0147-execution-path.md), 2026-11-21.** Use it for current
code status, the ready next packet and the full pattern-based execution order.
This proposal remains the record of the earlier findings and obligations.

**Status:** execution proposal, 2026-11-16, responding to the owner's request for a clear path.
**Authority:** [0136](0136-kernel-platform-control-and-schemas.md) sets the Rust kernel architecture;
[0130](0130-vaultix-program-plan.md) retains the product capability obligations.
This document organizes that work. It does not approve capability cuts, change licensing, or claim a cutover.

## 1. The path and the two finish lines

**Freeze inherited development → understand a workflow → write Vaultix's behavior → prove it → switch its
callers and data ownership → delete its inherited implementation.** Repeat in Auth → Secrets order.
Mesh requires separate permission. Hosting and fleet expansion do not have to be finished to own a workflow.

There are two distinct finish lines:

1. **Independent first workflow:** a person can set up an instance, sign in, create a project/environment,
   store a secret and use it in an authorized application through the owned UI/CLI/MCP surfaces. This runs
   from the packaged Rust kernel without an inherited Node/Go process, route, permission evaluator or job
   worker serving that workflow. Restore and denial cases work too. It is a scoped alpha, not full parity.
2. **Complete inherited-engine retirement:** every capability obligation has an accepted replacement and
   import/migration evidence, all callers and workers have moved, and the inherited engine is absent from
   the shipped artifact and build graph. An unsupported entry is honest reporting, but it cannot close a
   parity requirement. Any change to product scope needs an explicit owner decision.

Start writing owned code now under the existing freeze. Do not wait for a whole-tree rewrite or confuse
removing the old code with understanding it. Preserve Git history and third-party provenance. Renaming a
fork, changing remotes, reinitializing Git, and erasing notices establish neither technical independence
nor new authorship. No such operations are part of this plan.

## 2. What is actually separated today

| Boundary | Evidence read for this plan | Remaining work |
| --- | --- | --- |
| Upstream contact | [0015](0015-frozen-no-connection.md) forbids fetching, cloning and contacting frozen snapshot hosts. | Keep this rule; no upstream synchronization is needed to start. Runtime egress still needs measurement at cutover. |
| New implementation | [Kernel layout](../kernel/README.md) and 0136 define the Rust foundation, secrets slice, clients and generated contract. | Identity, policy, full workflows and the web UI remain incomplete. Documentation contains stale status paragraphs; do not infer test results from them. |
| Shipped runtime | [Standalone Dockerfile](../platform/engine/Dockerfile.standalone-vaultix) builds the inherited frontend, Node backend and Go sidecars. | A working kernel beside this image is not a runtime break. Package and exercise the owned workflow without these services. |
| Data continuity | Existing lifecycle rules require preservation of accounts, keys and secrets. | A kernel backup drill does not prove migration from the inherited database. Prove that separately on a restored copy. |
| Ownership | [0021](0021-product-authorship-review.md) requires full source review and deliberate decisions. | Inventory, generated code and inherited passing tests cannot stand in for review. |

These are source observations, not a fresh runtime audit. Existing edits to the kernel and
[0140](0140-roadmap-single-instance-to-fleet.md) were already in progress and are not accepted or changed
by this planning packet.

## 3. Resolve the old directions once

- **Rust in `kernel/` is the target.** Older React/Go migration instructions and 0135's Go evaluator
  proposal are historical inputs, superseded by 0136. Correct callers and documents as their workflow moves.
- **`platform/engine/` shrinks.** No new product features there. 0135's proposed inherited-engine quick wins
  are not a second feature backlog; carry their lessons into the owned implementations.
- **One API:** `/api/vx/v1`. Update every caller in the same cutover; delete replaced routes without aliases.
  Keep the underlying capability and stored-data migration obligation. A proxy is a temporary dependency,
  never an accepted rewritten domain.
- **One owner per mutation and job.** Rehearse on copies; do not run two schedulers or writers against the
  same live domain during a switch.
- **Identity remains built-in plus optional federation.** No imported Nomen runtime, compulsory external
  issuer or email-based implicit identity linking. Provider-specific acceptance remains a separate gate.
- **Design before screens.** Native HTML, Vaultix tokens/primitives, Storybook, keyboard specifications and
  accessibility evidence. No inherited component becomes the new design simply because it is available.
- **No scope loss by cleanup.** PKI, PAM, LDAP, machine methods and other proposed deferrals in 0135 are
  unresolved scope decisions, not permission to delete capability obligations. No new licence or tier checks.

## 4. Ordered execution packets

Each packet has one implementer accountable for the whole workflow and a recorded acceptance review.
Assign the implementer when starting the packet; this table does not assert anyone has accepted an assignment.

| Order / packet | Concrete output | Exit evidence |
| --- | --- | --- |
| 0 / OWN-00: establish the baseline | Record candidate commit and dirty-state exclusions; list shipped services, routes, data owners, workers and outbound destinations. Reconcile active entry docs with 0136. Select the first Auth workflow and its complaints. | A source-to-runtime map, capability rows and exact source hashes. Record unknowns rather than inventing counts. No upstream access. |
| 1 / OWN-01: owner setup and sign-in | Auth design and first full slice: one-time first-owner setup, built-in sign-in/session/logout, tenant membership and deny-by-default authorization for the first secrets actions. Replace full-power bootstrap use for this workflow. UI states and generated contract ship with it. | Setup replay/race denial; invalid and revoked sessions; cross-tenant denial; restart persistence; real UI and CLI sign-in on the candidate artifact. Built-in sign-in works without an external issuer. |
| 2 / OWN-02: complete the identity dependency | MFA/recovery, session management, machine identity/pairing, roles/groups and federation workflows required by the preserved capability map. Explicit actor and session provenance. | Account migration or explicit safe re-enrollment; recovery and revocation; wrong issuer/audience/subject denial; real configured-provider proof before enabling each federation integration. Fixtures remain labeled. |
| 3 / OWN-03: workspace and secrets journey | Organizations/projects, environments/folders, create/edit/list, versions, references, policy/approvals and target-only inject/redeem, with owned UI/CLI/MCP consumers. Reuse reviewed kernel foundations where correct. | A person and a machine each complete their authorized journey; GET returns metadata only; no canary reaches models/logs/errors; replay, conflict, stale approval and cross-tenant cases fail; audit failure blocks the action. |
| 4 / OWN-04: independent workflow cutover | Package the first Auth → Secrets workflow, migrate a restored inherited instance, switch all of that workflow's consumers, and remove its inherited route/worker ownership. | Run with inherited services unavailable and no proxy fallback. Build `Dockerfile.standalone-vaultix`; record artifact identity, browser walkthrough, idle measurement, migration reconciliation and restore/rollback drill. This closes finish line 1 only. |
| 5 / OWN-05: repeat across remaining domains | Connect/import, automation, governance, KMS/PKI/PAM/detection in 0130's dependency order. Each carries its UI, contracts, provider map, data and jobs. | Per-workflow success/denial/failure/recovery and provider evidence; retired callers/routes/workers; deliberate baseline changes backed by equivalent capability proof. |
| 6 / OWN-06: retire the engine | Delete remaining replaced implementation and dependencies from build, startup, deployment, tests and docs; preserve provenance and migration tools for supported stored data. | No inherited runtime or build dependency; no unresolved capability rows; full import and recovery evidence; canonical image acceptance. This closes finish line 2. |

Foundation recovery work already underway supports these packets. Keep its unproven drills visible; do not
restart it or delay the Auth design until every fleet feature exists. A blocked provider proof does not
prevent independent built-in work, but also does not count as a completed provider integration.

**Next implementation packet is OWN-00 leading into OWN-01.** Read the actual setup/session/authorization
consumers and kernel bootstrap handling in full. Deliver a traced Auth contract and Storybook flow, the
first complaint acceptance cases, and a data transition design before implementing the slice. Start with
first-owner setup → sign-in → authorized metadata list → logout → denied access. Expand identity before
declaring Secrets cutover. A successful secret canary demo alone cannot pass this packet.

## 5. Absorb lessons and complaints into the specification

A complaint is useful when it changes behavior that we can observe. Keep the user's words separately from
our diagnosis. For each new complaint record:

| Field | What it must say |
| --- | --- |
| Identity and provenance | Stable ID, reporter/source, date, exact quote when available; otherwise explicitly a summary. Never credentials or secret values. |
| Scenario and impact | Who was trying to do what, expected versus observed behavior, frequency/scale, blocked work and recovery cost. |
| Confidence | Reported, reproduced, source-reviewed, or hypothesis. A forum report and a local reproduction are different evidence. |
| Decision | Preserve, redesign, replace, remove with approved equivalent, or investigate; rationale and tradeoffs. |
| Ownership | Domain, implementation packet, accountable implementer and capability row. |
| Acceptance | A failing-before/passing-after scenario, a regression check, and a UX walkthrough or measurement where relevant. |
| Closure | Candidate source/artifact, test and review receipts, remaining limits and reporter/owner feedback. Code completion alone is not closure. |

Keep the durable requirement in the domain specification and link its evidence from the existing
[authorship records](code-audit/reviews.json) and [capability catalog](capabilities/README.md).
Keep private conversation detail in the local journal. Do not build a second, competing capability ledger.

Seed queue below comes from existing **recorded reviews**, not new upstream research or newly collected
user complaints. All rows are **open for packet-level acceptance**; some kernel mechanisms already exist.
Historical counts and proposals need rechecking against the selected source before implementation.
The owner can reorder complaints within dependencies; these are initial priorities, not an invented ranking.

| ID | Recorded problem and source | Vaultix requirement / proof | Packet |
| --- | --- | --- | --- |
| L-01 | Values in metadata and mutation responses; [0135 §1](0135-process-review-and-redesign.md). | Metadata-only reads and reference-only model actions; random canary absent from every non-value response, log, trace and error. | OWN-01, OWN-03 |
| L-02 | Audit can drop an event while the action succeeds; 0135 §1. | Action and audit commit together; unavailable audit refuses the action without a partial write. | OWN-03 |
| L-03 | Idle polling and many workers; 0135 §5. | Durable due-at work with measured idle CPU, database operations, memory and outbound bytes on the same harness. Missed notifications still recover due work. Define budgets before claiming improvement. | OWN-04, OWN-05 |
| L-04 | Failed jobs disappear; lease expiry depends on cache state; 0135 §1/5. | Durable expiry, visible failed runs and safe retry/reconciliation; kill/restart and destination failure tests. A queue lock alone is not exactly-once external execution. | OWN-05 |
| L-05 | API generations, changing defaults and duplicated schemas; [0128](0128-api-lessons-learned.md), 0135 §1. | One intent/contract and explicit outcomes; real-server request/response tests, generated-client drift check, updated callers and deleted old routes. | Every packet |
| L-06 | Duplicated identity/permission code and broad credentials; 0135 §4, [kernel limits](../kernel/README.md). | One authority model, scoped sessions and machine credentials; revocation/cross-tenant tests through UI, CLI and MCP. Never equate all-features-included with authorization bypass. | OWN-01, OWN-02 |
| L-07 | Inherited screens, repeated scope pages and hidden recovery; 0130, 0135 §2/4. | Design around the user's task; consistent scope, loading/empty/denied/error/recovery states; Storybook keyboard/axe tests plus real browser and assistive-technology review. | Every UI packet |
| L-08 | Imports can conceal unsupported objects or change reference semantics; 0128 import review. | Versioned source mapping and reviewed dry run; reconcile every object as migrated or explicitly unresolved, preserve reference meaning and give a recovery action. Missing capability remains a parity gap. | OWN-04, OWN-05 |

For outside complaints, request an owner-supplied issue/quote or research permitted public sources when
that packet starts. Respect the frozen-host prohibition. Verify dated technical claims before turning them
into requirements; neither a competitor's bug nor a proposed fix is automatically our product contract.

## 6. Definition of an absorbed workflow

The reviewer can answer all of these from evidence:

1. What does the user need, and which complaint or observed problem changes the design?
2. Which complete modules and consumers were read, at which hashes, and what was deliberately retained?
3. Which Vaultix contract owns its resources, permissions, value boundary, UI actions, storage and jobs?
4. Which tests demonstrate success, denial, failure/recovery and the specific improvement?
5. How do existing accounts, ciphertext, references, versions, grants and pending work migrate? Which
   unreadable source credentials require explicit reissue? Has reconciliation run on a restored copy?
6. Which old routes, callers, schemas, components and workers were deleted in this cutover? What remains?
7. Can the packaged workflow run with the inherited service stopped, and can an operator recover it?

Record retained correct behavior as deliberate reuse with provenance. Do not translate every old line into
Rust just to change languages. Conversely, do not remove a hard case merely because the new model is simpler.

Before cutover, save an encrypted restore point and rehearse migration. Define the maintenance/write-stop
window and a single writer. Before new writes, rollback may restore the pre-cutover copy. After new writes,
that old copy would lose acknowledged work: use a proven reconciliation/reverse path or forward recovery;
do not promise a binary downgrade can undo a data migration. Document the exact boundary per packet.

## 7. Progress and verification

Report **workflow states**, not rewritten line counts: unassessed → understood → specified → implemented →
verified → cut over → inherited implementation retired. These are packet reporting labels; existing review
schemas keep their own states. Counts never promote a file or capability automatically.

Each progress report names: the workflow, complaint IDs, source/artifact, current state, remaining inherited
dependency, evidence gaps, and the next concrete action. Report live-provider and fixture evidence separately.

This packet delivers the path only. It changes no runtime, migrates no data, and closes neither finish line.
Verification is document-link and diff review plus an attempted canonical build. The existing build runner
requires a clean checkout; unrelated uncommitted work must be preserved rather than committed or discarded
to manufacture an acceptance receipt. Any blocked build stays an explicit gap in the local journal.
