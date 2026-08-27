/**
 * 랜딩 패널 시드 — 사진을 S3 에 올리고 `icaros.media` + `icaros.page_panels` 행을 만든다.
 *
 *   npm run seed:panels -- --dir <webp 디렉터리>
 *   npm run seed:panels -- --dir <디렉터리> --dry
 *
 * **운영 도구다.** 대상 DB·버킷과 수행할 동작을 출력하고 확인을 받는다.
 *
 * 앱의 presign → PUT → confirm 경로를 쓰지 않는 이유: 그 경로는 관리자 세션을 요구해
 * CLI 에서 탈 수 없다. 대신 그 경로가 만드는 것과 **같은 모양**을 만든다 —
 * 키 규칙 `{prefix}/media/{uuid}.webp`, `status='ready'`, `entity_type='landing'`,
 * 그리고 `HeadObject` 대신 로컬 파일에서 실측한 size·width·height·etag.
 *
 * **새 키만 만든다.** 기존 오브젝트를 덮어쓰지 않는다 — 버킷은 Versioning 이 꺼져 있어
 * 덮어쓴 바이트는 복구할 방법이 없다 (07 §6).
 *
 * 만들어지는 패널은 전부 **비공개**다. 사진과 문구를 화면에서 확인한 뒤 `/admin` 에서 켠다.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { describeTarget, loadEnvLocal, pgConfig } from './lib/db-config'

loadEnvLocal()

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    dry: { type: 'boolean', default: false },
  },
})

const dir = values.dir
if (!dir) fail('--dir <webp 디렉터리> 가 필요합니다.')

function fail(msg: string): never {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

/** WebP 헤더에서 크기를 읽는다. 확장(VP8X)·손실(VP8)·무손실(VP8L) 세 형태를 모두 다룬다. */
function webpSize(buf: Buffer): { width: number; height: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    fail('WebP 파일이 아닙니다.')
  }
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    }
  }
  if (fourcc === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (fourcc === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
  }
  fail(`알 수 없는 WebP 형태입니다: ${fourcc}`)
}

/**
 * 패널 다섯 장의 문구. 파일명이 곧 키다.
 *
 * 값은 프로토타입(S6)에서 화면으로 확인한 것을 그대로 옮긴다. 날짜·장소는 사진 메타데이터로
 * 확인한 것만 적었다 — 지어낸 날짜가 사진 출처로 나가면 가장 고치기 어려운 거짓말이 된다.
 */
const PANELS = [
  {
    file: 'hero-launch.webp',
    alt: 'RAON 발사 순간 — 밭 한가운데서 흰 연기 기둥을 남기며 상승하는 기체, 뒤로 오름과 방풍림',
    focalX: 48,
    focalY: 50,
    scrim: 'bottom',
    anchor: 'bottom-left',
    height: 'full',
    eyebrow: 'Intelligent Creative Astronautics & Rocketry Organization of Students',
    headline: 'We build what flies,\nfrom UAVs to rockets.',
    body: '제주를 중심으로 한 중·고등학생 27명이 기체를 직접 설계하고, 3D 프린터로 동체를 출력하고, 빌린 땅에서 발사합니다.',
    ctaLabel: '기록 전체 보기',
    ctaHref: '/posts',
  },
  {
    file: 'rockets-pad.webp',
    alt: '발사 직전 알뜨르 비행장 — 조립된 발사대에 세워진 ICX-1A 와 오른쪽에 선 풍향계',
    focalX: 42,
    focalY: 46,
    scrim: 'bottom',
    anchor: 'bottom-left',
    height: 'full',
    eyebrow: 'Track 01 · Solid Rockets',
    headline: 'Two launches.\nBoth recovered.',
    body: '2026-07-18 알뜨르에서 ICX-1A, 2026-08-17 금악에서 RAON. 둘 다 점화와 회수에 성공했고, RAON 은 사출장치가 오작동해 목표 고도에는 닿지 못했습니다.',
    ctaLabel: '기체 전체 보기',
    ctaHref: '/rocket',
  },
  {
    file: 'uav-tvc-assembly.webp',
    alt: 'EDF 추력편향 실증기 — 짐벌에 물린 덕트팬과 배선된 제어 기판',
    focalX: 50,
    focalY: 50,
    scrim: 'bottom',
    anchor: 'bottom-left',
    height: 'full',
    eyebrow: 'Track 02 · UAV / VTVL',
    headline: 'Landing is the\nharder half.',
    body: 'EDF 추력편향 기체는 로켓의 재착륙 기술을 확보하려고 시작했습니다. 2026-08-05 자동 호버링까지 왔습니다.',
    ctaLabel: '기체 전체 보기',
    ctaHref: '/rocket',
  },
  {
    file: 'crew-altteureu.webp',
    alt: 'ICX-1A 발사 당일 알뜨르 비행장 — 발사대 앞에 나란히 선 부원 열 명',
    focalX: 50,
    focalY: 58,
    /* 이 패널만 글이 위로 간다. 사람이 화면 아래 절반을 차지해서 아래에 두면 얼굴을 덮는다.
       `anchor` 필드가 존재하는 이유가 이것이다 — 비어 있는 자리는 사진마다 다르고 사람만 안다. */
    scrim: 'top',
    anchor: 'top-left',
    height: 'full',
    eyebrow: 'Crew',
    headline: '27 students.\nNo lab, no company.',
    body: '표선고 · 남녕고 · 아라중 · 제주과학고 · 제주중앙여자중 · 한림항공우주고, 그리고 서정고 · 와부고 재학생.',
    ctaLabel: '부원 보기',
    ctaHref: '/member',
  },
  {
    file: 'support-watching.webp',
    alt: '발사대를 지켜보는 부원 두 명의 뒷모습 — 멀리 조립된 발사대가 서 있다',
    focalX: 50,
    focalY: 48,
    scrim: 'full',
    anchor: 'center',
    height: 'full',
    eyebrow: 'Support',
    headline: '900,000 / 2,700,000',
    body: '후원금은 기체 부품, 전자 장비, 3D 프린팅 재료, 시험 비행 안전 장비에 쓰입니다. 결제 연동은 아직 없습니다.',
    ctaLabel: '후원 문의',
    ctaHref: '#contact',
  },
] as const

const bucket = process.env.S3_BUCKET?.trim()
const prefix = (process.env.S3_PREFIX?.trim() || 'icaros-web').replace(/^\/+|\/+$/g, '')
const region = process.env.AWS_REGION?.trim()
const endpoint = process.env.S3_ENDPOINT?.trim() || undefined
if (!bucket) fail('S3_BUCKET 이 설정되지 않았습니다.')

const files = new Set(readdirSync(dir))
for (const p of PANELS) if (!files.has(p.file)) fail(`파일이 없습니다: ${p.file}`)

const MAX_BYTES = 2 * 1024 * 1024
const prepared = PANELS.map((p) => {
  const path = join(dir, p.file)
  const buf = readFileSync(path)
  const size = statSync(path).size
  if (size > MAX_BYTES) fail(`${p.file} 이 정책 상한(2MB)을 넘습니다: ${size}`)
  /* 이름을 `width`/`height` 로 두면 안 된다. 패널 레코드에도 `height`(= 'full'|'tall'|'half')가
     있어서 스프레드가 그것을 **픽셀 높이 숫자로 덮어쓴다.** 실제로 그렇게 만들었다가
     `page_panels_height_ck` 위반으로 잡혔다 — CHECK 제약이 없었으면 랜딩이 조용히 깨졌을 자리다. */
  const { width: pxWidth, height: pxHeight } = webpSize(buf)
  if (Math.max(pxWidth, pxHeight) > 1600) fail(`${p.file} 의 긴 변이 1600px 을 넘습니다: ${pxWidth}x${pxHeight}`)
  return {
    ...p,
    path,
    size,
    pxWidth,
    pxHeight,
    // 단일 PUT 의 ETag 는 본문 MD5 다. `/confirm` 이 HeadObject 로 받는 값과 같은 모양으로 맞춘다.
    etag: createHash('md5').update(buf).digest('hex'),
    key: `${prefix}/media/${randomUUID()}.webp`,
    mediaId: randomUUID(),
  }
})

console.log(`\n  대상 DB    ${describeTarget()}`)
console.log(`  버킷       ${bucket}${region ? ` (${region})` : ''}${endpoint ? ` @ ${endpoint}` : ''}`)
console.log(`  키 프리픽스 ${prefix}/media/`)
console.log(`  동작       사진 ${prepared.length}장 업로드 + media ${prepared.length}행 + page_panels ${prepared.length}행(전부 비공개)\n`)
for (const p of prepared) {
  console.log(`    ${p.file.padEnd(24)} ${String(p.pxWidth).padStart(4)}x${String(p.pxHeight).padEnd(5)} ${String(Math.round(p.size / 1024)).padStart(4)} KB`)
}

if (values.dry) {
  console.log('\n  --dry 이므로 아무것도 하지 않았습니다.\n')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question("\n이 버킷과 DB 에 위 동작을 수행합니다. 계속하려면 'yes' 를 입력하십시오: ")
rl.close()
if (answer.trim() !== 'yes') {
  console.log('취소했습니다.\n')
  process.exit(0)
}

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

try {
  for (const p of prepared) {
    execFileSync(
      'aws',
      [
        // 로컬 MinIO 로 붙일 때만 채워진다. 운영에는 이 변수가 없어 실제 S3 로 간다.
        ...(endpoint ? ['--endpoint-url', endpoint] : []),
        's3api', 'put-object',
        '--bucket', bucket,
        '--key', p.key,
        '--body', p.path,
        '--content-type', 'image/webp',
        // 기존 키를 절대 덮지 않는다. 키가 UUID 라 충돌은 사실상 없지만, 없다는 것과 막는 것은 다르다.
        '--if-none-match', '*',
      ],
      { stdio: 'pipe' }
    )
    console.log(`  올림  ${p.key}`)
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const [i, p] of prepared.entries()) {
      await client.query(
        `insert into icaros.media (id, bucket, key, original_filename, mime, size, etag, width, height, status, entity_type)
         values ($1,$2,$3,$4,'image/webp',$5,$6,$7,$8,'ready','landing')`,
        [p.mediaId, bucket, p.key, p.file, p.size, p.etag, p.pxWidth, p.pxHeight]
      )
      await client.query(
        `insert into icaros.page_panels
           (media_id, sort_order, published, focal_x, focal_y, scrim, anchor, height,
            eyebrow, headline, body, cta_label, cta_href)
         values ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [p.mediaId, i, p.focalX, p.focalY, p.scrim, p.anchor, p.height,
         p.eyebrow, p.headline, p.body, p.ctaLabel, p.ctaHref]
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }

  console.log(`\n  완료  패널 ${prepared.length}개를 **비공개**로 만들었습니다.`)
  console.log('        /admin?tab=panels 에서 확인한 뒤 공개하십시오.\n')
} finally {
  await pool.end()
}
