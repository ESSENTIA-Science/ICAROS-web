# ICAROS department migration and CMS API contract proposal

Status: design only. No migration in this package has been applied. Add the migration through the repository's migration runner after review. All objects belong to `icaros`; `public` remains untouched.

## Schema and backfill

Use a stable, opaque UUID for identity so renaming a department does not rewrite member rows. Keep `members.squad` temporarily for rollback and old readers, then remove it in a later migration after all readers use `department_id`.

```sql
CREATE TABLE icaros.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_name_ck CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT departments_name_uq UNIQUE (name),
  CONSTRAINT departments_sort_order_ck CHECK (sort_order >= 0)
);

INSERT INTO icaros.departments (name, sort_order)
SELECT DISTINCT btrim(squad), 0 FROM icaros.members
WHERE squad IS NOT NULL AND btrim(squad) <> '';

ALTER TABLE icaros.members ADD COLUMN department_id uuid;
UPDATE icaros.members AS m SET department_id = d.id
FROM icaros.departments AS d WHERE btrim(m.squad) = d.name;
ALTER TABLE icaros.members ADD CONSTRAINT members_department_id_fk
  FOREIGN KEY (department_id) REFERENCES icaros.departments(id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX members_department_id_idx ON icaros.members(department_id);
```

Review any existing `squad` values that differ only by whitespace before applying; the backfill intentionally trims them. Add a `CHECK (squad IS NULL OR btrim(squad) <> '')` only after old writers are gone. During transition, a member write should set `department_id` and mirror the selected department name into `squad` in one transaction for legacy readers. A department rename should update its `name` and all corresponding `members.squad` values in one transaction. After cutover, drop `squad` and stop mirroring. `department_id` stays nullable: this is the explicit **unassigned** state. Never infer it from a missing department row.

## Delete and reassignment transaction

For `DELETE /api/admin/content/departments/{id}`, require `If-Match` and a JSON body `{ "reassignTo": "<department UUID>" }` or `{ "reassignTo": null }` when members are attached. A bare delete of a populated department returns `409 DEPARTMENT_HAS_MEMBERS` with `memberCount`; there is no cascade. Lock the source department row and affected members in one transaction. Verify the source version and, if supplied, destination exists and differs from source. Update members' `department_id` and transition `squad` mirror, increment their versions, then delete source. A concurrent member assignment must serialize on the department row or be checked again before commit; the `RESTRICT` FK is the last defense. Return `409 VERSION_CONFLICT` or `409 DEPARTMENT_HAS_MEMBERS` as appropriate. Empty department deletion needs no reassignment.

Prefer an explicit bigint revision column on `departments` and `members` for `If-Match`; existing `updated_at` timestamps can be used only if every writer performs an atomic compare and changes the timestamp on each write. The current API validator accepts a six-digit timestamp version, while the existing legacy schema has only `updated_at` and old write paths may not update it. Align those paths before routing writes through the new API.

## Proposed CMS routes

The generic `GET /api/admin/content/{kind}`, `POST /api/admin/content/{kind}`, and `PUT|DELETE /api/admin/content/{kind}/{id}` router now accepts the named ICAROS kinds below. `site` remains nondeletable. The route is still unusable in the exported Lambda handler until durable readers/repositories are supplied. `media` currently has only the injected collection reader; its upload and deletion operations below are proposed. Every route requires an admin session; every mutation additionally requires an exact allowed `Origin`. Responses use `{ok:true,data}` or `{ok:false,message}` with `Cache-Control: private, no-store`. On writes, `If-Match` is required for update/delete. The returned `version` must be the version to send on the next write. A successful save has `publishState: "draft_saved"` and does not change the public snapshot. Collection records should consistently include `id`, `version`, `updatedAt` and, where applicable, `published`.

| Route | Methods | Data and constraints |
| --- | --- | --- |
| `/api/admin/content/departments` and `/{id}` | GET, POST, PUT, DELETE | `id`, `name`, `sortOrder`, `memberCount`, `version`; delete body as above. |
| `/api/admin/content/members` and `/{id}` | GET, POST, PUT, DELETE | `departmentId: UUID \| null`, profile fields, `imageMediaId`; changing department checks its existence. |
| `/api/admin/content/vehicle-types` and `/{id}` | GET, POST, PUT, DELETE | Stable slug, label, order; delete with children returns 409. |
| `/api/admin/content/rocket-series` and `/{id}` | GET, POST, PUT, DELETE | Stable ID, `typeId`, label, description and order; delete with vehicles returns 409. |
| `/api/admin/content/rockets` and `/{id}` | GET, POST, PUT, DELETE | Vehicle details, gallery media IDs, optional GLB model ID; media must be ready and scoped to vehicle. |
| `/api/admin/content/panels` and `/{id}` | GET, POST, PUT, DELETE | Required ready photo, copy, focal point, order, published flag; no arbitrary CTA URL. |
| `/api/admin/content/site/{key}` | GET, PUT | Donation goal/current/round are versioned site settings. Goal/current are decimal digit strings. |
| `/api/admin/media/presign` | POST | Validated MIME, size, owner entity; returns short-lived private PUT and pending media ID. |
| `/api/admin/media/{id}/confirm` | POST | Server HEAD verifies MIME and size; marks ready idempotently. Failed uploads remain private and cleanable. |
| `/api/admin/media/{id}` | DELETE | Reject referenced media; queue object cleanup only after DB unlink. |
| `/api/admin/publish` | POST | `{kind,id,version,idempotencyKey}`; snapshot export must validate references, output only public media and exclude member photos. |

Publication persists a unique idempotency key and monotonic version, stages a build, and promotes only on successful authenticated worker callback. A failed or stale callback leaves the prior public version active. The API package currently exposes interfaces for durable adapters but the Lambda handler remains fail-closed. Media upload and confirmation routes are not yet wired.

## ESSENTIA gap

The canonical `split/be` forum controller offers session-owned post create/edit/delete with no scoped ICAROS service identity, idempotency, record revision, staged draft, or read export without a view-count side effect. ICAROS cannot safely wire `EssentiaPostsAdapter` to those endpoints. Needed upstream: service-authenticated ICAROS post identity/scope; idempotent create and version-conditional update/delete; immutable published revision plus staged draft; promotion/rollback tied to a build version; and paginated read-only export that does not increment views. Keep post writes fail-closed until that contract exists.
