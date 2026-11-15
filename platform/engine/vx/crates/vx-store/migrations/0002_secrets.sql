-- The secrets group (docs/0119, docs/0135 section 3). A value exists only as ciphertext, one row per
-- version. A handle is a single-use, short-lived, identity-bound permission to read named secrets;
-- only its hash is stored.

CREATE TABLE vx_secrets_secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project     text NOT NULL,
  environment text NOT NULL,
  path        text NOT NULL DEFAULT '/',
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project, environment, path, name)
);

CREATE TABLE vx_secrets_versions (
  secret_id   uuid NOT NULL REFERENCES vx_secrets_secrets (id) ON DELETE CASCADE,
  version     integer NOT NULL,
  key_version integer NOT NULL,
  sealed      bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  PRIMARY KEY (secret_id, version)
);

CREATE TABLE vx_secrets_handles (
  handle_hash bytea PRIMARY KEY,
  identity    text NOT NULL,
  purpose     text NOT NULL,
  refs        jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vx_secrets_handles_expiry ON vx_secrets_handles (expires_at);
