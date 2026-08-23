import 'server-only'

/** 스토리지 계층 공개 표면. 전부 서버 전용이다. */

export { getS3Config, isStorageConfigured, type S3Config } from './config'
export { StorageError, type StorageErrorCode, describeError, redact } from './errors'
export { buildObjectKey, assertKeyReadable, assertKeyWritable, folderOfKey } from './keys'
export { presignGet, presignPut, type PresignGetOptions } from './presign'
export { deleteObject, headObject, type ObjectHead } from './objects'
export {
  confirmUpload,
  createUpload,
  getServableMedia,
  isUuid,
  type ConfirmResult,
  type CreateUploadInput,
  type CreateUploadResult,
  type ServableMedia,
} from './media'
export {
  deleteMedia,
  enqueueCleanup,
  runCleanupJobs,
  sweepStalePendingUploads,
  type CleanupRunResult,
  type DeleteMediaResult,
  type SweepResult,
} from './cleanup'
