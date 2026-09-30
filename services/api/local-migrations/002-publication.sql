-- LOCAL ONLY. Review through the repository migration process before deployment.
BEGIN;
CREATE TABLE icaros.publication_state (
  id integer PRIMARY KEY CHECK (id = 1),
  latest_version bigint CHECK (latest_version > 0),
  published_version bigint CHECK (published_version > 0),
  active_job_id text
);
INSERT INTO icaros.publication_state (id) VALUES (1);
CREATE TABLE icaros.publication_counter (
  id integer PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
INSERT INTO icaros.publication_counter (id) VALUES (1);
CREATE TABLE icaros.publication_allocations (
  idempotency_key text PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  version bigint NOT NULL UNIQUE CHECK (version > 0),
  kind text NOT NULL,
  record_id text NOT NULL,
  record_version text NOT NULL,
  source_revision text NOT NULL
);
CREATE TABLE icaros.publication_jobs (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE REFERENCES icaros.publication_allocations(idempotency_key),
  version bigint NOT NULL UNIQUE REFERENCES icaros.publication_allocations(version),
  snapshot_ref text NOT NULL,
  snapshot_sha256 char(64) NOT NULL,
  source_revision text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  status text NOT NULL CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
  error text
);
COMMIT;
