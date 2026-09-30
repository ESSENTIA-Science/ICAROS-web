# ICAROS CMS and Public Feature Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the split ICAROS web usable with local content and complete the requested CMS, vehicle, media, and publication features without changing production.

**Architecture:** `apps/web` renders published snapshots; `apps/cms` edits drafts; `services/api` owns validation, authenticated writes, and build publication. ESSENTIA Community remains the owner of new posts. Local preview reads only local PostgreSQL, and production publication remains a separate deployment gate.

**Tech Stack:** Next.js 16.3.2, React 19.2.8, TypeScript, Vite, PostgreSQL 17, AWS S3/CodeBuild/CloudFront, ESSENTIA backend.

**Spec:** User requests in this conversation, `ICAROS-web-architecture.md`, `docs/essentia-contract-gap.md`.

## Nine Request Groups and Owners

| # | Requested outcome | Owner | Current gate |
| --- | --- | --- | --- |
| 1 | Remove decorative Track/Crew labels and excess small copy | FE | Public components updated; visual review pending |
| 2 | Instagram entry above posts | FE | Already present in PostsListing |
| 3 | Member lead layout, biography, department assignment | FE + CMS + API | Public layout present; local department migration applied; authenticated runtime pending |
| 4 | Working posts and ESSENTIA board integration | ESSENTIA + API | Upstream isolated branch, CMS draft list/create UI, and HTTP adapter exist; publish sequence integration pending |
| 5 | Landing image/video panel add, remove, reorder | CMS + API | Forms and upload contract exist; durable media adapter pending |
| 6 | Editable donation round and amounts | CMS + API | Public label and settings exist; new CMS round editor pending API mapping |
| 7 | Vehicles: Rockets/Satellites/UAVs, series, gallery and optional GLB | FE + CMS + API | Public taxonomy/gallery/model renderer exist; editor persistence and upload pending |
| 8 | Visual polish and load speed | FE | Loader gate reduced; real-user performance measurement pending |
| 9 | PDF/video in posts and landing | FE + CMS + API + ESSENTIA | Click-to-load PDF/video display and upload contract exist; attachment storage and end-to-end publish pending |

Local loopback check after the DB build: homepage HTTP 200, 41,302 HTML bytes, about 3.5 ms TTFB; exported assets total about 16 MB, including 7.2 MB of referenced local media. These numbers are not a production or mobile performance measurement.

## Global Constraints

- Work locally on `refactor/static-site-split`; do not deploy, push, or migrate production.
- Never commit secrets, account identifiers, database dumps, or downloaded private media.
- Keep the public design recognizable; modify hierarchy and excess microcopy only where requested.
- Keep private member photos out of the public snapshot until an explicit publication policy exists.
- CMS saves into the ICAROS DB workspace; the public static site changes only after a successful site-wide build and promotion. The publish action explicitly releases all saved ICAROS changes in one snapshot. ESSENTIA posts require their separate upstream revision release.
- Preserve `legacy/` as rollback reference, and use `icaros` schema only.

## Review Focus

- Gallery and model assets must be scoped to their vehicle and absent if unpublished.
- A deleted department with members must require reassignment or an explicit unassigned outcome.
- Failed uploads or builds must leave the prior public version usable.
- Snapshot generation must reject missing referenced media and never read the operating DB in local preview.
- PDF and video must not be embedded as executable content or auto-load offscreen.

---

### Track A: Local preview and snapshot (controller; `scripts/**`, root docs/config)

- [x] Export current local DB content into a pinned, public-only FE snapshot.
- [x] Copy referenced public media into ignored local assets using `essentia` read access.
- [x] Serve the built FE on 5174 and a read-only local CMS view on 5175 with `dev.sh`.
- [x] Verify real local content, 404 behavior, CMS reads, and clean process shutdown.

### Track B: Public FE (FE orchestrator; `apps/web/src/**`)

- [x] Display all additional vehicle gallery images, with a real fallback when an image fails.
- [x] Offer optional per-vehicle GLB preview on explicit interaction; preserve photo-first loading.
- [x] Render safe post PDF/video attachments and a light landing video path.
- [ ] Refine excess small labels and test core page layouts with representative content.
- [ ] Measure loading and remove confirmed bottlenecks without changing the visual identity.

### Track C: CMS (CMS orchestrator; `apps/cms/**`)

- [ ] Add department CRUD and member reassignment UI, including delete conflict states.
- [ ] Add member, vehicle, taxonomy, gallery, and per-vehicle model editors.
- [ ] Add landing panel media CRUD/reordering and donation round/goal editing.
- [ ] Add post attachment upload/preview and publish status presentation.
- [ ] Verify local form behavior, typecheck, lint, and build.

### Track D: API and data (API orchestrator; `services/api/**`, separate migration files only)

- [ ] Implement local durable ICAROS content adapters with version checks and authorization.
- [ ] Add department, member, vehicle, panel, media, and donation validation/routes.
- [ ] Implement upload confirmation, reference checks, and public media export contract.
- [ ] Implement publication persistence and build callback plumbing with idempotency.
- [ ] Verify no unauthenticated mutation and no premature publication.

### Track E: ESSENTIA integration (separate repository and contract review)

- [x] Define scoped post write/revision/read-export contract with ESSENTIA backend.
- [x] Implement and test the upstream contract on an isolated branch if repository access permits.
- [ ] Wire ICAROS post adapter and test draft, publish, conflict, and retry behavior.

### Integration and release gate (controller)

- [ ] Reconcile shared contracts without parallel edits to the same file.
- [ ] Run workspace typecheck, lint, tests, fixture and local DB builds.
- [ ] Review media privacy, route export, and publication rollback behavior.
- [ ] Document remaining infrastructure steps; do not execute production migration or deployment.

### Verification snapshot (2026-09-30, local only)

- Local PostgreSQL has 6 department records, all 29 members assigned, and the publication/media schema additions from local-only migrations 001–003. The pre-import backup remains under ignored `docs/.local/`.
- Public snapshot contains 6 vehicles, 5 panels, 18 archived posts, 65 referenced media files, and 19 additional vehicle gallery images. No vehicle model row exists in this DB.
- `./dev.sh` serves 5174/5175/5176. Homepage and vehicle detail return 200; placeholder Community route returns 404. CMS preview reads all 6 departments and 29 assignments.
- Workspace typecheck/lint pass. Latest tests: CMS 47, FE 19, API 83. API and CMS production builds pass. Local PG checks covered optimistic update conflict, publication rollback, auth attempt reset, and media pending→ready inside rolled-back transactions.
- Current exported API handler remains fail-closed. Operating migrations, AWS deployment, ESSENTIA branch integration, and live performance measurement were not performed.
