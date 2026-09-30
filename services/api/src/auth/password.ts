import { verify } from '@node-rs/argon2'

/** Verify legacy Argon2id PHC hashes without exposing parse failures to callers. */
export async function verifyAdminPassword(hash: string, password: string): Promise<boolean> {
  if (!hash.startsWith('$argon2id$') || password.length === 0 || password.length > 1024) return false
  try { return await verify(hash, password) }
  catch { return false }
}
