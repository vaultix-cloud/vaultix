-- The operate group (docs/0119): jobs, schedules, run history and the audit chain.
-- Forward-only. Payloads and details hold identifiers and counts, never secret values.

CREATE TABLE vx_operate_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL DEFAULT '{}',
  run_at        timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'dead')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  locked_by     text,
  locked_until  timestamptz,
  last_error    text NOT NULL DEFAULT '',
  schedule      text,
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX vx_operate_jobs_queued ON vx_operate_jobs (run_at) WHERE status = 'queued';
CREATE INDEX vx_operate_jobs_running ON vx_operate_jobs (locked_until) WHERE status = 'running';
CREATE INDEX vx_operate_jobs_finished ON vx_operate_jobs (finished_at) WHERE status IN ('succeeded', 'dead');
CREATE UNIQUE INDEX vx_operate_jobs_dedupe ON vx_operate_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE TABLE vx_operate_job_runs (
  id           bigserial PRIMARY KEY,
  job_id       uuid NOT NULL,
  kind         text NOT NULL,
  attempt      integer NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text NOT NULL CHECK (outcome IN ('succeeded', 'retry', 'dead', 'lease_expired')),
  error        text NOT NULL DEFAULT '',
  duration_ms  integer NOT NULL DEFAULT 0
);
CREATE INDEX vx_operate_job_runs_job ON vx_operate_job_runs (job_id);
CREATE INDEX vx_operate_job_runs_finished ON vx_operate_job_runs (finished_at);

CREATE TABLE vx_operate_schedules (
  name         text PRIMARY KEY,
  kind         text NOT NULL,
  spec         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  enabled      boolean NOT NULL DEFAULT true,
  next_due     timestamptz NOT NULL,
  last_run_at  timestamptz,
  last_result text NOT NULL DEFAULT '',
  last_error   text NOT NULL DEFAULT ''
);
CREATE INDEX vx_operate_schedules_due ON vx_operate_schedules (next_due) WHERE enabled;

CREATE TABLE vx_operate_audit_heads (
  chain     text PRIMARY KEY,
  last_seq  bigint NOT NULL,
  last_hash bytea NOT NULL
);

CREATE TABLE vx_operate_audit_events (
  chain       text NOT NULL,
  seq         bigint NOT NULL,
  at          timestamptz NOT NULL,
  actor       text NOT NULL,
  action      text NOT NULL,
  object_ref  text NOT NULL DEFAULT '',
  outcome     text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  value_hmac  bytea,
  prev_hash   bytea NOT NULL,
  hash        bytea NOT NULL,
  PRIMARY KEY (chain, seq)
);
CREATE INDEX vx_operate_audit_events_at ON vx_operate_audit_events (at);
CREATE INDEX vx_operate_audit_events_action ON vx_operate_audit_events (action, at);

CREATE TABLE vx_kms_keys (
  id          text PRIMARY KEY,
  scope       text NOT NULL,
  version     integer NOT NULL,
  wrapped     bytea NOT NULL,
  parent      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz,
  UNIQUE (scope, version)
);
