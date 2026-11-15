# 0132a: Backbone measurements

**Method:** `scripts/measure-idle-baseline.mjs`. A fresh disposable instance (database, cache, application) on
a network with no outbound route, one owner, organization and project created, two minutes to settle, then
**one hour with no requests**. Only counts, names and shapes are recorded. Raw report:
`.cache/idle-baseline-hour-20eee557/report.json` (not committed).

## 1. The inherited core, one hour idle (2026-11-15, image `20eee557`)

| What | Measured |
| --- | --- |
| Application memory | 962 MiB at the start, 978 MiB at most, 904 MiB at the end |
| Application CPU | 1.3% average, with nobody using it |
| Application network | 16.2 MB in and 48.5 MB out per hour (about 1.2 GB a day out) |
| Cache operations | 90 per second, about 324,000 an hour; 26.5 MB an hour into the cache |
| Queues alive | 40, each with its own worker |
| Heaviest cache commands | `evalsha`, `rpoplpush`, `zrangebyscore`, `del`, `hmget` (32,000 to 44,000 an hour each) |
| Log lines | 280 an hour |
| Image | 3.0 GiB; 30 seconds from start to ready on a fresh database |

Traffic by queue, from a 20-second sample of 1,671 commands: `audit-log-clickhouse-batch` 16%, commands
carrying no queue key (the cron engine) 9%, and about 40 other queues at 1% to 2% each. The audit queue is the
single largest source, on an instance with no ClickHouse and no log streams configured.

## 2. It reproduces the Infisical reports

The same lines that issue [#5074](https://github.com/Infisical/infisical/issues/5074) calls unsettling repeat on
our idle instance, 12 times an hour each: "Refreshing OAuth configuration..." and "No changes to Microsoft
Teams integration configuration, skipping sync". Memory sits in the band of
[#4795](https://github.com/Infisical/infisical/issues/4795) (500 to 800 MB reported; about 960 MB here), and
outbound traffic is of the order #5074 describes. The cause is structural (docs/0135 section 5): about 44 queue
names each polling, a hand-written cron engine with 30-second and 5-second ticks, and a 5-second audit job
registered whether or not a sink exists.

## 3. Corrections to earlier notes

- A two-minute dry run suggested "daily" jobs enqueued every two minutes. That was one start-up run scaled to
  an hour. The hour shows 280 log lines in total and no such repetition; the claim is withdrawn.
- The first preview sample (625 MiB application, 11.2 million cache commands) came from an instance that had
  been browsed; this hour on a fresh instance replaces it.

## 4. The new core, first sample (not yet the same harness)

Release binary of `kernel` (`vaultixd`), run on the Windows host against a disposable Postgres,
sealed, no tenants, one minute idle after settling:

| What | Measured |
| --- | --- |
| Binary | 3.3 MiB (with TLS to the database) |
| Working set | 11.9 MiB (3 MiB private), 26 threads |
| CPU | 0.02 seconds in total |
| Database statements in an idle minute | 0 (Postgres statement logging on) |
| Cache | none required |
| Tests | 39, against a real Postgres, plus 3 compile-fail tests and a clean clippy run |

This is a foundation with no tenants, no secrets and no domains yet, so it shows the floor, not what the
finished product will cost. It is also a Windows process against a Linux container, so the comparison is
indicative. The honest comparison is the same script against a `vaultixd` container (next step), and the same
script again as each domain lands.

## 5. Not yet measured

- `vaultixd` in a container with the same one-hour hold, and again with a seeded organization.
- Queries per call for the busiest routes, and permission loads per request, in the inherited core.
- Migration step time on a fresh database and on a 100,000-secret database.
- Values and secrets in logs, audit rows, errors and crash output, using canary values, in the inherited core.
- Budgets: none are set. Suggested first budgets for the new core, to be confirmed by the container run:
  0 database statements and 0 cache operations idle, under 50 MiB memory, under 1 MB an hour out, under 10
  log lines an hour.
