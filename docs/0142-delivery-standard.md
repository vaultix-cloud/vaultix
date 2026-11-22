# 0142. Delivery standard: author the whole feature, prove the flow, accept on green

Owner decision, 2026-11-17. One developer, one alpha. This is how work is delivered until the owner changes it.

Current product packet order is [0147](0147-execution-path.md). Its P1 supplies
the first scoped feature and its guards; the dated status and next-work list below
are historical. This delivery standard and its acceptance gates still apply.

## 1. Unit of delivery

A **feature** is delivered whole: every capability it declares is authored, then committed on one branch, then accepted only
when the gate is green. No half features on `main`, no "enable later". The branch is deleted when it merges.

Each feature has a manifest, `features/<name>.feature.json`, validated by an ArkType schema
(`kernel/contracts/documents/`, same registry as the AI documents). It lists:

- `capabilities`: each one a user-visible thing the feature can do, with an id.
- `owns`: the source paths that implement it (globs).
- `flows`: for every capability, the **flow proof** that shows it working (section 3).
- `parity`: when the capability replaces an upstream one, the proof that Vaultix does at least as much (docs/0127).

A capability with no flow proof is unfinished. The gate says so by name.

## 2. The gate

`node scripts/gate.mjs` is the only definition of green.

- **fast**: runs before every push (pre-push hook). Format, clippy, kernel unit tests against a disposable Postgres,
  boundaries, Zod ceiling, lineage ceiling, contract, owned-tree, manifest validation.
- **full**: runs before a merge to `main`. Adds the real-process flows, the drills, the capability-surface baseline, the
  frontend build and the `Dockerfile.standalone-vaultix` build.
- Every run writes a **receipt** (commit hash, each check, pass or fail, seconds). The baseline is the receipt for the commit
  on `main`. A merge with no full-tier receipt for the exact head commit is refused.

## 3. Tests must demonstrate the feature

Unit tests are for the author. They never count as proof that a capability works.

A **flow proof** drives the feature through its real entry point (the real binary over HTTP, the real CLI, or the real browser
build), from the first user action to the observable result, including the failure the user would hit. It must:

1. start the real process (no in-process shortcut around the server);
2. exercise the full path (for secrets: create, read as metadata, redeem once, audit row present, second redeem refused);
3. survive a **mutation check**: the gate plants one bug in the owned source (for example, skip the audit write) and the flow must
   fail. A flow that cannot fail is rejected. `scripts/mutation-*.mjs` is the mechanism and each feature registers its mutations.

**A test that no check runs is not a test.** cargo runs the server's integration tests only by name, so a new file under
`kernel/server/tests` is run by nothing until a check names it, and the gate stays green. The first-owner-to-logout journeys
(`auth.rs`) sat in that state until 2026-11-20. The gate's own tests now fail when any file there is named by no check, and the
check that runs the auth journeys waits for the one that builds the `vx` client they drive. The rule for a database or process
test is to run under `budget` with the processes it starts registered by `track` (`kernel/foundation/store/src/testing.rs`);
that rule is a convention, and no check enforces it yet.

**Source change triggers the flow.** The gate maps changed files through `owns` to features. A feature whose owned source changed
must have a flow receipt for this commit. Source that no manifest owns fails the gate (nothing is unowned).

## 4. Fix the source, not the answer

When a check fails, the gate writes a **failure record** (ArkType-validated, `.gate/failures/<commit>.json`) with: check, expected,
observed, the file and line when known, and the rule text: *fix the source; do not change the expectation, ceiling, baseline or
snapshot to match*.

A commit that fixes a failure is checked for **answer edits**: changes to any ceiling, baseline, snapshot, golden file, expected
value or test assertion. These are refused unless the commit message carries `answer-change: <reason>` and the change is one the
ratchet allows (ceilings only go down; the capability baseline never loses a capability). The refusal prints the failure record so
the same text that blocked the change is in front of whoever tries it.

## 5. Loud failures

A failed gate on `main` (or a refused merge) sends an email to the owner's notification address. The message has the failure
record, the commit and the check that failed, and nothing else: no secret values, no file contents. SMTP credentials live in the
instance's own secret store and in the runner's environment, never in the repository and never in chat. Until the address
exists the gate writes the same message to `.gate/outbox/` and prints it, and the failure still blocks.

## 6. What is not allowed

- Merging on a red or missing receipt.
- Lowering the bar to pass: editing a ceiling up, recapturing a reduced baseline, deleting or loosening an assertion.
- A capability counted as done because a unit test passes.
- Leaving a merged branch or worktree behind.

## 7. State

Built and proven (2026-11-17):

- **The three documents** (`vaultix.feature.v1`, `vaultix.gate-receipt.v1`, `vaultix.gate-failure.v1`), in ArkType in
  `kernel/contracts/documents/`, with exported JSON Schema, tests that judge each two ways over mechanically broken variants, and
  `node scripts/mutation-gate-documents.mjs` (12 planted bugs, all caught).
- **`node scripts/gate.mjs`**: the fast tier, `--full`, `--only`, `--list`, `--verify-receipt`, `--install-hook`; receipts, failure
  records, the outbox, per-check time limits and timing, prerequisites (`after`), a dependency installer, a disposable Postgres.
  `node scripts/mutation-gate.mjs` plants bugs in the gate itself (all caught). A failure is never built from a check's output.
- **Time limits on every database and process test** (`vx_store::testing::budget`, `within`, a watchdog that stops the servers a test
  started). A drill can no longer wait forever.

Not built:

- **Feature flows.** No feature manifest exists yet, so the "source change triggers the flow" rule and the unowned-source check have
  nothing to run on. The secrets domain is the first feature to be authored whole.
- **The answer-edit guard** (section 4): the failure kind exists, nothing produces it yet.
- **Sending the email** (section 5): the message is built and written to `.gate/outbox/`; there is no mail host or credential yet.
  The address is set by `VX_GATE_NOTIFY_FROM` and `VX_GATE_NOTIFY_TO`.
- **Known gaps**, listed on every run (`node scripts/gate.mjs --list`): rustfmt, the authorship audit, the owned-tree check, the
  standalone image build, the frontend, feature flows.

## 8. Next, in order

1. The answer-edit guard and the unowned-source check, which need the first feature manifest.
2. The secrets feature authored whole: manifest, flows, mutations, then its Svelte screens.
3. The notification sender, once a mail host and credential exist (the credential goes in a Vaultix secret, never in chat).
4. Close the known gaps, each as a check.
