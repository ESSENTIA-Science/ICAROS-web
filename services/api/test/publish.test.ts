import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicationService, type PublicationJob, type PublicationRepository, type PublicationState } from '../src/publish/index.js';

function fixture() {
  const jobs = new Map<string, PublicationJob>();
  const state: PublicationState = { latestVersion: null, publishedVersion: null, activeJobId: null };
  const launches: Array<{ id: string; attempt: number }> = [];
  const promotions: string[] = [];
  let allowed = true;
  let workerAllowed = true;
  let promotionFails = false;
  let locked = false;
  const repository: PublicationRepository = {
    async withLock(operation) {
      assert.equal(locked, false);
      locked = true;
      try {
        return await operation({
          getState: async () => ({ ...state }),
          saveState: async (next) => { Object.assign(state, next); },
          getJob: async (id) => jobs.get(id) ?? null,
          getByKey: async (key) => [...jobs.values()].find((job) => job.idempotencyKey === key) ?? null,
          listJobs: async () => [...jobs.values()],
          saveJob: async (job) => { jobs.set(job.id, { ...job }); },
        });
      } finally { locked = false; }
    },
  };
  const service = createPublicationService({
    requireAdmin: async () => { if (!allowed) throw new Error('denied'); },
    requireBuildWorker: async () => { if (!workerAllowed) throw new Error('worker denied'); },
    repository,
    launcher: {
      launch: async (job) => { launches.push({ id: job.id, attempt: job.attempt }); },
      promote: async (job) => { if (promotionFails) throw new Error('promotion error'); promotions.push(job.id); },
    },
    newId: (() => { let n = 0; return () => `job-${++n}`; })(),
  });
  return { service, jobs, state, launches, promotions, deny: () => { allowed = false; }, denyWorker: () => { workerAllowed = false; }, failPromotion: () => { promotionFails = true; } };
}

const request = { token: 'admin-request' };
const input = (version: number, key = `key-${version}`) => ({ version, idempotencyKey: key, snapshotRef: `snap-${version}`, snapshotSha256: 'a'.repeat(64), sourceRevision: 'web-sha' });

test('authorization precedes input validation and repository mutation', async () => {
  const f = fixture();
  f.deny();
  await assert.rejects(f.service.requestPublish(request, input(0)), /denied/);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.state.latestVersion, null);
});

test('idempotency returns original job and rejects key reuse with different content', async () => {
  const f = fixture();
  const first = await f.service.requestPublish(request, input(1));
  assert.equal((await f.service.requestPublish(request, input(1))).id, first.id);
  assert.equal(f.launches.length, 1);
  await assert.rejects(f.service.requestPublish(request, input(2, 'key-1')), /IDEMPOTENCY_CONFLICT/);
});

test('newer version waits, and completed stale build is never promoted', async () => {
  const f = fixture();
  const old = await f.service.requestPublish(request, input(1));
  const next = await f.service.requestPublish(request, input(2));
  assert.deepEqual(f.launches.map((x) => x.id), [old.id]);
  assert.equal((await f.service.completeBuild(request, old.id, 1)).status, 'failed');
  assert.deepEqual(f.promotions, []);
  assert.deepEqual(f.launches.map((x) => x.id), [old.id, next.id]);
  assert.equal((await f.service.completeBuild(request, next.id, 1)).status, 'published');
  assert.deepEqual(f.promotions, [next.id]);
  assert.equal(f.state.publishedVersion, 2);
});

test('only the newest queued version is launched after the active build settles', async () => {
  const f = fixture();
  const first = await f.service.requestPublish(request, input(1));
  const middle = await f.service.requestPublish(request, input(2));
  const latest = await f.service.requestPublish(request, input(3));
  await f.service.completeBuild(request, first.id, 1);
  assert.deepEqual(f.launches.map((entry) => entry.id), [first.id, latest.id]);
  assert.equal((await f.service.getJob(middle.id))?.status, 'failed');
  assert.equal((await f.service.getJob(middle.id))?.error, 'superseded');
});

test('failure preserves published version and retry creates a new attempt', async () => {
  const f = fixture();
  const first = await f.service.requestPublish(request, input(1));
  await f.service.completeBuild(request, first.id, 1);
  const second = await f.service.requestPublish(request, input(2));
  assert.equal((await f.service.failBuild(request, second.id, 1)).status, 'failed');
  assert.equal(f.state.publishedVersion, 1);
  const retry = await f.service.retry(request, second.id);
  assert.equal(retry.status, 'publishing');
  assert.equal(retry.attempt, 2);
  assert.equal((await f.service.completeBuild(request, second.id, 1)).status, 'publishing');
  await f.service.completeBuild(request, second.id, 2);
  assert.equal(f.state.publishedVersion, 2);
});

test('invalid version and snapshot are rejected without a write', async () => {
  const f = fixture();
  await assert.rejects(f.service.requestPublish(request, input(0)), /INVALID_INPUT/);
  await assert.rejects(f.service.requestPublish(request, { ...input(1), snapshotRef: '' }), /INVALID_INPUT/);
  assert.equal(f.jobs.size, 0);
});

test('launch failure is recorded and later retry launches a new attempt', async () => {
  const jobs = new Map<string, PublicationJob>();
  const state: PublicationState = { latestVersion: null, publishedVersion: null, activeJobId: null };
  const service = createPublicationService({
    requireAdmin: async () => undefined,
    requireBuildWorker: async () => undefined,
    newId: () => 'one',
    repository: { withLock: async (operation) => operation({
      getState: async () => ({ ...state }),
      saveState: async (next) => { Object.assign(state, next); },
      getJob: async (id) => jobs.get(id) ?? null,
      getByKey: async (key) => [...jobs.values()].find((job) => job.idempotencyKey === key) ?? null,
      listJobs: async () => [...jobs.values()],
      saveJob: async (job) => { jobs.set(job.id, { ...job }); },
    }) },
    launcher: {
      launch: async (job) => { if (job.attempt === 1) throw new Error('remote unavailable'); },
      promote: async () => undefined,
    },
  });
  const failed = await service.requestPublish(request, input(1));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'launch failed');
  assert.equal(state.activeJobId, null);
  const retried = await service.retry(request, failed.id);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.status, 'publishing');
});

test('duplicate completion cannot promote twice', async () => {
  const f = fixture();
  const job = await f.service.requestPublish(request, input(1));
  await f.service.completeBuild(request, job.id, 1);
  await f.service.completeBuild(request, job.id, 1);
  assert.deepEqual(f.promotions, [job.id]);
});

test('worker denial precedes completion mutation', async () => {
  const f = fixture();
  const job = await f.service.requestPublish(request, input(1));
  f.denyWorker();
  await assert.rejects(f.service.completeBuild(request, job.id, 1), /worker denied/);
  assert.equal((await f.service.getJob(job.id))?.status, 'publishing');
  assert.equal(f.promotions.length, 0);
});

test('promotion failure leaves published version unchanged and permits retry', async () => {
  const f = fixture();
  const old = await f.service.requestPublish(request, input(1));
  await f.service.completeBuild(request, old.id, 1);
  const next = await f.service.requestPublish(request, input(2));
  f.failPromotion();
  assert.equal((await f.service.completeBuild(request, next.id, 1)).status, 'failed');
  assert.equal(f.state.publishedVersion, 1);
  assert.equal(f.state.activeJobId, null);
});
