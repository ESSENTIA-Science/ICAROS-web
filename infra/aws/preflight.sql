-- READ ONLY. Execute through an already authorized connection; do not print endpoints/credentials.
BEGIN TRANSACTION READ ONLY;
SHOW ssl;
SELECT ssl AS this_connection_uses_tls
FROM pg_stat_ssl WHERE pid = pg_backend_pid();

-- Presence plus runtime DML is distinct from schema/table ownership or migration privileges.
WITH required(name) AS (
  VALUES ('admin_users'), ('admin_sessions'), ('departments'), ('member_departments'), ('missions'),
    ('publication_state'), ('publication_jobs'), ('publication_counter'),
    ('publication_allocations'), ('members'), ('media'), ('page_panels'),
    ('site_settings'), ('rockets'), ('vehicle_types'), ('rocket_series')
)
SELECT name, to_regclass('icaros.' || name) IS NOT NULL AS present,
  CASE WHEN to_regclass('icaros.' || name) IS NOT NULL
    THEN has_table_privilege(current_user, 'icaros.' || name, 'SELECT') ELSE false END AS can_read,
  CASE WHEN to_regclass('icaros.' || name) IS NOT NULL
    THEN has_table_privilege(current_user, 'icaros.' || name, 'INSERT') ELSE false END AS can_insert,
  CASE WHEN to_regclass('icaros.' || name) IS NOT NULL
    THEN has_table_privilege(current_user, 'icaros.' || name, 'UPDATE') ELSE false END AS can_update,
  CASE WHEN to_regclass('icaros.' || name) IS NOT NULL
    THEN has_table_privilege(current_user, 'icaros.' || name, 'DELETE') ELSE false END AS can_delete
FROM required ORDER BY name;

SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
SELECT has_schema_privilege(current_user, 'icaros', 'USAGE') AS schema_usage,
  has_schema_privilege(current_user, 'icaros', 'CREATE') AS runtime_can_create_in_icaros,
  has_schema_privilege(current_user, 'public', 'CREATE') AS runtime_can_create_in_public;
COMMIT;
