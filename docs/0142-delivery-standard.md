# 0142. Delivery standard: author the whole feature, prove the flow, accept on green

Owner decision, 2026-11-17. One developer, one alpha. This is how work is delivered until the owner changes it.

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

## 7. Build order

1. Absorb the three open remote branches and delete merged branches and worktrees.
2. `scripts/gate.mjs`, receipts, the ArkType manifest and failure-record schemas, the pre-push hook. Time every check.
3. Answer-edit guard and the unowned-source check.
4. The notification sender, against the owner's address once it exists.
5. First feature authored whole under this standard: the secrets domain (kernel) with its Svelte screens.
