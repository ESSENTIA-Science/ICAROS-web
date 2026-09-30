/** Publication orchestration only. The host supplies durable storage, authorization and a remote build runner. */
export type PublicationStatus = 'draft' | 'publishing' | 'published' | 'failed';

export interface PublicationJob {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly version: number;
  readonly snapshotRef: string;
  readonly snapshotSha256: string;
  readonly sourceRevision: string;
  readonly attempt: number;
  readonly status: PublicationStatus;
  readonly error: string | null;
}

export interface PublicationState {
  readonly latestVersion: number | null;
  readonly publishedVersion: number | null;
  readonly activeJobId: string | null;
}

export interface PublicationSession {
  getState(): Promise<PublicationState>;
  saveState(state: PublicationState): Promise<void>;
  getJob(id: string): Promise<PublicationJob | null>;
  getByKey(idempotencyKey: string): Promise<PublicationJob | null>;
  listJobs(): Promise<readonly PublicationJob[]>;
  saveJob(job: PublicationJob): Promise<void>;
}

/**
 * A production adapter MUST use durable storage and an exclusive cross-process lock.
 * Lock scope includes the entire callback, including promote(). Writes must be visible
 * in order before releasing the lock. Enforce a unique constraint on idempotencyKey.
 * Never implement this with a process-local mutex in Lambda.
 */
export interface PublicationRepository {
  withLock<T>(operation: (session: PublicationSession) => Promise<T>): Promise<T>;
}

/**
 * launch only builds and stages versioned output; it must not change public routing.
 * promote atomically activates a fully validated staged build, preserving the old
 * public version on failure. The repository lock serializes it with newer requests.
 * Neither method runs Next.js inside the API process.
 */
export interface BuildLauncher {
  launch(job: PublicationJob): Promise<void>;
  promote(job: PublicationJob): Promise<void>;
}

export interface PublishInput {
  readonly idempotencyKey: string;
  readonly version: number;
  readonly snapshotRef: string;
  readonly snapshotSha256: string;
  readonly sourceRevision: string;
}

export interface PublicationDependencies<Request> {
  readonly requireAdmin: (request: Request) => Promise<unknown>;
  readonly requireBuildWorker: (request: Request) => Promise<unknown>;
  readonly repository: PublicationRepository;
  readonly launcher: BuildLauncher;
  readonly newId: () => string;
}

export class PublicationError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'IDEMPOTENCY_CONFLICT' | 'VERSION_CONFLICT' | 'NOT_FOUND' | 'RETRY_CONFLICT') {
    super(code);
    this.name = 'PublicationError';
  }
}

function validate(input: PublishInput): void {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 1 ||
      typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200 ||
      typeof input.snapshotRef !== 'string' || !input.snapshotRef.trim() ||
      typeof input.snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotSha256) ||
      typeof input.sourceRevision !== 'string' || !input.sourceRevision.trim() ||
      input.snapshotRef.length > 2048 || input.sourceRevision.length > 200) {
    throw new PublicationError('INVALID_INPUT');
  }
}

/** The host must authenticate both administrator writes and worker callbacks. */
export function createPublicationService<Request>(deps: PublicationDependencies<Request>) {
  const { repository, launcher } = deps;

  async function startNext(): Promise<void> {
    const candidate = await repository.withLock(async (session) => {
      const state = await session.getState();
      if (state.activeJobId !== null) return null;
      const jobs = await session.listJobs();
      const draft = jobs.filter((job) => job.status === 'draft').sort((a, b) => b.version - a.version);
      const latest = draft[0];
      if (!latest) return null;
      for (const stale of draft.slice(1)) {
        await session.saveJob({ ...stale, status: 'failed', error: 'superseded' });
      }
      const running: PublicationJob = { ...latest, status: 'publishing', attempt: latest.attempt + 1, error: null };
      await session.saveJob(running);
      await session.saveState({ ...state, activeJobId: running.id });
      return running;
    });
    if (!candidate) return;
    try {
      await launcher.launch(candidate);
    } catch {
      await recordFailure(candidate.id, candidate.attempt, 'launch failed');
    }
  }

  async function requestPublish(request: Request, input: PublishInput): Promise<PublicationJob> {
    await deps.requireAdmin(request); // The first mutation operation, before validation or storage.
    validate(input);
    const job = await repository.withLock(async (session) => {
      const existing = await session.getByKey(input.idempotencyKey);
      if (existing) {
        if (existing.version !== input.version || existing.snapshotRef !== input.snapshotRef ||
            existing.snapshotSha256 !== input.snapshotSha256 ||
            existing.sourceRevision !== input.sourceRevision) throw new PublicationError('IDEMPOTENCY_CONFLICT');
        return existing;
      }
      const state = await session.getState();
      if (state.latestVersion !== null && input.version <= state.latestVersion) {
        throw new PublicationError('VERSION_CONFLICT');
      }
      const created: PublicationJob = {
        id: deps.newId(), idempotencyKey: input.idempotencyKey,
        version: input.version, snapshotRef: input.snapshotRef, snapshotSha256: input.snapshotSha256,
        sourceRevision: input.sourceRevision, attempt: 0, status: 'draft', error: null,
      };
      await session.saveJob(created);
      await session.saveState({ ...state, latestVersion: input.version });
      return created;
    });
    await startNext();
    return (await getJob(job.id)) ?? job;
  }

  async function retry(request: Request, jobId: string): Promise<PublicationJob> {
    await deps.requireAdmin(request);
    const job = await repository.withLock(async (session) => {
      const found = await session.getJob(jobId);
      if (!found) throw new PublicationError('NOT_FOUND');
      const state = await session.getState();
      if (found.status !== 'failed' || found.version !== state.latestVersion) {
        throw new PublicationError('RETRY_CONFLICT');
      }
      const queued: PublicationJob = { ...found, status: 'draft', error: null };
      await session.saveJob(queued);
      return queued;
    });
    await startNext();
    return (await getJob(job.id)) ?? job;
  }

  async function completeBuild(request: Request, jobId: string, attempt: number): Promise<PublicationJob> {
    await deps.requireBuildWorker(request);
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new PublicationError('INVALID_INPUT');
    const completed = await repository.withLock(async (session) => {
      const job = await session.getJob(jobId);
      if (!job) throw new PublicationError('NOT_FOUND');
      const state = await session.getState();
      if (state.activeJobId !== jobId || job.status !== 'publishing' || job.attempt !== attempt) return job;
      if (job.version !== state.latestVersion) {
        const stale: PublicationJob = { ...job, status: 'failed', error: 'superseded' };
        await session.saveJob(stale);
        await session.saveState({ ...state, activeJobId: null });
        return stale;
      }
      try {
        await launcher.promote(job);
      } catch {
        const failed: PublicationJob = { ...job, status: 'failed', error: 'promotion failed' };
        await session.saveJob(failed);
        await session.saveState({ ...state, activeJobId: null });
        return failed;
      }
      const published: PublicationJob = { ...job, status: 'published', error: null };
      await session.saveJob(published);
      await session.saveState({ ...state, activeJobId: null, publishedVersion: job.version });
      return published;
    });
    await startNext();
    return completed;
  }

  async function failBuild(request: Request, jobId: string, attempt: number): Promise<PublicationJob> {
    await deps.requireBuildWorker(request);
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new PublicationError('INVALID_INPUT');
    return recordFailure(jobId, attempt, 'build failed');
  }

  async function recordFailure(jobId: string, attempt: number, reason: 'launch failed' | 'build failed'): Promise<PublicationJob> {
    const failed = await repository.withLock(async (session) => {
      const job = await session.getJob(jobId);
      if (!job) throw new PublicationError('NOT_FOUND');
      const state = await session.getState();
      if (state.activeJobId !== jobId || job.status !== 'publishing' || job.attempt !== attempt) return job;
      const next: PublicationJob = { ...job, status: 'failed', error: reason };
      await session.saveJob(next);
      await session.saveState({ ...state, activeJobId: null });
      return next;
    });
    await startNext();
    return failed;
  }

  async function getJob(id: string): Promise<PublicationJob | null> {
    return repository.withLock((session) => session.getJob(id));
  }

  async function getState(): Promise<PublicationState> {
    return repository.withLock((session) => session.getState());
  }

  return { requestPublish, retry, completeBuild, failBuild, getJob, getState };
}
