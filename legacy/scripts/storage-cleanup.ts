/**
 * 스토리지 정리를 수동으로 한 번 돌린다. cron 이 붙기 전/장애 시 운영자용.
 *   npm run storage:cleanup
 */
import { listAbandonedCleanupJobs, runCleanupJobs, sweepStalePendingUploads } from '../src/lib/s3'

async function main() {
  const swept = await sweepStalePendingUploads()
  const cleaned = await runCleanupJobs()
  const abandoned = await listAbandonedCleanupJobs()

  console.log('sweep  :', swept)
  console.log('cleanup:', cleaned)
  if (abandoned.length > 0) {
    console.warn(`\n재시도 상한에 도달해 방치된 작업 ${abandoned.length}건 — 수동 확인 필요:`)
    for (const j of abandoned) console.warn(`  ${j.bucket}/${j.key}  attempts=${j.attempts}  ${j.lastError ?? ''}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
