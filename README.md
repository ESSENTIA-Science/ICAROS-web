# ICAROS Web

This repository is being split into three independently deployable units:

| Path | Purpose |
| --- | --- |
| `apps/web` | Public Next.js static export from a pinned content snapshot |
| `apps/cms` | Static administrator editor and preview |
| `services/api` | Authenticated content and publication API for Lambda |
| `packages/contracts` | Shared TypeScript API and publish-state types |
| `legacy` | Preserved, buildable Next.js application and migrations |

The public `/missions` section records launch outcomes separately from `/posts`. Local development seeds the ICX-1A and RAON launch records from dated legacy articles; later Mission edits use their own records.

The architecture and migration stages are recorded in [`ICAROS-web-architecture.md`](ICAROS-web-architecture.md). The current production site remains on the legacy Next.js application. This branch is for local implementation and verification; production cutover, migration, and AWS changes require a separate decision.

## Local preview

```bash
npm ci
./dev.sh
```

Open the public site at `http://127.0.0.1:5174/` and CMS at `http://127.0.0.1:5175/admin/`. The script reads local PostgreSQL on 5435, starts local MinIO on 9010, downloads media referenced by published content with the `essentia` AWS profile, builds the static site, and starts the real API handler on 5176. CMS saves to the local DB; a successful local publish builds a versioned static release and switches the served release link. The generated local admin credentials are in ignored `docs/.local/admin-login.json`. No production DB or S3 write occurs. Press Ctrl+C to stop the servers. Run `node scripts/smoke-local-loop.mjs` in another terminal for the create→publish→HTML→cleanup check; see `docs/local-build-pipeline.md` for details.

The imported local development DB has the local-only migrations `services/api/local-migrations/001-departments-and-cms-versions.sql`, `002-publication.sql`, `003-media.sql`, and `004-missions.sql` applied. A fresh local import must apply them in order before `./dev.sh`. They create the department assignments, publication ledger, declared upload size, and independent Mission records in the `icaros` schema. These files are not operating DB migrations.

Use `npm run typecheck`, `npm run lint`, and `npm run test` at the workspace root after installing workspace dependencies. `npm run build:web:fixture` checks the public export with synthetic content. A real public build requires `ICAROS_SNAPSHOT` and its `ICAROS_SNAPSHOT_SHA256`; it must not silently publish a fixture or empty content. The archived application has independent `npm run legacy:typecheck`, `npm run legacy:lint`, and `npm run legacy:build` commands. A content edit becomes public only after its publish job successfully builds and releases new HTML. The CMS preview can display the saved draft earlier.
