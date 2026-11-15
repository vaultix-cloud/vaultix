# 0132: Core backbone, MCPL and the synced plugin

**Status:** proposed, 2026-11-15. **Parent:** `docs/0130-vaultix-program-plan.md`, phases 3, 4 and 6.
**Builds on:** 0120 (MCPL), 0123 (signals and receipts), 0124 (personas, value requests, local
endpoint), 0126 (AI connections, Hugging Face, Custom), 0127 (one API), 0129 (single-source schema).

The owner wants three things from the fork-off-Infisical experiment: MCPL as the way every action is
used, a core backbone rebuilt from measured lessons rather than inherited habits, and a loop where an
installed plugin saves a variable, syncs it to the person's cloud instance and shows, plainly, when
the cloud has confirmed it. This plan says what exists, what is missing and the order to build it.
Nothing here changes code yet.

## 1. What already exists (checked 2026-11-15 against 0120, 0123, 0124, 0126)

| Need | State |
| --- | --- |
| One action framework for people, UI and AI | MCPL: source actions, 15 domains, main MCP plus warp points (8 live, 7 planned). |
| Model endpoint from our own API key, or managed from Hugging Face | Specified in 0126 (`anthropic`, `openai`, `bedrock`, `vertex`, `huggingface`, `huggingface-endpoint`, `custom`). Helpers built 2026-11-14. **No real Hugging Face call has run**; it needs the owner's token entered in the UI. |
| Signals over the UI, never carrying values | Specified in 0123. Today only tests read the action attributes; nothing emits. |
| Value saved without an AI seeing it | Specified in 0124 (value requests, inject and redeem). Not built: steps 2 to 5 of its order. |
| Machine loops (apps connect to save and use variables) | Specified in 0124 as the optional local endpoint. Not built. `vaultix daemon` is an outbound sync loop only. |
| A plugin | **Not specified anywhere.** The word appears only in 0108, 0117 and 0129 for other meanings. |
| Visual proof that the cloud confirmed a save | Outcome receipts in 0123 cover the UI. Nothing covers a client that saved offline or through a plugin. |

So the new design work is the plugin and its sync states. The rest is finishing 0123 and 0124 in the
order below.

## 2. The plugin, as I read the request

A **Vaultix plugin** is software installed in a person's AI client or editor (Claude Code, Codex, an
IDE) that talks to their Vaultix instance through the existing paths: `vaultix mcp` and, for apps,
the local endpoint. I assumed this meaning; if you meant something else, section 6 asks.

It never holds a value for an AI. It does three things:

1. **Save.** The person's variable goes in through a value request (0124): the browser or the
   plugin's own secure prompt submits it straight to the secrets API with the person's permission
   check. The AI sees the name and the outcome.
2. **Sync.** A local outbox records each change as a name, project, environment, intended version and
   state, never the value. The value, if it must wait offline, is held encrypted by the OS keyring,
   not in the outbox file.
3. **Confirm.** The plugin shows a sync state only from the server's answer.

### Sync states

A state is shown only when the server's receipt backs it. No optimistic green.

| State | Meaning | Shown as |
| --- | --- | --- |
| Saved locally | In the outbox or keyring, not sent | Neutral dot, "Waiting to sync" |
| Sending | Request in flight | Spinner with text |
| Confirmed on your cloud | Server returned success with a receipt (audit event ID and secret version) | Check, "Confirmed", version and time |
| Needs approval | The project requires a change approval | Clock, a link to the request |
| Refused | Permission, validation or policy denied it, with the server's plain `error` | Alert with the reason |
| Conflict | The cloud version moved since the plugin last saw it | Two-way arrow, choose keep cloud or keep mine |
| Offline | The instance cannot be reached; it retries with backoff | Muted, "Will retry" |

Every state has an icon, text and a non-colour cue, in the plugin, in the web UI's Clyffy overlay and
in the CLI. The web UI's list of recent syncs reads the same receipts, so what the plugin says and
what the cloud says cannot differ. A "Confirmed" the server never issued is the one failure this
design must make impossible, so it gets its own test: stop the server after the request leaves and
check the state stays Sending, then Offline, never Confirmed.

### Conflict rule

Saves carry the version they were based on. If the cloud is ahead, the server refuses with a conflict
and the plugin shows both versions' metadata (who, when), never values, and asks. No silent
overwrite either way.

## 3. The backbone: lessons first, then rebuild

The owner reports resource waste, blockages and poor secret-handling practice inherited from
Infisical. I can't treat those as findings until they are measured, so the first step produces them.

**Step 0, measure (a day or two, read-only).** For the standalone image under a seeded load:

- queries per page and per API call (look for N+1 and repeated permission loads);
- background work: queue workers, cron jobs and polling that run with no tenant activity, and idle
  CPU and memory;
- image size and startup time, and what each costs the 24-month support promise in 0127;
- secret-handling habits the product encourages: long-lived tokens, values returned by GET (0124 fix
  4), secrets with no owner or reason, no rotation prompt, plain values in logs or audit.

Output: `docs/0132a-backbone-measurements.md` with numbers, and a ranked list of causes. Rebuild
decisions then cite a measurement, not a feeling.

**Then rebuild by domain,** following 0130 phase 4 and the Go and Rust direction in 0027: each
domain moves as a complete use case (UI, API, MCP warp point, tests), the encrypted store is
preserved, and a Go proxy over old logic does not count. Candidates the measurement will likely
confirm or reject: replacing polling with the signal fabric's event stream; one permission load per
request; value-free GET with inject and redeem; secret metadata (owner, purpose, expiry) required by
default so waste becomes visible.

## 4. Build order

Each step ships through the canonical image with its canary check (a value is absent from every
model request, signal, tool result, log line and plugin file).

1. **Measure** (section 3, step 0).
2. **Signals that emit** (0123): the framework, no-value rule and passive hints. The plugin states
   and the Clyffy overlay both depend on it.
3. **Value requests and the secrets warp point tool** (0124 step 2).
4. **Native inject and redeem; the CLI leaves the GET** (0124 step 3).
5. **Outcome receipts for every write**, including a receipt shape the plugin can read: audit event
   ID, secret version, server time (0123).
6. **Local endpoint and app pairing** (0124 step 4), the machine loop: list names, create value
   requests, redeem once.
7. **The plugin**: outbox, the seven sync states, conflict handling, and the same states in the
   overlay's "recent syncs". One plugin first (Claude Code, since this repo is developed there),
   others reuse the contract.
8. **A real Hugging Face call** through 0126, with the owner's token entered in the UI, run through
   the same loop as the proof that "our key or managed from Hugging Face" works end to end.
9. **Backbone rebuild by domain** from the measured list.

## 5. Done when

On the canonical image, in the browser and in a real plugin install:

- A variable saved from the plugin shows Saved locally, Sending, then Confirmed with a version and
  receipt, and the same entry with the same version appears in the web UI.
- A forced denial, a forced validation failure, a required approval, a conflict and a stopped server
  each show the right state with the reason, and none shows Confirmed.
- A canary value is absent from every AI request, signal, outbox file, tool result and log line.
- The same loop runs once on our own provider key and once on a Hugging Face connection.
- Step 0's measurements are published and each backbone change cites one.

## 6. Decisions for the owner

Answered 2026-11-15:

1. **The plugin** is client-side. It bundles its own UI components, can receive pushed updates and
   lets a person click to update. Extensions to the Vaultix server itself come later as a separate
   piece. The plugin's state display (section 2) and update channel are designed after the base API
   is fixed.
2. **First client:** Claude Code, then Codex, **not now**. The current priority is the base API:
   fix it, then test the lessons learned and the paths of an optimized clean start. Steps 7 and 8 of
   the build order wait for that.

Still open:
3. **Offline values:** may the plugin hold a value in the OS keyring while offline (my recommendation,
   with a short expiry), or must a save fail when the cloud is unreachable?
4. **Approval flows:** when a project requires approval, is "Needs approval" a normal confirmed-later
   state, or should the plugin block until approved?
5. **Measurement scope:** may step 0 run against the standalone image only, or also against a
   hosted instance? I would not touch hosted without your go-ahead.
