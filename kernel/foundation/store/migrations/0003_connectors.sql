-- The connectors group (docs/0139). A connection holds a destination's credentials as one sealed document: the
-- database never sees them in the clear, and no read returns them except the single function that opens them for a sync.
-- A sync says which secrets (project, environment, path) go to which destination, and under which key schema.

CREATE TABLE vx_connectors_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project     text NOT NULL,
  kind        text NOT NULL,
  name        text NOT NULL,
  key_version integer NOT NULL,
  sealed      bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  UNIQUE (project, name)
);

CREATE TABLE vx_connectors_syncs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project       text NOT NULL,
  connection_id uuid NOT NULL REFERENCES vx_connectors_connections (id) ON DELETE CASCADE,
  environment   text NOT NULL,
  path          text NOT NULL DEFAULT '/',
  destination   jsonb NOT NULL,
  key_schema    text NOT NULL DEFAULT '{{secretKey}}',
  keep_removed  boolean NOT NULL DEFAULT false,
  last_status   text,
  last_run_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  UNIQUE (connection_id, environment, path, destination)
);
CREATE INDEX vx_connectors_syncs_project ON vx_connectors_syncs (project);
