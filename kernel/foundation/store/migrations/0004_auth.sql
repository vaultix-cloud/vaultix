-- Owned kernel authentication. No adoption of inherited auth tables: a collision fails migration.
-- The singleton is populated by the operator's setup-code command, not by migration, so an empty
-- migrated database remains an empty restore target.
CREATE TABLE vx_auth_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initialized boolean NOT NULL DEFAULT false,
  setup_hash bytea,
  setup_expires_at timestamptz,
  organization_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_name text,
  window_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE vx_auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_owner boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX vx_auth_one_owner ON vx_auth_users (is_owner) WHERE is_owner;
CREATE TABLE vx_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES vx_auth_users(id),
  bearer_hash bytea NOT NULL UNIQUE,
  method text NOT NULL CHECK (method = 'password'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vx_auth_sessions_expiry ON vx_auth_sessions(expires_at);
CREATE TABLE vx_auth_scope_grants (
  user_id uuid NOT NULL REFERENCES vx_auth_users(id),
  project text NOT NULL,
  environment text NOT NULL,
  action text NOT NULL,
  PRIMARY KEY (user_id, project, environment, action)
);
