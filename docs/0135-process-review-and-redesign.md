# 0135: Process review and redesign

**Status:** proposed, 2026-11-15. **Parent:** 0134 (foundation), 0130 (program plan). **Method:** four read-only
code reviews on 2026-11-15, one per group of domains, each reading the real files and judging every core
process against the same rubric: how it works, what is wrong, and the redo as a Storybook screen, a scripted
MCPL UI event and an API action. Claims are marked **V** (read in the file) or **I** (inferred). Where a
reviewer could not see something, section 7 says so.

The point of this review is that nothing is carried over because it exists. Each process is kept, rewritten
or deleted on evidence.

## 1. The mistakes that repeat across the tree

| # | Mistake | Evidence | The rule that replaces it |
| --- | --- | --- | --- |
| 1 | **Values in metadata paths.** List routes decrypt and return every value on the page; `GET /secrets` defaults to returning values; mutation responses echo the value; approval payloads carry values. The list routes are not audited. | `dashboard-router.ts` (`/secrets-details`, `/secrets-overview`), `secret-router.ts`, approval types (V) | GET is metadata only. A value leaves only by redeeming a single-use handle, and every redeem is an audit event. |
| 2 | **Fail-open audit.** If the audit queue can't take an event, the request logs a drop and carries on. | `audit-log-queue.ts` `pushToLog` (V) | The audit row is written in the same database transaction as the action. If it can't be recorded, the action is refused. |
| 3 | **Work that polls while idle.** About 44 queue names, each with its own BullMQ worker, plus a hand-written Redis cron engine with 30 s and 5 s timers, plus a 5 s audit job registered unconditionally. | `queue-service.ts`, `lib/cron/cron-job.ts`, `audit-log-queue.ts:409` (V) | One `vx_jobs` table; workers woken by LISTEN/NOTIFY; one timer that sleeps until the next due job. An idle instance runs no queries. |
| 4 | **State kept in the cache that must survive a restore.** Lease revocation is only a delayed Redis job; wipe the cache and leases never expire. | `dynamic-secret-lease-queue.ts:76` (V) | Expiry is a column in Postgres; the scheduler wakes at the next expiry and a sweeper catches missed ones. |
| 5 | **Silent failure.** Jobs are deleted on failure (`removeOnFail: true`); cron run history has no endpoint or screen; webhooks have no delivery log or replay, and their per-job retries never apply because failures are collected, not thrown. | `queue()`, `webhook-fns.ts:455-520` (V) | Failures are kept, visible and replayable. A "Background work" page names every job, its schedule and its last result. |
| 6 | **One endpoint, two shapes; four API generations on one screen.** Creating a secret returns a secret or an approval request depending on policy; one screen calls v4, v2 and v1 routes. | `service.ts`, hooks (V) | One `/api/vx/v1` verb per intent with a stable `outcome` field. |
| 7 | **Many copies of one idea.** 12 near-identical machine-identity login services (about 13,000 lines); three rotation pipelines; two importers; two alert and template systems; two permission evaluators (Node CASL and Go); org and project duplicates of the same pages. | folder and file counts (V) | One implementation of each, configured by data. |
| 8 | **Tier leftovers.** A subscription context, an upgrade modal and plan-based audit retention. | `SubscriptionContext`, `UpgradePrivilegeSystemModal`, `plan.auditLogsRetentionDays` (V) | Every feature is included; authorization stays separate. |
| 9 | **Long-lived credentials by default.** Machine-identity tokens last 30 days with an open `0.0.0.0/0` allowlist; sessions last 10 days with a 90-day refresh; the organization lives in browser localStorage. | `identity-universal-auth-router.ts:177-208`, `env.ts:283-285` (V) | Short-lived tokens (15 minutes), rotating refresh, an empty allowlist means deny, and the organization lives in the session. |
| 10 | **Polling in the browser.** About 11 screens poll on a timer; notifications poll every 30 s while an event stream already exists. | `refetchInterval` (V), `event-sse-service.ts` | Server events push updates; manual refresh where nothing pushes. |
| 11 | **Secret names in URL paths**, so they appear in access logs. | `/api/v4/secrets/:secretName` (V) | Names travel in the body or as an opaque reference. |

## 2. How each redo is specified

Every process below produces three things, so nothing ships as a screen alone:

- **Storybook:** the screens and states on design-system primitives: default, loading, empty, error,
  denied and large-data, each with a keyboard spec and an axe test (DESIGN.md).
- **MCPL scripted events:** named `vaultix.ui.<domain>.<workflow>.<action>`, each returning a receipt
  `{receiptId, action, subjectId, outcome, at}` and never a value. Value entry and reveal are human-only; an
  AI's receipt says so (0114, 0120).
- **API action:** one `/api/vx/v1` call with a stable error code and a plain `error` string. The UI, CLI and
  MCP tool call the same action.

## 3. Secrets (workspace basics included)

| Process | Today's problem | Redo | Delete |
| --- | --- | --- | --- |
| Create, edit, delete, bulk | Two response shapes; value echoed; 8 to 10 cache invalidations per save; a second client-side draft layer | `POST /secrets/changes {env, path, expectVersion, ops[]}` returns `{outcome: applied \| approval_requested \| denied \| conflict, appliedVersion, changed[]}`, no values. Events `secrets.edit.open / set_field / submit`. | per-verb hooks, the invalidation blocks, the pending-changes store |
| Paste `.env` and import | Parse and diff in the browser, so existing values are fetched into the client | `POST /secrets/import-plan` returns a masked diff computed on the server; apply goes through `changes` with the plan id. Events `secrets.import.stage / apply`. | client diff, "copy from board" plaintext fetch |
| View and reveal | List routes return values; reveal is a plain GET | `GET /secrets` metadata only (`hasValue`, version, tags). `POST /secrets/{ref}/redeem` returns `{value, expiresAt}` from a single-use handle. Events `secrets.value.reveal` (human only), `secrets.value.copy`. | `viewSecretValue` on GET; value fields on list routes and mutation responses |
| Versions and point-in-time | Per-secret history and folder commits are two models; rollback and revert overlap | `GET /history?scope=`; `POST /history/restore-plan` then apply with the plan id; `409 stale_plan`. Events `secrets.history.compare / restore.stage / restore.apply`. | separate rollback and revert verbs, value-by-version GET |
| Folders and environments | Two concepts in two API generations; move-check round trips | `GET /scopes`; `POST /scopes/changes` with a `dryRun` flag. Events `secrets.scope.*`. | `/api/v2/folders`, move-check endpoints |
| Imports and references | Reference expansion per row; a backfill route exposed as an endpoint | `POST /secrets/links {from, to, kind}` with `409 cycle`. Events `secrets.link.add / remove`. | backfill route, manual replication-resync |
| Approvals | Three concepts on one page; merge is a separate call; payloads carry values | `POST /changes/{id}/decision`; merge happens when quorum is met, with an optional bypass reason. Events `secrets.review.open / decide / apply`. | separate `/merge` and `/status` |
| Search of many secrets | Three or more calls per page and every value decrypted | `GET /secrets?env[]&q&cursor` metadata with a cursor, virtualised rows | overview, details, deep-search and by-metadata as separate routes |
| Delete and restore | No soft delete; recovery only through history | Delete through `changes` with a dependents preview; undo is a history restore. | `DELETE` verbs |

## 4. Access, authentication and admin

| Process | Today's problem | Redo |
| --- | --- | --- |
| First-owner setup | Setup code checked inside a route handler with no step state | `POST /setup/owner` in one transaction, returns the session and a recovery key shown once; the endpoint disables itself after use. Events `auth.setup.*`. |
| Sign in with password and MFA | SRP two-step; 10-day tokens; org in localStorage; auth state split between Node and Go | `POST /auth/sessions` (password, passkey or OIDC) returns a session or a challenge list; 15-minute access token with rotating refresh bound to the device; org bound server-side. Passkeys first. Drop SRP only with a re-enrol path for existing accounts. |
| SSO | Four login pages and four admin forms for one choice | One federation flow (`/auth/federation/{provider}/start` and callback) with claim-to-group mapping; one provider form. |
| Invite and join | Three pages plus email verification, which fails on instances without mail | `POST /access/invites` returns a single-use link shown once and stored hashed; email is optional. |
| Machine identity | 12 login services; 30-day tokens; open allowlist | One `POST /identities/{id}/exchange {assertion}` returning a 5 to 15 minute token. Trust is data: OIDC/JWKS assertion (covers cloud and Kubernetes presets), signed request (AWS) or an expiring client secret. LDAP and static-token auth have no equivalent and are named as not carried over. |
| Roles and permissions | CASL verb and subject rules in two languages, shipped to the browser in 288 files | One evaluator in Go; deny-by-default, named actions (`reveal`, `inject`, `rotate`, ...), resource patterns, a simulator (`POST /access/check`) and a diff before save. The UI asks the server; it does not evaluate. |
| Sessions, tokens and recovery | Notification delivery mixed into auth; email-first recovery | `GET/DELETE /auth/sessions`; recovery by key or admin-issued link (the existing host-issued reset pattern, moved under `/api/vx/v1`). |
| Org and project switching, admin | Org-level and project-level copies of the same pages | One scoped Access page with tabs (People, Groups, Identities, Policies, Providers) and an admin shell in the same frame. |

## 5. Connect, automation and the job system

The idle cost is explained by the structure: about 44 queue names, each with a BullMQ worker holding a blocking
pop; a hand-written Redis cron engine with a 30 s slot refresh, a 30 s enqueue tick and a 5 s process tick in
every process; and the audit consumer on a 5 s repeatable job (V). The measured top commands (`evalsha`,
`rpoplpush`, `zrangebyscore`, `bzpopmin`) match that structure; per-queue attribution is in the hour report.
A boot-time block also creates about 20 throwaway queues and obliterates them on every start (V).

**The replacement:** one `vx_jobs` table (`kind, subject_id, payload_ref (ids only), run_at, attempts,
locked_until, status, last_error`), claimed with `FOR UPDATE SKIP LOCKED`, woken by `LISTEN/NOTIFY`, with one
timer sleeping until the next `run_at`; `vx_schedules` for recurring work; `vx_job_runs` (30 days) for history.
Failed jobs stay, visible, with a Retry action.

| Process | Redo |
| --- | --- |
| Connect a provider | Connection health table (Healthy, Failing, Untested, Credentials expired); test before save; `POST /connections/{id}:test`. Events `connections.connection.test / create / rotate`. |
| Secret sync | Sync status timeline in a Sheet: trigger, duration, key names changed, attempt, next retry, error. `POST /syncs/{id}:run`, `GET /syncs/{id}/runs`. A write enqueues one row, not a fan-out. |
| Rotation | One rotation kind (secrets, app connections, privileged accounts) with a type; due-at rows replace the once-a-day UTC scan; the failure notice is a column on the run. |
| Dynamic-secret leases | Expiry column plus sweeper; `POST /leases/{id}:revoke`; the lease list shows failed revocations. |
| Webhooks | Outbox row per event and hook, with attempts, backoff, response code and replay; `POST /webhooks/deliveries/{id}:replay`. HMAC and ed25519 signing (0127). |
| Import from Infisical or Doppler | One importer: the pure planner in `provider-import.ts` becomes the only one; the older queue-based importer goes. The plan names what it cannot bring (0127). |
| Reminders and notifications | Due-at rows; browser updates over the existing event stream. |
| Background work page | A single table: job, schedule in words, next due, last result, last duration, last error, Run now. |

About 10 kinds of work are real (sync, rotation, lease revoke, webhook delivery, notification and email, import,
audit ingest, scanning, certificate renewal, privileged sessions). The other queue names collapse into `kind`
values and schedule rows; `bullmq`, the cron engine and the legacy cleanup block are deleted.

## 6. KMS, audit, scanning, PKI, PAM

| Area | Decision | Reason |
| --- | --- | --- |
| KMS (key hierarchy, data keys) | **Keep in core**; finish the Go port, move the value path to Rust | Imported in 231 files; it is the encryption backbone. Stored data format is kept and a restore rehearsal is required. KMIP and HSM pages are deferred. |
| Audit | **Keep and redesign now** | Transactional, fail-closed with a bounded disk spool; `secret.value.read` is a first-class event carrying an HMAC of the value and the handle id; a hash chain per tenant. Postgres only. Streams and the ClickHouse path become one optional sink, off by default. Retention is a setting with a floor, not a plan feature. |
| Secret scanning | **Optional module** | Slim to findings in Vaultix's own secrets; delete v1; scan on events or a user schedule; store a file path and fingerprint, never the match. |
| PKI | **Optional module, after the core** | About 62,000 backend lines and almost no coupling to secrets (one file mentions it). When built: one issuance model, one alert system, no external-CA connectors, private keys only through a redeem handle. |
| PAM | **Deferred, out of the active tree** | A session proxy and recorder that needs gateways; not secrets-first. Keep "rotate a credential" inside Rotation and reuse the approvals idea in Secrets. |
| Early access, landing, share-secret | **Keep** | Small and authored; add Storybook stories and a rate limit. |
| Update check | **Rework** as an operator action: one request, no timer. The reviewer did not read its source; verify its target before acting. |

## 7. Quick wins, safe to do before the rewrite

Ordered by value over risk. Each is small, changes inherited code and updates its callers and baselines.

1. Stop returning values from list routes and default `viewSecretValue` to false; add a test that fails if any
   GET response schema contains a value field.
2. Register the 5 s audit scheduler only when a sink is configured; default `AUDIT_LOG_STREAMS_ENABLED` to false.
3. Delete the boot-time queue obliteration block and the legacy scheduler scan.
4. Keep failed jobs (`removeOnFail` with a count) and add a `GET /jobs` read of the cron run hashes.
5. Make webhooks throw per failed hook so retries run, or give them a delivery record.
6. Add a database sweep for expired leases.
7. Change machine-identity defaults to 15 minutes and an empty (deny) allowlist; shorten session lifetimes.
8. Remove the subscription context and upgrade modal.
9. Replace the 30 s notification poll with the event stream.

## 8. Not reviewed, and corrections

- **Not reviewed:** the secret-scanning cron schedule; key-operation audit in KMS; the update-check source;
  frontend integration pages, `integration` and `integration-auth`, secret replication, Kubernetes and gateway
  services; roughly 15 provider and PAM queues; SCIM and LDAP screens; the approvals backend; per-route
  permission checks.
- **Correction to the idle report:** the dry run showed "daily" cleanup lines and I scaled one occurrence in two
  minutes to 30 per hour. Those jobs are scheduled for midnight and 03:30 UTC (V); the dry run caught a
  start-up run. Whether anything fires every two minutes is open until the one-hour report.
- The reviewers read the code but ran nothing; every finding needs its test before it drives a deletion.

## 9. Decisions for the owner

1. **PKI and PAM.** Deferring them drops capabilities that 0127's "more, never less" promises Infisical
   migrants. Options: ship them later as optional modules and say plainly in the importer that they are not
   imported yet (recommended), or keep them in the core.
2. **SRP accounts.** Dropping the SRP password scheme needs a re-enrol path so existing accounts survive. Confirm.
3. **LDAP and static-token machine identities** have no equivalent in the new exchange. Confirm they are named
   as not carried over.
4. **Redis.** Dropping it removes a dependency and the idle polling (0134). Confirm no customer requires it.
