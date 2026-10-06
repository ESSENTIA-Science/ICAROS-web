# ICAROS static site split implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for scoped implementation and review.

**Goal:** Preserve the current application in `legacy/` and begin the FE, CMS, and API split without changing the public visual design.

**Architecture:** `apps/web` exports public HTML from a versioned content snapshot. `apps/cms` is a static editing UI. `services/api` owns authenticated writes and publication orchestration. `packages/contracts` carries shared request and content shapes. The existing Next.js application remains independently buildable under `legacy/`.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript, Vite, Drizzle/pg, AWS S3/CloudFront/API Gateway/Lambda/CodeBuild.

**Spec:** `ICAROS-web-architecture.md`

## Global Constraints

- Preserve the current public design and Korean copy.
- Preserve all current local changes and never move local secrets, `.git`, `node_modules`, or build outputs into `legacy/`.
- Keep React exactly 19.2.8 and maintain strict TypeScript.
- Do not deploy, migrate production data, push, or modify operating AWS resources.
- Public HTML must be built from a pinned snapshot; an unavailable snapshot must fail the build.
- CMS writes require server-side authorization; public routes are read-only.

## Review Focus

- A missing snapshot must fail rather than publish empty HTML.
- Unpublished content and private member media must not enter public output.
- Unknown/deleted slugs must produce real 404 responses.
- Publish retries must not duplicate writes or let older builds replace newer output.
- Existing uncommitted files must be preserved in `legacy/` or at the root as appropriate.

---

### Task 1: Archive current application

**Files:** Move tracked application files to `legacy/`; keep root repository instructions and active planning docs at root.

- [x] Record the baseline commit and dirty paths.
- [x] Move source, assets, application configuration, migrations, and scripts into `legacy/`.
- [x] Document how to run and build the archived application.
- [x] Verify archived file coverage and run its typecheck/lint.

### Task 2: Public FE

**Files:** `apps/web/**` only.

- [x] Copy the current public visual structure and styles from `legacy/`.
- [x] Write a failing check for required snapshot input and explicit route enumeration.
- [x] Render static home, vehicles, members, and posts from a pinned snapshot.
- [ ] Compare rendered core views against the live legacy design with representative production content (fixture build passed; visual parity remains unverified).

### Task 3: CMS

**Files:** `apps/cms/**` only.

- [x] Write failing checks for API client error handling and publish-state behavior.
- [x] Build static login, editor, preview, and publish status UI using existing admin patterns.
- [x] Verify build and typecheck.

### Task 4: API

**Files:** `services/api/**` only.

- [x] Write failing checks for authorization, input validation, and publish idempotency.
- [x] Implement Lambda-facing HTTP entry and isolated content/publication services.
- [x] Verify tests, bundle, and typecheck without contacting production DB.

### Task 5: Integration

**Files:** Root workspace configuration, `packages/contracts/**`, integration scripts and docs.

- [x] Define stable FE snapshot and CMS/API contracts.
- [x] Wire root workspace checks, keeping `legacy/` out of active builds.
- [x] Run FE, CMS, API checks and inspect public route output.
- [x] Record missing external ESSENTIA/AWS dependencies and deployment gates.
