# 0145. Landing a branch, and failures that stay loud

Written 2026-11-18, after a cleanup found that "absorb on green, then delete" was a habit and not a mechanism: GitHub's delete-on-merge
only fires for merged pull requests, and we merge locally and push to `main`. The branches were deleted by hand, and nothing would have
stopped the pile from coming back. This document is the mechanism. It extends docs/0142 (the delivery standard); it does not replace it.

## What it is

`node scripts/absorb.mjs <branch> [--update]` lands a branch on `main` and leaves nothing behind, in stages, each of which can stop it:

| Stage | What must be true |
| --- | --- |
| preflight | The branch exists, `origin` fetches, no other absorb is running (one lock per repository), and its worktree, if it has one, has no uncommitted changes. A branch that `origin/main` does not hold yet needs a worktree (the gate runs in it). |
| update | Only with `--update`: `origin/main` is merged into the branch. A conflict aborts the merge and stops. The merged commit is a new commit and needs its own receipt. |
| gate | A passing **full-tier** receipt exists for the exact head commit. If not, the full tier runs once, in the branch's own worktree (where its dependencies and build cache already are). |
| push | `main` still sits inside the branch's history, then exactly the tested commit is pushed, fast-forward only. |
| cleanup | Local `main` is fast-forwarded; the passing full-tier receipt is copied into main's `.gate/receipts/` (the baseline is the receipt for the commit on `main`, and the worktree that held it is about to go); the remote branch, the worktree and the local branch are deleted. |
| verify | The remote branch, the local branch and the worktree are gone, and `origin/main` holds the commit (holds, not equals: someone else pushing a moment later is not a failure). Only then is it reported as done. |

**Finishing a landing that stopped.** A run can stop in the cleanup after `main` already holds the commit. On 2026-11-20 it did: a terminal
sitting in the worktree stopped Windows removing the directory. Running absorb again for the same branch then finds that `origin/main`
holds the commit, does not gate or push, and deletes what is left (a worktree with uncommitted changes is still refused, landed or not).
Before this, the run refused with "the branch has no worktree" and the alert, which stays until the branch lands, could never clear.
A worktree that cannot be removed is reported with the likely cause: a terminal or program using it as its working directory.

Two rules shape it:

1. **Nothing is deleted until `main` holds the commit.** A failure at any stage before the push leaves the branch, its remote branch and
   its worktree exactly as they were. There is no flag to skip the gate, push past a rejection, or force anything.
2. **A failure is loud, and it stays loud.** See below.

## How a failure reaches whoever is working

A failure (an absorb that stopped, a gate check that failed, a leftover branch) becomes an **alert**: a `vaultix.gate-failure.v1` record
(docs/0142 section 4), kept in `.git/vx-alerts/`, the git common directory, which every worktree of the repository shares. It carries the
rule `fix the source; do not change the expectation, ceiling, baseline or snapshot to match`, and only text the gate wrote: what git or a
check printed stays in `.gate/logs/` (the record names the file).

An alert is cleared by **one thing**: the check that raised it passing, or the branch it names landing on `main`. There is no acknowledge
and no dismiss, because an alert that can be dismissed is one the answer can be changed to silence.

| Channel | Who it reaches | When |
| --- | --- | --- |
| The alert, injected by hooks (`.claude/settings.json`) | The agent in any session of this repository | Shown at session start and on every prompt while unresolved. At Stop, a failure is pushed back on at most **twice** in total (and never while the harness is already continuing because of a block), so a turn cannot end with it silently unresolved but a session cannot be trapped. |
| `.gate/outbox/` message | The owner, once a sender exists | Always written. Nothing sends it yet (below). |
| Webhook (`VX_GATE_NOTIFY_WEBHOOK`) | The owner's phone or chat | Only if configured. A plain `POST` of the same gate-written text with `Title`, `Priority: urgent` and `Tags` headers: ntfy.sh, Slack and Discord incoming hooks all accept it. A webhook that is down is reported, and never hides the failure; the alert is written first. |

Housekeeping findings (a merged branch or worktree that still exists, local `main` behind `origin/main`) are advice: shown, never blocking.
They are recomputed every time (`node scripts/absorb.mjs --hygiene`, or at session start), so they clear themselves once the thing is fixed.

## Resource use

Nothing polls and nothing runs unless asked. The gate runs **once per head commit**: a branch that already has a passing full receipt for
its head is not gated again. The hooks cost a Node start and a handful of git reads, and print nothing when nothing is wrong. Keeping a
branch up to date with `main` (`--update`) is what makes absorbing cheap: an up-to-date branch with a receipt lands in seconds.

## Configuration, nothing hard-coded

| Variable | Meaning |
| --- | --- |
| `VX_GATE_NOTIFY_FROM`, `VX_GATE_NOTIFY_TO` | The sender and recipient written into the outbox message. Unset, the message says so. |
| `VX_GATE_NOTIFY_WEBHOOK` | An `http(s)` URL to post each failure to. Unset, no webhook. |

The mail host, port and credential will be an admin-configured document (ArkType, with the credential held by reference), not variables
and not code. That belongs with the admin section, and nothing here assumes a provider.

## What this does not do (stated so it is not mistaken for done)

- **No email is sent.** The message is built and written. Sending needs the admin-configured mail document and a host.
- **The hooks only fire in a checkout that contains `.claude/settings.json`.** Until this branch is on `main`, the main checkout does not
  have them. Claude Code also asks before trusting a project's hooks.
- **No agent is started for you.** If no session is open, the alert waits for the next one, and the webhook is how the owner hears. Starting
  a headless session to fix a failure would spend money unasked; it can be added as an opt-in scheduled routine.
- **Alerts are per machine.** They live in `.git/`. A second machine does not see them.
- **Two layers are not tested on their own**: the fetch before the push and the client's refusal of a non-fast-forward each stop a stale
  push, so removing either alone changes nothing a test can observe; and the final verify stage re-checks what the stages before it
  already checked. `scripts/mutation-absorb.mjs` lists them instead of pretending to cover them. Also untested: the hint printed when
  a worktree cannot be removed (the cause, a terminal sitting in the directory, cannot be made on every machine a test runs on).
- Absorb steps out of the worktree's directory before deleting it, and a test proves that. It can only move its own process: a
  terminal or editor of yours that sits in the worktree still stops Windows removing it. Run absorb from the main checkout, not from
  inside the branch's worktree, and if it stops there, close the terminal and run it again.

## Checks

`absorb-tests` (fast tier): 30 tests against real git repositories (a bare origin, a main checkout, linked worktrees; only the gate is
faked), in four files that run side by side. `absorb-mutation` (full tier): planted bugs in absorb, alerts, hygiene, the poke and the
command line, each of which must make a test fail. Both are in `scripts/gate/checks.mjs`.
