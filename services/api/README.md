# ICAROS CMS API

`src/handler.ts` is the API Gateway HTTP API v2 Lambda entry. It composes Postgres authentication, content, department, donation, vehicle media, S3 upload, ESSENTIA posts, and publication adapters. `buildEventHandler` is a separate Lambda export for an EventBridge **CodeBuild Build State Change** rule. Neither export deploys itself.

## Local development

From the repository root, run `./dev.sh`. It starts the real handler on `127.0.0.1:5176`, CMS on 5175, local Postgres on 5435, and MinIO on 9010. Local mode requires the DB and S3 endpoint to be loopback. `node scripts/smoke-real-handler.mjs` checks authenticated reads; `node scripts/smoke-local-loop.mjs` checks save → publish → static HTML → cleanup. The old preview API remains available with `ICAROS_API_RUNTIME=demo`; it is not the Lambda runtime.

The real handler was exercised locally for login/session, mission create/update/delete, media presign/PUT/confirm, vehicle gallery attach/restore, donation update/restore, and a complete mission publish into static HTML with cleanup. Production AWS, EC2 PostgreSQL, and ESSENTIA were not contacted by those checks.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | EC2 PostgreSQL URL; API role has only `icaros` schema permissions |
| `DB_CA_BUNDLE_PATH` | CA bundle for verified PostgreSQL TLS outside local mode |
| `ADMIN_ALLOWED_ORIGINS` | Comma separated exact HTTPS CMS origins |
| `ESSENTIA_SERVICE_ORIGIN`, `ESSENTIA_SERVICE_TOKEN`, `ESSENTIA_SERVICE_CATEGORY`, `ESSENTIA_AUTHOR_LABEL` | Scoped Community posts adapter; all four are required for post read/write and publication |
| `S3_BUCKET`, `S3_PREFIX` | Private media and release bucket and media key prefix |
| `PUBLIC_MEDIA_ORIGIN` | Separate HTTPS CloudFront media origin; points to immutable media object keys |
| `WEB_SOURCE_REVISION` | Approved 40 character FE Git SHA |
| `CODEBUILD_PROJECT`, `CLOUDFRONT_KVS_ARN` | Build project and release pointer store |
| `BUILD_WORKER_TOKEN` | Private `/api/internal/publish/*` callback authentication |

Missing production publication settings leave content edits available but make `/api/admin/publish` return 503. Production publication also rejects `S3_ENDPOINT`. `API_LOCAL=1` uses a separate local build and atomic symlink promoter, and is restricted to loopback Postgres port 5435 and a loopback S3 endpoint. The Postgres pool is capped at three connections per Lambda environment.

## Content and release contract

Admin routes require a session; mutations require an exact trusted Origin and `If-Match` where applicable. Responses are JSON with `Cache-Control: private, no-store`. CMS content routes include site settings, panels, vehicles, taxonomy, departments, members, missions, donation rounds, and ESSENTIA posts. Private uploads use `/api/admin/media/presign` → presigned PUT → `/api/admin/media/confirm`. Vehicle galleries and models use `GET/PUT /api/admin/content/vehicles/{id}/gallery|model` with version checks. Donation rounds use `GET /api/admin/content/donation-rounds` and `PUT /api/admin/content/donation-rounds/current`, updating the three existing `site_settings` values atomically.

Saving an ICAROS record changes the DB workspace. `POST /api/admin/publish` validates the selected record version, allocates a site wide version, exports an ICAROS + ESSENTIA public snapshot to immutable S3, and starts CodeBuild. A post publish first promotes the ESSENTIA draft revision; a later build failure can temporarily leave ESSENTIA ahead of ICAROS and requires retry. `buildEventHandler` checks the EventBridge event against the durable CodeBuild record, then the publication service verifies the staged manifest and files before conditionally switching the CloudFront KVS `release` pointer. A failed build leaves the previous public release in place.

`infra/buildspec.yml`, `infra/cloudfront/release-router.js`, and `docs/icaros-release-runbook.md` define the remaining AWS setup and release checks. The ESSENTIA service API changes currently live in a separate local branch and must be integrated and deployed by its owner before ICAROS post publication can work. No production migration or deployment was performed here.
