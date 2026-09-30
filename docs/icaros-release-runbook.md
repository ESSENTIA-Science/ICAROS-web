# ICAROS static release: predeploy review

## Inputs to approve

1. Review the exact Git commit SHA (40 hex) for public FE source. Set the CodeBuild project Git source and allowed source version to that commit. The publication API must pass that same revision through `StartBuild.sourceVersion`.
2. Review the immutable S3 snapshot object `s3://<snapshot-bucket>/<key>/<sha256>.json` and independently compute its SHA-256. Object versioning or write-once policy must prevent replacement. The API passes the reference and SHA; CodeBuild rejects a byte mismatch.
3. Review the release bucket, CodeBuild project, KVS ARN, CloudFront distribution, and IAM policies outside this repository. Use placeholders in review artifacts. No production values belong in Git.

## AWS prerequisites

- Provision private release and snapshot S3 storage with encryption, versioning, and blocked public access. Give the CodeBuild role read access only to approved snapshot objects and write access only to its staging prefix. The publication API role reads staging, writes the immutable `releases/` prefix, starts and inspects the named CodeBuild project, and conditionally updates the one KVS key.
- Configure CodeBuild with a Node 22 image, Git, AWS CLI v2, `infra/buildspec.yml`, and `ICAROS_RELEASE_BUCKET=<bucket>` as a project variable. Ensure `CODEBUILD_RESOLVED_SOURCE_VERSION` and `CODEBUILD_BUILD_ID` are available. Disable builds that can silently checkout a branch head rather than the approved commit.
- Route terminal CodeBuild state change events for the approved project through EventBridge to the Lambda export `buildEventHandler`. Restrict Lambda invoke permission to that rule. The handler checks the event against `BatchGetBuilds`; successful builds still require a matching staged manifest and file hashes. Delivery should be retried on handler error.
- Configure the API Lambda with the variables in `services/api/README.md`. `PUBLIC_MEDIA_ORIGIN` must be a separate HTTPS CloudFront media origin serving the immutable S3 media keys; the public FE release router must not rewrite those URLs.
- Configure CloudFront S3 OAC, KVS association, and the viewer-request function in `infra/cloudfront/release-router.js` for public FE behavior. Configure distinct `/admin*` and `/api*` behaviors; test slashless paths too. Set `releasePrefix` in the API to `releases` and initialize KVS `release` to a previously validated release. Origin permissions or explicit missing-key handling must produce real 404. Do not turn missing routes into `/index.html` with status 200.
- Public media referenced by the snapshot must already exist at stable URLs. The build only stages the Next export; it does not publish media or the CMS bundle. Make sure the CloudFront origin and cache behavior deliver `404.html` with status 404, and review HTML cache TTL and invalidation strategy before switching the pointer. Cached old HTML can coexist briefly with new releases.

## Dry review and deployment sequence

1. Locally run `node --test infra/cloudfront/release-router.test.mjs`, `node --check infra/release/build.mjs`, `npm run typecheck`, `npm run lint`, and `npm run test`. Run `npm run build:web:fixture` only as a synthetic export check; it is not a production snapshot.
2. In a nonproduction AWS environment, invoke the publication flow with a pinned snapshot and approved revision. Confirm CodeBuild built that HEAD, the manifest contains `buildId`, `jobId`, `attempt`, `version`, `snapshotSha256`, `sourceRevision`, `stagingPrefix`, and all files with SHA-256, and `manifest.json` was uploaded last.
3. Before promotion, inspect `BatchGetBuilds` for `SUCCEEDED`, matching build ID, project, source revision, and exact six build overrides. Confirm the API validates the staged bytes and manifest digest. The callback alone is not evidence of build completion.
4. Verify root, nested pages, static assets, `/admin`, `/api`, deleted routes, and `/404` behavior against the candidate release. Review cache behavior and media URLs. Only then approve the release pointer update; the API should copy validated files to `releases/v<version>-<manifest-sha256>/` and conditionally update KVS `release`.
5. After activation, check the KVS value, representative pages, sitemap, and a removed slug returning 404. Record the release prefix and manifest SHA for rollback. Rollback is a reviewed KVS pointer update to a retained validated release, followed by cache handling as needed.

Production AWS provisioning, IAM grants, domain cutover, and first KVS pointer initialization remain external approval steps. No AWS operation is performed by these files until the CodeBuild project or CloudFront function is deployed.
