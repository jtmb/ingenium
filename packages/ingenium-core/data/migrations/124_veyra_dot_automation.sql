-- Allocated by coordinator. Additive metadata only; original resources/IDs remain intact.
-- Coordinator allocates the production migration. Apply only through the API database owner.
CREATE TABLE IF NOT EXISTS veyra_dot_records (
  kind TEXT NOT NULL CHECK(kind IN ('suggestion','followup','operation','notification')),
  id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS veyra_dot_scope ON veyra_dot_records(scope_key,kind,id);
CREATE UNIQUE INDEX IF NOT EXISTS veyra_dot_job_owner ON veyra_dot_records(json_extract(body,'$.jobId'))
WHERE kind='followup' AND json_extract(body,'$.state') != 'cancelled';
