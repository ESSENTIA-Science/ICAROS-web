import 'server-only'

/** 스토리지 계층 공개 표면. 전부 서버 전용이다. */

export { getS3Config, isStorageConfigured, type S3Config } from './config'
export { StorageError, type StorageErrorCode, describeError, redact } from './errors'
export {
  SNIFF_BYTES,
  etagMatches,
  isSameBucket,
  isUuid,
  quoteEtag,
  sniffMime,
  type SniffedMime,
} from './predicates'
export { buildObjectKey, assertBucketMatches, assertKeyReadable, assertKeyWritable, folderOfKey } from './keys'
export { presignPut } from './presign'
export {
  deleteObject,
  getObjectPrefix,
  getObjectStream,
  headObject,
  type ObjectHead,
  type ObjectStream,
} from './objects'
export { consumePresignQuota, presignQuotaKey } from './ratelimit'
export {
  confirmUpload,
  createUpload,
  getServableMedia,
  type ConfirmResult,
  type CreateUploadInput,
  type CreateUploadResult,
  type ServableMedia,
} from './media'
export {
  deleteMedia,
  enqueueCleanup,
  listAbandonedCleanupJobs,
  runCleanupJobs,
  sweepStalePendingUploads,
  type AbandonedCleanupJob,
  type CleanupRunResult,
  type DeleteMediaResult,
  type SweepResult,
} from './cleanup'
