# 0133: A clean-slate core and an AI-safe space

**Status:** proposed, 2026-11-15. **Parent:** `docs/0130-vaultix-program-plan.md`. **Extends:**
0132 (backbone, MCPL, synced plugin), 0128 (API lessons), 0127 (one API), 0124 and 0126 (AI).

The owner's direction: treat the core as a clean slate. Read what Infisical's users actually
complain about, rebuild without inheriting those causes, try Rust and current practice where they
measurably help, and make Vaultix a place where a frontier AI can work near sensitive information
with enforced gates and no leakage. Vaultix also offers an AI that it owns, on an endpoint it owns,
with no tracking beyond general use.

This plan separates three things the request blends: what is **evidenced**, what is **designed**
and what must be **proven** before we say it to a customer.

## 1. What Infisical's users report (read 2026-11-15, public issue pages)

Facts as the pages showed them on that date. Open issues can change.

| Issue | Report | State |
| --- | --- | --- |
| [#4795](https://github.com/Infisical/infisical/issues/4795) | Self-hosted backend idles at 500 to 800 MB with no spikes. One commenter moved to OpenBao, which they say idles near 25 MB. | Open since 2025-11-03, no cause found |
| [#4998](https://github.com/Infisical/infisical/issues/4998) | Container-start migrations take 10+ minutes on small hosts and on one strong self-hosted server (v0.161.5), so platform health checks fail. Maintainers say under 30 seconds in their environments. | Open since 2025-12-08 |
| [#5074](https://github.com/Infisical/infisical/issues/5074) | An idle small deployment shows 5.28 GB out and 2.77 GB in, with repeating "no changes, skipping sync" and OAuth refresh log lines. | Open since 2025-12-19, no cause found |
| Advisories page | "There aren't any published security advisories" on the repository. Third-party databases list CVEs for distro builds, mostly through dependencies. | n/a |

Earlier API-level findings, with citations, are in 0128 (for example the open request
[#1595](https://github.com/Infisical/infisical/issues/1595) and the closed
"not planned" [#1637](https://github.com/Infisical/infisical/issues/1637)).

Not found, so not claimed: a public issue showing a secret value written to logs or audit entries.
Our own leakage gates (section 3) are a design goal, not a rescue from a known Infisical bug.

### What these three tell us to design against

1. **Idle cost is a product feature.** Work that runs with no tenant activity (sync checks, OAuth
   refresh, health tasks, queue workers) should be event-driven or quiet, and its idle CPU, memory,
   network and log volume are budgeted and tested.
2. **Start-up must be bounded and visible.** Migrations run as a separate, measured step with
   progress output and a time budget, never hidden inside the container's health window.
3. **Say what you do.** A cause that nobody can find in logs became a trust problem. Every
   background job names itself, its reason and its last result in one place.

## 2. The clean slate, and where Rust earns its place

"Clean slate" means we design the core from these requirements, not by porting Infisical's modules.
It does **not** mean rewriting everything in Rust first. Order by risk and measurement:

| Layer | Direction | Why |
| --- | --- | --- |
| Value path: envelope encryption, redaction, inject and redeem, the delivery broker | **Rust** | Memory-safe, no GC pauses holding plaintext, zeroising buffers (`zeroize`), small static binary, easy to fuzz. This is where leakage would happen. |
| The output gate (section 3) | **Rust** | A single audited choke point every outbound AI-facing payload passes. |
| Local endpoint (loopback, pairing, redeem) | **Rust** | Small, security-critical, shipped to user machines. |
| API, domains, workflows | **Go** (0027) | Already the direction; fast to build and test; Rust adds little here. |
| Store | Postgres with a new namespace | See decision 1: the one place "clean slate" collides with a standing rule. |

Rust claims are hypotheses until measured. Step 0 of 0132 sets the baseline (idle memory, start-up
time, image size, queries per call) for the current core; each Rust component must beat its baseline
and pass a fuzz and memory-safety gate to stay. Targets, to be confirmed by measurement and not
promised: idle memory in the tens of megabytes for the value path, start-up in seconds, a
single-digit-second migration step reported with progress.

## 3. The AI-safe space

A frontier model never gets a value. The design makes that structural rather than a habit.

**Gates, all on the one path every AI-facing byte takes:**

1. **Typed, not free text.** AI-facing tools return names, IDs, counts and states (0120). A value has
   no field to travel in.
2. **Output gate.** Every payload to a model, log, signal, trace and error passes the Rust gate.
   It rejects anything matching known secret formats, any registered canary, and any string equal to
   a value the instance holds a hash of. A rejection fails closed and is audited with the tool and
   actor, never the content.
3. **Inputs are scanned too.** A person pasting a credential into chat is caught by the same scanner
   before it reaches a provider, and the person is sent to a value request (0124) instead.
4. **Canary testing as a build gate.** Every canonical build plants canary values and checks they
   are absent from every model request, signal, tool result, log line, plugin file and crash dump.
   A single hit fails the build.
5. **Egress control.** The AI service can reach only its configured endpoint. No telemetry
   libraries, and a test that fails if the process opens any other connection.
6. **Provenance.** Each AI answer records persona, model, tools and the receipt IDs behind it, so a
   reviewer can reconstruct what happened without reading any value.

What this guarantees: no value reaches a model **through Vaultix's own paths**. What it can't
guarantee: a person who types a secret into a different tool, or a model that infers a secret from
names alone. Marketing says "enforced gates, tested on every build", never "zero risk".

## 4. The Vaultix-owned AI

An open-weights model served on hardware AngryVibes owns (vLLM or equivalent), behind an
OpenAI-compatible endpoint that 0126 already supports as a Custom connection. For a customer it is a
connection kind like any other, listed first and configured by default in the managed offerings.

What "no tracking" means, stated so it can be checked:

- **Not stored:** prompts, completions and tool results are not kept after the request finishes,
  except in the customer's own audit log inside their instance, as references and receipts.
- **Not used:** never used to train or tune a model, ours or anyone's.
- **Not sent:** no per-person or per-content analytics leave the instance.
- **Counted:** aggregate, content-free counters for operating the service (request counts, latency,
  token totals per instance, error rates).
- **Verifiable:** the service's source and its egress test ship with the product; a customer on the
  self-hosted offering can run the same canary and egress checks.

Needs from the owner before it is offered: where it runs (the hosting question open in 0130), model
choice and licence terms, capacity and cost, and a privacy notice reviewed by counsel (open since
2026-11-09).

## 5. Build order

Inserted into the 0132 order; each step ships on the canonical image.

1. **Measure** the current core (0132 step 0) and publish the baseline.
2. **Idle and start-up budgets** as tests: idle CPU, memory, outbound bytes and log lines per hour;
   migration step time with progress output.
3. **Output gate and canary gate** in Rust, wired to every AI-facing path, with fuzzing.
4. **Value path in Rust** (envelope, redeem, delivery broker) replacing the Go and Node paths, behind
   the existing inject and redeem contract.
5. **Egress test** for the AI service and the "background jobs" page (name, reason, last result).
6. **The owned AI endpoint** on a non-production host, then a real run with the owner's token for the
   Hugging Face path (0126) as the comparison.
7. Domains rebuilt from the clean-slate requirements (0130 phase 4).

## 6. Done when

- The baseline and each budget are published, and an idle instance stays under them for 24 hours.
- A canary planted in a secret, a memory, a chat message and an import appears in no model request,
  signal, tool result, log line or plugin file, across a full session, and the build fails if it does.
- The output gate blocks a forced leak in each path and records it without the content.
- The AI service passes the egress test and a customer-run copy of the same checks.
- Each Rust component beats its measured baseline or is removed.

## 7. Decisions for the owner

1. **Clean slate versus the store.** AGENTS.md says stored data still migrates and keys survive
   upgrades; pre-release says no instance is production. Do you want a new store format with a
   one-way import of today's data, or to keep the current encrypted store and rebuild above it?
   My recommendation: keep keys and the encrypted format, rebuild the code above them, because
   changing both at once removes our way to prove the new core against the old.
2. **Reading Infisical.** 0015 forbids fetching or cloning a snapshot host. This research read only
   public issue and advisory pages, no code. Confirm that reading public issues is allowed, and
   whether to widen it to their public source for study (I would not copy any of it).
3. **Rust scope.** Value path, gate and local endpoint first (recommended), or a wider rewrite?
4. **The no-tracking statement.** Are the five commitments in section 4 the ones you want to make
   publicly? They become promises with tests behind them.
5. **Owned AI hosting and model.** Where it runs, which model family and what licence.
