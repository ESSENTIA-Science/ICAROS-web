/**
 * 레거시 Supabase → 로컬 icaros 스키마 시드. 일회성 개발 편의 스크립트다.
 *
 * - Supabase 는 **읽기만** 한다 (anon key, GET only).
 * - posts 는 다루지 않는다. ESSENTIA Community 가 단일 원본이며 D1(서비스 토큰) 대기 중이다.
 * - 이미지는 S3 이전(P9) 전까지 레포의 public/ 경로를 legacy_image_path 로 보관한다.
 * - members.sort_order 는 레거시에 중복(값 5 가 3행)이 있어 재부여한다.
 *
 *   pnpm tsx scripts/seed-from-legacy.ts
 */
import { Pool } from 'pg'

const SB_URL = process.env.LEGACY_SUPABASE_URL
const SB_KEY = process.env.LEGACY_SUPABASE_ANON_KEY
const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!SB_URL || !SB_KEY) throw new Error('LEGACY_SUPABASE_* 가 설정되지 않았습니다')
if (!DB_URL) throw new Error('DATABASE_URL 이 설정되지 않았습니다')

type Row = Record<string, unknown>

async function sb(path: string): Promise<Row[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase ${path} → ${res.status}`)
  return res.json() as Promise<Row[]>
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : null)

async function main() {
  const pool = new Pool({ connectionString: DB_URL })
  const c = await pool.connect()

  try {
    await c.query('begin')

    // ── site_settings (랜딩 문구 — 라이브 값을 그대로 쓴다) ──────────
    const settings = await sb('site_content?select=key,value')
    for (const r of settings) {
      await c.query(
        `insert into icaros.site_settings (key, value) values ($1,$2)
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [r.key, r.value]
      )
    }

    // ── 레거시에서 컴포넌트에 하드코딩돼 있던 문구를 CMS 키로 승격 ──
    //    문구는 한 글자도 바꾸지 않는다. 편집 가능해지는 것만 달라진다.
    //    (요구사항 A5 Footer / B5 Mission 리드 / B6 Donate 인용·마무리 / B9 Contact)
    const PROMOTED: Array<[string, string]> = [
      ['hero.tagline', 'Intelligent Creative Astronautics & Rocketry Organization of Students'],
      ['mission.list_intro', '주요 활동은 다음과 같습니다.'],
      ['donate.quote', 'Every donation brings the next flight closer.'],
      ['donate.cta_label', '후원 문의하기'],
      ['donate.outro', '작은 지원이 새로운 기체의 이륙과 더 깊은 항공우주 탐구로 이어집니다.'],
      ['contact.email', 'air091226@naver.com'],
      ['contact.instagram', 'icaros_aerospace'],
      ['footer.copyright', '© 2026 ICAROS. All Rights Reserved.'],
    ]
    for (const [key, value] of PROMOTED) {
      // 이미 DB 에 있으면 덮어쓰지 않는다 — 운영자가 고친 값을 되돌리면 안 된다.
      await c.query(
        `insert into icaros.site_settings (key, value) values ($1,$2) on conflict (key) do nothing`,
        [key, value]
      )
    }

    // ── page_sections (신규 — 레거시에 없던 개념) ───────────────────
    const SECTIONS = [
      ['hero', 'Hero'], ['about', 'About us'], ['vision', 'Vision'],
      ['research', 'Research Areas'], ['mission', 'Mission'],
      ['donate', 'Donate'], ['contact', 'Contact'],
    ] as const
    for (const [i, [id, label]] of SECTIONS.entries()) {
      await c.query(
        `insert into icaros.page_sections (id,label,enabled,sort_order) values ($1,$2,true,$3)
         on conflict (id) do update set label = excluded.label, sort_order = excluded.sort_order`,
        [id, label, i]
      )
    }

    // ── rockets + engines ──────────────────────────────────────────
    await c.query('delete from icaros.rocket_engines')
    await c.query('delete from icaros.rockets')
    const rockets = await sb('rockets?select=*&order=series.asc,sort_order.asc')
    for (const r of rockets) {
      await c.query(
        `insert into icaros.rockets
           (id,name,series,legacy_image_path,max_altitude_m,size_m,payload_kg,published,sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
        [r.id, r.name, r.series, str(r.img), num(r.max_altitude_m), num(r.size_m), num(r.payload_kg), r.sort_order]
      )
      const engines = Array.isArray(r.engines) ? (r.engines as Row[]) : []
      for (const [i, e] of engines.entries()) {
        await c.query(
          `insert into icaros.rocket_engines (rocket_id,type,thrust_n,burn_time_s,count,mode,sort_order)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [r.id, e.type ?? 'unknown', num(e.thrust_n), num(e.burn_time_s), Number(e.count ?? 1), str(e.mode), i]
        )
      }
    }

    // ── members (sort_order 재부여 — 레거시 중복·결번 교정) ──────────
    await c.query('delete from icaros.members')
    const members = await sb('members?select=*&order=sort_order.asc,created_at.asc')
    for (const [i, m] of members.entries()) {
      await c.query(
        `insert into icaros.members (name,role,squad,school,legacy_image_path,published,sort_order)
         values ($1,$2,$3,$4,$5,true,$6)`,
        [m.name, str(m.role), deriveSquad(str(m.role)), str(m.school), str(m.image), i]
      )
    }

    await c.query('commit')

    const count = async (t: string) =>
      (await c.query(`select count(*)::int n from icaros.${t}`)).rows[0].n as number
    console.log('seeded:', {
      site_settings: await count('site_settings'),
      page_sections: await count('page_sections'),
      rockets: await count('rockets'),
      rocket_engines: await count('rocket_engines'),
      members: await count('members'),
    })
  } catch (err) {
    await c.query('rollback')
    throw err
  } finally {
    c.release()
    await pool.end()
  }
}

/** role 문자열에서 부서를 뽑는다. 레거시는 부서와 직책이 한 필드에 섞여 있다. */
function deriveSquad(role: string | null): string | null {
  if (!role) return null
  for (const s of ['추진공학부', '전자부', '비행제어부', '법률·재무팀']) {
    if (role.includes(s)) return s
  }
  if (role.includes('SW')) return 'SW · 디자인'
  if (role.includes('주관')) return '총괄'
  return null
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
