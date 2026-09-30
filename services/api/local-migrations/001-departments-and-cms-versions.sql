-- LOCAL ONLY. Review and convert into the repository migration runner before any deployment.
-- Applies to an existing local icaros schema; never touches public.
BEGIN;
CREATE TABLE icaros.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO icaros.departments (name, sort_order)
SELECT DISTINCT btrim(squad), 0 FROM icaros.members
WHERE squad IS NOT NULL AND btrim(squad) <> '';
ALTER TABLE icaros.members ADD COLUMN department_id uuid;
UPDATE icaros.members AS m SET department_id = d.id
FROM icaros.departments AS d WHERE btrim(m.squad) = d.name;
ALTER TABLE icaros.members ADD CONSTRAINT members_department_id_fk
  FOREIGN KEY (department_id) REFERENCES icaros.departments(id) ON DELETE RESTRICT;
CREATE INDEX members_department_id_idx ON icaros.members(department_id);
COMMIT;
