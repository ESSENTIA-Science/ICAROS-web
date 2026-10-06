# ICAROS static publishing speed implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten static publication while preserving byte verification, immutable asset reuse, retry safety, and one atomic public release switch.

**Architecture:** Build the same pinned Next.js export, then stage its files with one bounded S3 client instead of starting one AWS CLI process per file. In the API, validate and promote files with bounded I/O, keep the publication job reserved during that work, and use a short DB transaction only to record the result. The CloudFront KVS `release` key remains the sole public visibility switch.

**Tech Stack:** Node.js 22, Next.js 16 static export, AWS SDK for JavaScript v3, S3, CodeBuild, CloudFront KeyValueStore, PostgreSQL 17.

**Spec:** [Publishing architecture review and measured baseline](../../2026-10-04-publishing-architecture-review.md). This plan spans the `ICAROS-web` and sibling `ICAROS-api` repositories; neither repository is deployed by executing local tests.

## Evidence and architecture decisions

### Baseline and bottleneck

The 2026-10-04 production sample of seven successful CodeBuild jobs measured 366–371 staged files, a median 20.1 seconds for the Next.js build log segment, and a median 276.2 seconds between Next completion and staging completion. The existing `infra/release/build.mjs` starts a separate synchronous `aws s3 cp` process for each file after `prepareReleaseExport()`. This is the main suspected delay, though that 276.2-second segment includes shared-asset uploads and export preparation; phase timing must be added before assigning all of it to staging PUTs. The seven CodeBuild phase sums ranged from 319 to 484 seconds, median 387 seconds. See the spec for measurement boundaries.

The sibling API's `src/publication-runtime/aws.ts` then makes sequential `GetObject` calls for every manifest file in `read()`. `activate()` calls `read()` again, then sequentially downloads and uploads every file. `src/publish/index.ts` awaits `launcher.promote()` inside `repository.withLock()`, which holds a `publication_state` row lock throughout network I/O. One observed completion callback held that lock for about 46 seconds. The latter is a separate measured latency and availability problem, not part of the 278-second CodeBuild staging number.

### Official references and application to this repo

| Reference | Relevant fact | Decision here |
| --- | --- | --- |
| [AWS Prescriptive Guidance: React SPA on S3 and CloudFront](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-a-react-based-single-page-application-to-amazon-s3-and-cloudfront.html) | A closely related architecture uses S3 static assets, CloudFront, API Gateway, CloudWatch, and CloudFormation. | Keep the separate static site and API surfaces; change the slow release transport rather than the hosting model. |
| [AWS CodePipeline S3 deployment tutorial](https://docs.aws.amazon.com/codepipeline/latest/userguide/tutorials-s3deploy.html) | A standard static-site pipeline delivers build artifacts to S3, but the documented S3 deploy action leaves deleted objects behind. | Retain this repo's versioned release prefixes and explicit manifest; replacing the pipeline with a direct bucket sync would weaken deletion and rollback behavior. |
| [AWS CloudFront blue/green deployment reference](https://aws.amazon.com/blogs/networking-and-content-delivery/achieving-zero-downtime-deployments-with-amazon-cloudfront-using-blue-green-continuous-deployments/) | A staging distribution and controlled promotion keep an old version available while a new version is verified. | Preserve the same prepare-then-switch principle with the existing KVS release pointer; a second distribution is unnecessary for this file-upload bottleneck. |
| [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) | `output: 'export'` emits static HTML/CSS/JS under `out`. | Keep the current build and export preparation; optimize transport and promotion first. |
| [AWS CLI S3 transfer configuration](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html#max-concurrent-requests) | A single recursive `aws s3 cp` can transfer multiple files concurrently; default concurrency is 10. | Avoid the present per-file CLI startup. A recursive CLI upload is an alternative, but it loses the simple per-object SHA-256 and create-only contract needed for shared assets. Use one SDK client with a bounded queue. |
| [S3 performance design](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) | Parallel requests can increase throughput; S3 supports far more requests per prefix than this workload. | Start at 12 in-flight files, allow `ICAROS_UPLOAD_CONCURRENCY` only from 4–24, and measure. Do not assume 12 is optimal. |
| [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) | `If-None-Match: *` creates only if the key is absent; existing keys return 412, while concurrent conflicts may return 409. | Preserve conditional shared and release writes. Accept 412 only after exact existing-object verification; retry 409 with a bound. |
| [S3 upload integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html) and [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html) | S3 validates supplied checksums. A checksum-enabled HEAD can expose stored checksum, subject to permissions for encrypted objects. | Send precomputed SHA-256 with each PUT and retain byte SHA-256 validation for staged files and existing keys. Do not use ETag as SHA-256. |
| [S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel) | Completed PUTs and subsequent GET/HEAD requests are strongly consistent. | After every file upload settles successfully, write `manifest.json` last; no arbitrary visibility delay is needed. |
| [CloudFront KVS UpdateKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html) | Updates use an `If-Match` store ETag and are all-or-nothing. | Keep the single conditional `release` pointer update after the complete immutable release exists. |
| [CodeBuild cache](https://docs.aws.amazon.com/codebuild/latest/userguide/caching-s3.html) | Lockfile-keyed dependency caches are possible. | Defer cache configuration until phase timings show `npm ci` is material; the measured build itself is about 20 seconds. |

### Invariants

1. Verify the checked-out 40-character commit and content-addressed snapshot SHA-256 before building; use the same `prepareReleaseExport()` and manifest file hashes.
2. Shared `release-assets/<assetHash>/...` keys remain create-only. On 412, verify SHA-256, size, MIME, and immutable cache header before reuse. A 403, 409 after bounded retries, network error, or mismatch fails the build.
3. Stage every manifest-listed file under the attempt-specific prefix with the exact `exportContentType()` value. Send its known SHA-256 checksum; abort without publishing `manifest.json` if any upload fails. Partial staging can remain unreferenced for cleanup.
4. Preserve manifest schema and serialization, including `jobId`, `buildId`, `attempt`, `version`, `snapshotSha256`, `sourceRevision`, `stagingPrefix`, `assetHash`, and sorted `files`. Write `manifest.json` only after all file uploads and shared-asset checks succeed.
5. API verification checks CodeBuild identity, exact overrides, every staged file's bytes against its manifest SHA-256, required paths, and the manifest digest. Promotion writes an immutable `releases/v<version>-<manifest-sha256>/` tree with create-only semantics and validates existing keys on retry.
6. A committed promotion intent reserves the active job while S3 work runs without a DB row lock. A newer request may queue but cannot activate before the active job finishes. The final short transaction must confirm job ID and attempt; recovery after an ambiguous KVS or DB response must remain idempotent. Concurrent callbacks may do duplicate immutable work, but a failed KVS ETag update must reread the pointer: equality with the intended release is success, a different value is a conflict.
7. The only public change is conditional KVS `release` update after the release tree is complete. Failure at any earlier stage leaves the previous pointer intact. Keep old `/_release/<assetHash>/...` URLs valid for open tabs and rollback.

## File map

| File | Responsibility |
| --- | --- |
| `ICAROS-web/infra/release/upload-assets.mjs` | Shared immutable asset validation and bounded create-only uploads. |
| `ICAROS-web/infra/release/stage-files.mjs` (new) | Bounded staging PUTs from prepared manifest files; structured timing. |
| `ICAROS-web/infra/release/build.mjs` | Pinned build orchestration and manifest-last sequencing. |
| `ICAROS-web/infra/release/{upload-assets,stage-files}.test.mjs` | Fake S3 tests for concurrency, failures, metadata, and ordering. |
| `ICAROS-web/package.json`, `package-lock.json` | Pin `@aws-sdk/client-s3` for the CodeBuild process. |
| `ICAROS-api/src/publication-runtime/aws.ts` | Bounded staged validation and release copy with one verified manifest contract. |
| `ICAROS-api/src/publish/index.ts` | Short transactions around durable intent and final state; no S3/KVS call under `withLock`. |
| `ICAROS-api/test/{publication-aws,publish,publication-recovery,postgres-publication}.test.ts` | Byte, ordering, retry, supersession, and lock duration tests. |

## Global constraints

- No production deploy, DB migration, S3 mutation, KVS mutation, IAM change, or `main` push without separate approval.
- No operating identifiers or secrets in tracked files or test output.
- Keep the existing manifest and URL contracts so the current API and CloudFront router remain compatible.
- Preserve strict TypeScript, the pinned React 19.2.8 dependency, and the exact exported public routes.
- Do not replace byte SHA-256 checks with S3 ETag, object count, file size alone, or `aws s3 sync` timestamp comparison.
- All concurrency is bounded. A task rejection fails the entire stage; await or cancel remaining work before any manifest or pointer write.

## Review focus

1. Existing shared object with the right bytes but wrong MIME or cache header must fail (Task 1 test).
2. A late failure in one of many parallel uploads must leave `manifest.json` unwritten (Task 2 test).
3. A staged object changed between validation and promotion must never reach the public pointer (Task 3 test).
4. Duplicate completion callbacks and a newer queued publish must not reorder KVS activation (Task 4 test).
5. Successful KVS update followed by failed DB commit must resume without another release or stale rollback (Task 4 test).

---

### Task 1: Share one S3 client and bound immutable asset uploads

**Files:** Modify `infra/release/upload-assets.mjs`, `infra/release/upload-assets.test.mjs`, `package.json`, `package-lock.json`.

**Interfaces:** Export `async uploadSharedAssets({ root, bucket, assets, s3, concurrency = 12 })`; `s3` is an injected object with `send(command)`. Keep the asset key and metadata contract above. `build.mjs` constructs one `S3Client` with the CodeBuild role's default credentials and reuses it for Tasks 1–2.

- [ ] Add tests with an injected fake `send`: maximum active operations never exceeds 12; 412 verifies checksum, content length, MIME, and cache header; mismatch/403 fails; 409 retries only a fixed number of times.
- [ ] Run `node --test infra/release/upload-assets.test.mjs`; expect the new cases to fail before implementation.
- [ ] Implement a shared bounded worker utility in `upload-assets.mjs` or a focused `bounded-map.mjs`. Verify local bytes before `PutObjectCommand` with `IfNoneMatch: '*'` and `ChecksumSHA256`; on 412 use checksum-enabled `HeadObjectCommand` and exact metadata checks.
- [ ] Rerun the test; expect all cases to pass. Keep `sharedAssetPath()` and `assetHash` calculation unchanged.

### Task 2: Stage export files concurrently, then publish manifest

**Files:** Create `infra/release/stage-files.mjs`, `infra/release/stage-files.test.mjs`; modify `infra/release/build.mjs`.

**Interfaces:** Export `async stageFiles({ root, bucket, prefix, files, s3, concurrency = 12 })`. Input `files` is the already sorted `prepareReleaseExport().files`; each element is `{ path, sha256 }`. Return only when every PUT has settled successfully. Export `async publishStagedRelease({ uploadAssets, stage, putManifest })` as the small ordered orchestration seam; `build.mjs` supplies the real operations and unchanged manifest bytes.

- [ ] Test that each `PutObjectCommand` uses the manifest SHA-256, `exportContentType(path)`, and attempt-specific key; corrupt local bytes or one rejected PUT cannot produce a successful stage result. With a deferred last worker, assert `publishStagedRelease()` has not called `putManifest`; resolve it and assert the manifest call follows.
- [ ] Run `node --test infra/release/stage-files.test.mjs`; expect the new cases to fail.
- [ ] Implement bounded uploads with one S3 client, preflight local SHA-256 checks, and bounded SDK retries. Validate `ICAROS_UPLOAD_CONCURRENCY` as an integer from 4–24, default 12. Preserve the existing `files` array and manifest byte serialization. Add durations and counts for snapshot fetch, Next build, export preparation, shared assets, staging, and manifest PUT, without logging identifiers.
- [ ] Run `node --test infra/release/*.test.mjs`, `node --check infra/release/build.mjs`, `npm run typecheck`, and `npm run lint`; expect zero failures. With a synthetic export and fake S3, confirm a failed file never triggers the manifest PUT.

### Task 3: Bound API validation and release writes

**Files:** Modify sibling `ICAROS-api/src/publication-runtime/aws.ts`, `test/publication-aws.test.ts`.

**Interfaces:** Keep `BuildRuntime.readValidatedManifest(request)` and `activate(request, staged)` signatures. Add a private bounded mapper with limit 12. Validation returns only after all staged bytes match SHA-256. Activation rechecks the exact manifest digest, verifies each downloaded file before its conditional release PUT, validates existing release bytes on 412, and updates KVS only after all tasks succeed. Avoid holding all 371 files in memory: each worker owns one file buffer at a time.

- [ ] Test concurrency never exceeds 12; all file hashes are checked; malformed/missing file or failed GET/PUT prevents KVS update; 412 with divergent existing bytes fails; retry after a partial immutable release completes; manifest digest change fails. Simulate two callbacks racing at `UpdateKeys`: a lost ETag race succeeds only if rereading `release` finds the intended value.
- [ ] Run `npm test -- --test-name-pattern='publication'` in `ICAROS-api`, or the focused `node --import tsx --test test/publication-aws.test.ts`; expect the new cases to fail.
- [ ] Implement bounded `GetObject` validation in `read()` and bounded verify-then-`PutObject` in `activate()`. Eliminate the redundant full-tree `read()` inside `activate()` while retaining a manifest digest recheck and per-file SHA-256 before each release PUT. Keep `IfNoneMatch`, `ChecksumSHA256`, content type/cache policy, and current KVS ETag condition.
- [ ] Run focused tests, API `npm run typecheck`, and API `npm run lint`; expect zero failures.

### Task 4: Move network promotion outside the DB lock, preserve recovery

**Files:** Modify sibling `ICAROS-api/src/publish/index.ts`, `test/publish.test.ts`, `test/publication-recovery.test.ts`, `test/postgres-publication.test.ts`.

**Interfaces:** Keep `completeBuild()` public signature. `completeAttempt()` first commits `promotionStarted: true` under `withLock` after completion verification. It then calls `launcher.promote(job)` with no DB lock. A final `withLock` transaction checks the same active job ID and attempt and records `publishedVersion` and job status. Concurrent duplicate callbacks must coordinate via durable state, not an in-memory mutex; either one runs promotion or both safely converge on the same immutable release/KVS value.

- [ ] Test that `withLock` is not active while `promote()` waits; a status read and newer publish request proceed during promotion while the newer job stays queued; duplicate completions converge; a failed promote retains the reserved attempt for recovery; KVS success with a failed final DB transaction is idempotently completed on retry.
- [ ] Run focused publication and recovery tests; expect the new cases to fail.
- [ ] Change `completeAttempt()` in three phases: short intent transaction, network promotion, short final transaction. Retain the existing stale-version check before intent and only clear `activeJobId` after successful activation. Update comments that currently require holding the lock for the whole callback.
- [ ] Run `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build` in `ICAROS-api`; expect zero failures.

### Task 5: Measure against the same production shape before release approval

**Files:** Modify `docs/icaros-release-runbook.md` and the sibling API runbook if it documents callback timing.

- [ ] In a nonproduction AWS environment, use a reviewed snapshot and 371-file-equivalent export. Record `npm ci`, Next build, export preparation, shared assets, staging, API validation, API promotion, KVS update, total latency, S3 errors/retries, and peak API memory. Compare with the 20-second build, 278-second staging, and 46-second callback baseline; treat these as measurements, not a promised speedup.
- [ ] Exercise cold publish, identical-asset republish, one injected upload error, duplicate completion event, partial release retry, queued newer version, and KVS conflict. Confirm no manifest/pointer on incomplete data and that the previous public release remains readable.
- [ ] Update the runbook with observed timings and rollback checks. Present results and deployment diff for separate operational approval; do not modify production resources during this plan's implementation or verification.
