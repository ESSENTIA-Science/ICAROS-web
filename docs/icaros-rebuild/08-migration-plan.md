# 08 — Migration Plan: Legacy Data Inventory (Supabase → Neon + S3)

Status: **inventory complete, cutover TBD**
Source: live Supabase project referenced by `VITE_SUPABASE_URL` (bucket `post-img`), read via the anon key over PostgREST + Storage REST.
Snapshot taken: **2026-08-23**. Read-only; no writes were issued.

> Everything below is measured, not inferred. Where the repo's `CLAUDE.md` disagrees with the live DB, the live DB wins and the discrepancy is called out.

---

## 1. Exact inventory

### 1.0 Tables exposed to the anon role

| Table | HTTP | Rows readable by anon | Note |
|---|---|---|---|
| `public.site_content` | 200 | **18** | full read |
| `public.rockets` | 200 | **4** | full read |
| `public.members` | 200 | **27** | full read |
| `public.posts` | 200 | **20** | full read |
| `public.admins` | 200 | **0** | RLS-filtered, see below |

Row counts obtained with `Prefer: count=exact` + `Range: 0-0` (`content-range` header).

**`admins` probe result — exact behaviour:** the request does **not** error. It returns `HTTP/2 200`, `content-range: */0`, body `[]`. There is no `SELECT` policy granting `anon` any rows, so PostgREST returns an empty set rather than 401/403. Practical consequence for migration: **the admin roster is NOT extractable with the anon key.** It must be dumped with a `service_role` key or read from the Supabase Dashboard before cutover, otherwise the admin allowlist is silently lost.

`POST /rest/v1/rpc/is_admin` with the anon key returns `200` / `false` — the function is executable by `anon` but truthfully reports non-admin.

**Other tables probed and confirmed absent** (`404 PGRST205 – "Could not find the table 'public.<x>' in the schema cache"`): `gallery`, `site_settings`, `users`, `profiles`, `sponsors`, `events`, `applications`, `launches`, `subscribers`, `contacts`. The PostgREST "Perhaps you meant…" hints across those probes only ever suggested `posts`, `members`, `admins`, `site_content` — consistent with the five tables above being the complete exposed surface. The OpenAPI schema endpoint (`GET /rest/v1/`) is service-role-gated on this project (`"Only the service_role API key can be used for this endpoint"`), so this is evidence-based rather than authoritative; **re-confirm with a service_role schema dump before cutover.**

**Exact RLS behaviour on `admins`, from the recovered DDL:**
```sql
create policy "admins readable by admins" on public.admins
  for select using (public.is_admin());
```
The policy exists and evaluates to `false` for `anon`, so PostgREST returns an empty result set with `200`, never an authorization error.

> ⚠️ **The `supabase/` directory is deleted from the working tree** (`git status` shows two unstaged deletions). The DDL is still recoverable from `HEAD`:
> ```
> git show HEAD:supabase/migrations/0001_cms_auth_rls.sql
> git show HEAD:supabase/migrations/0002_cms_content.sql
> ```
> Restore or archive these before anyone commits the deletion — they are the only DDL that exists. Type declarations below are taken from them.
>
> ⚠️ **There is no `create table public.posts` anywhere in the repo or its git history.** `0001` only `ALTER`s `posts` to add `cover_url`/`summary`. The `posts` table was created out-of-band in the Supabase Dashboard, so its true DDL (column types, defaults, indexes) exists **only in the live database**. A `pg_dump --schema-only` with `service_role`/DB credentials is mandatory before teardown.

---

### 1.1 `site_content` — 18 rows

Declared DDL (`0002_cms_content.sql`) plus observed null rates:

| Column | Declared type | Null rate | Empty-string rate |
|---|---|---|---|
| `key` | `text primary key` | 0/18 | 0/18 |
| `value` | `text` (nullable) | 0/18 | 0/18 |
| `updated_at` | `timestamptz not null default now()` | 0/18 | — |

All 18 rows share `updated_at = 2026-07-29T14:06:27.167+00:00` — a single bulk write. There is no per-key edit history.

> ⚠️ **The brief expected 22 keys; the live table has 18.** 18 is also exactly what `src/home.jsx` `DEFAULTS` declares and exactly what `src/admin/LandingPanel.jsx` `SECTIONS` exposes, so the three are in sync and 18 is correct. No orphaned/extra keys, no missing keys.

| key | value length (chars) | contains `\n` | contains `**` |
|---|---|---|---|
| `about.body` | 355 | yes | — |
| `about.slogan` | 46 | — | yes |
| `contact.body` | 83 | yes | — |
| `donate.intro` | 101 | yes | — |
| `donate.usage_list` | 99 | yes | — |
| `donate.usage_title` | 20 | — | — |
| `donation.current` | 7 | — | — |
| `donation.goal` | 7 | — | — |
| `mission.body` | 202 | yes | — |
| `mission.list` | 139 | yes | — |
| `research.control.body` | 98 | yes | — |
| `research.control.title` | 21 | — | — |
| `research.rocketry.body` | 129 | yes | — |
| `research.rocketry.title` | 21 | — | — |
| `research.uav.body` | 85 | yes | — |
| `research.uav.title` | 24 | — | — |
| `vision.body` | 194 | yes | — |
| `vision.slogan` | 40 | — | yes |

Encoding notes that matter downstream:
- `\n` is a **real newline byte**, not an escape sequence. 12 of 18 values contain them.
- `mission.list` and `donate.usage_list` are **newline-delimited lists** rendered via `.split('\n')` in `home.jsx` — they are arrays wearing a text costume.
- `**word**` in the two slogans is **not Markdown** — it is parsed by `src/component/Highlight.jsx` as a bespoke highlight marker.
- `donation.goal` / `donation.current` are **numbers stored as text** (`"2700000"`, `"900000"`), coerced with `Number()` at render.
- No value contains a URL or an `/assets` path — `site_content` has zero media dependencies.

---

### 1.2 `rockets` — 4 rows

| Column | Declared type | Null rate |
|---|---|---|
| `id` | `text primary key` (slug) | 0/4 |
| `name` | `text not null` | 0/4 |
| `img` | `text` (nullable) | 0/4 |
| `series` | `text not null default 'A'` — `'A'` = ICX 1/2, `'B'` = ICX MV. **No CHECK constraint**, any string is accepted. | 0/4 |
| `max_altitude_m` | `numeric` — **not integer**, despite all 4 current values being whole numbers | 0/4 |
| `size_m` | `numeric` | 0/4 |
| `payload_kg` | `numeric` | 0/4 |
| `engines` | `jsonb not null default '[]'::jsonb` | 0/4 |
| `sort_order` | `int not null default 0` — **no unique constraint** | 0/4 |
| `created_at` | `timestamptz not null default now()` | 0/4 |

| id | name | series | sort_order | engines[] len | max_altitude_m | size_m | payload_kg | img |
|---|---|---|---|---|---|---|---|---|
| `icx1` | ICX-IA | A | 0 | 1 | 150 | 0.6 | 0.5 | `/assets/img/rocket/icx1.webp` |
| `icx1s` | ICX-Is | A | 1 | 2 | 250 | 1.5 | 0.5 | `/assets/img/rocket/icx1s.webp` |
| `icxmv1` | ICX MV-I | B | 0 | 1 | 200 | 1.8 | 0.8 | `/assets/img/rocket/icxmv1.webp` |
| `icxmv1lr` | ICX MV-I LR | B | 1 | 2 | 250 | 1.9 | 0.8 | `/assets/img/rocket/icxmv1lr.webp` |

`sort_order` is **scoped per `series`**, not globally unique — `(A,0)`, `(A,1)`, `(B,0)`, `(B,1)`. A naive global unique constraint on `sort_order` in the target schema would reject this data. The natural key is `(series, sort_order)`.

`engines` jsonb element shape is **not uniform**:
```
{"type":"KNSB","thrust_n":146,"burn_time_s":1.1}                       // 1-engine rows
{"type":"Black Powder","count":3,"thrust_n":6.8,"burn_time_s":0.6}     // adds `count`
```
`count` appears only on the "Black Powder" second stage. All 4 rows' `engines` arrays are non-empty. Total engine records across the table: **6**.

`created_at` is identical (`2026-07-15T08:14:08.249689+00:00`) for all 4 rows — a seed insert. It carries **no editorial meaning**.

> ⚠️ **Seed vs. live drift.** `0002_cms_content.sql` seeds **7** rockets — `icx1`, `icx1s`, `icx2`, `icx2s`, `icxmv1`, `icxmv1lr`, `icxmv1mirv`. The live table has **4**: `icx2`, `icx2s`, and `icxmv1mirv` were **deleted via the admin console**. The surviving 4 also have edited names and specs (seed `icx1` = `ICX-I`, 200 m, 1.5 m; live = `ICX-IA`, 150 m, 0.6 m). The seed is not a valid fallback — **only the live DB is authoritative**, and the deletions must be confirmed as intentional rather than accidental.
>
> ⚠️ The seed file `src/assets/rocket_info.json` describes **6** rockets (`icx1`, `icx1s`, `icx2`, `icx2s`, plus MV variants) with **different spec numbers** (e.g. `icx1` altitude 200 / size 1.5 vs the DB's 150 / 0.6, and name `ICX-I` vs the DB's `ICX-IA`). The DB is the live source; the JSON is stale. `public/assets/img/rocket/icx2.webp` and `icx2s.webp` exist in the repo but are **referenced by no DB row** — decide whether ICX-II is a deliberate deletion or an unfinished migration before porting.

---

### 1.3 `members` — 27 rows

| Column | Declared type | Null rate |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | 0/27 |
| `name` | `text not null` | 0/27 |
| `role` | `text` (nullable, free-form — no enum, no CHECK) | 0/27 |
| `school` | `text` (nullable) | **4/27 null** |
| `image` | `text` (nullable) | **23/27 null** |
| `sort_order` | `int not null default 0` — **no unique constraint** | 0/27 |
| `created_at` | `timestamptz not null default now()` | 0/27 |

> ⚠️ **Seed vs. live drift.** `0002_cms_content.sql` seeds **21** members with a *different team taxonomy* (`동체부`, `전자제어부`, `SW부`) and different role titles (`김지후` = `주관 · 추진공학부 부장`). The live table has **27** members using `전자부` / `추진공학부` / `비행제어부`. The roster was substantially re-entered through the admin console after seeding: several seeded members are gone (e.g. `정근호`), new ones were added, and `고연호`'s seeded image `/assets/img/member/yunho.jpg` was cleared to null. **The seed reflects no state the site has ever shown — do not use it as a fallback or a schema reference for roles.**

**Count by role** — `role` is a free-text string, not an enum. Four of the eight distinct values are one-off strings that mix a team name with a title:

| role | count |
|---|---|
| 전자부 | 9 |
| 추진공학부 | 8 |
| 비행제어부 | 5 |
| SW, 디자인 | 1 |
| 법률·재무팀 | 1 |
| 부주관 · 전자부장 | 1 |
| 비행제어부 부장 | 1 |
| 주관 · 전 부분 총괄 설계 | 1 |

**Image coverage:** 4 with image / **23 without**.

| name | role | image |
|---|---|---|
| 김지후 | 주관 · 전 부분 총괄 설계 | `/assets/img/member/kimjihoo.webp` |
| 박현빈 | 부주관 · 전자부장 | `/assets/img/member/parkhyunbin.webp` |
| 이성우 | 비행제어부 부장 | `/assets/img/member/sungwoo.webp` |
| 백예람 | 법률·재무팀 | `/assets/img/member/yeahram.webp` |

All 4 are **local repo paths, not Storage URLs** — see §3.3.

**School coverage:** 23 with school / **4 without** (`null`, not empty string): 고연호, 윤효준, 최해준, 현영준.

**Duplicate `sort_order` values:**

| sort_order | rows | members |
|---|---|---|
| 5 | 3 | 김가은, 문혁훈, 조한빛 |

All other values are unique. Range is `0..26` across 25 distinct values, with **gaps at 14 and 24** (deleted members, never re-compacted). Ordering is therefore *not* a dense 0..n sequence and **row order within `sort_order = 5` is non-deterministic** — the current site renders those three in whatever order Postgres returns. Any target schema that puts a unique index on `sort_order` will fail the import.

---

### 1.4 `posts` — 20 rows

Types below are **observed from the JSON payload only** — `posts` has no checked-in DDL (see §1.0). `cover_url` and `summary` were added by `0001_cms_auth_rls.sql` as plain nullable `text`.

| Column | Observed type | Null rate | Empty-string rate |
|---|---|---|---|
| `id` | `uuid` (PK) | 0/20 | — |
| `title` | `text` | 0/20 | 0/20 |
| `content_md` | `text` (Markdown) | 0/20 | 0/20 |
| `created_at` | `timestamptz` | 0/20 | — |
| `cover_url` | `text` (added by `0001`) | 0/20 | 0/20 |
| `summary` | `text` (added by `0001`) | 0/20 | **2/20 empty** |

There is **no `updated_at` column** and **no author/owner column** — posts carry no attribution.
Date range: `2026-01-24 12:27:46Z` → `2026-08-22 14:04:54Z`. No duplicate titles.

| id | title | created_at | cover_url | summary | content_md len | imgs in body | body text len (imgs stripped) | summary len | summary quality |
|---|---|---|---|---|---|---|---|---|---|
| `bfdce96a-abb1-46a3-921e-3dcc26f1fb7c` | 캔위성 설계 | 2026-01-24 12:27:46Z | set | set | 190 | 1 | 49 | 48 | raw `\n`, untrimmed |
| `dfd9ddf4-8b52-4f50-89ea-4da87a83b11a` | ICX-I  & 캔위성 설계 완료 | 2026-01-24 12:31:26Z | set | set | 190 | 1 | 33 | 32 | raw `\n`, untrimmed |
| `1fcbf63c-eed4-43c8-be5b-a16222004299` | 낙하산 설계 및 테스트 완료 | 2026-01-24 13:00:09Z | set | set | 347 | 2 | 43 | 41 | raw `\n`, untrimmed |
| `1deb585b-910f-492b-88d9-805ccd4f2444` | 발사체 주요 부품 3D 출력 | 2026-01-24 13:02:43Z | set | set | 181 | 1 | 39 | 38 | raw `\n`, untrimmed |
| `fc33051f-5be5-4f22-b235-fa669549e8cc` | ICX-I 제작 시작 | 2026-01-24 13:03:50Z | set | set | 522 | 3 | 96 | 93 | raw `\n` |
| `1fa826be-6918-4071-98a8-539e4b0f3e15` | 로켓 발사대 제작 | 2026-01-24 13:11:52Z | set | set | 181 | 1 | 37 | 38 | raw `\n`, untrimmed |
| `1708fb08-971f-4ced-8885-1a2c08d950f1` | ICX-I 제작 완료 | 2026-01-24 13:13:10Z | set | set | 161 | 1 | 19 | 18 | raw `\n`, untrimmed |
| `266c0b45-47da-4976-bba2-b5317de57bb3` | 고체 연료 로켓 모터 TMS 성공 | 2026-01-24 13:16:44Z | set | set | 309 | 2 | 35 | 33 | raw `\n`, untrimmed |
| `637a2cd2-7750-45b4-92d0-795733c3a7b3` | EDF TVC 기체 설계 시작 | 2026-01-24 13:23:07Z | set | set | 360 | 2 | 53 | 53 | raw `\n`, untrimmed |
| `38a92ddd-6b87-4287-b281-6366c912f189` | EDF TVC 기체 설계 완료 | 2026-01-24 13:24:38Z | set | set | 161 | 1 | 19 | 18 | raw `\n`, untrimmed |
| `c3e7fe62-c0df-4281-97c7-9ec73f02de34` | EDF TVC VTVL 프로젝트 시작 | 2026-06-16 11:58:43Z | set | set | 589 | 4 | 33 | 29 | raw `\n`, untrimmed |
| `9d4e76cc-f888-4389-acc1-e5de2c8836f2` | STOL RC 비행기 설계 시작 | 2026-06-16 13:45:12Z | set | set | 530 | 3 | 53 | 50 | raw `\n`, untrimmed |
| `e122882b-02f3-4342-91f7-07f654d539de` | TVC 기체 가조립 및 동작 테스트 | 2026-06-17 11:33:33Z | set | **empty** | 140 | 1 | 1 | 0 | blank |
| `757442a7-f597-4fcd-8cc9-c037a03c018b` | 260710TMS | 2026-07-11 14:54:01Z | set | whitespace-only | 562 | 4 | 8 | 4 | blank, raw `\n`, untrimmed |
| `37c4b7e3-0f9a-4826-8d96-383042f921a6` | ICX-1A Launch | 2026-07-24 23:23:26Z | set | set | 1508 | 10 | 118 | 97 | clean |
| `ed1a9d6c-f5c6-44be-8713-8431475cab3d` | TVC 기체 자동 호버링 테스트 | 2026-08-05 15:16:27Z | set | **empty** | 140 | 1 | 1 | 0 | blank |
| `d080e782-9e32-4d15-be32-aec8c6544e45` | ICX-II RAON 로켓 모터 제작 | 2026-08-05 16:35:17Z | set | set | 168 | 1 | 29 | 26 | clean |
| `bd7d23e0-b082-47eb-b482-602c1dc6f798` | ICX-II RAON TMS | 2026-08-08 11:31:41Z | set | set | 163 | 1 | 24 | 21 | clean |
| `80df62ac-f08c-48ce-b63c-9649d5a5f5dc` | RAON 제작 | 2026-08-22 14:02:42Z | set | set | 430 | 3 | 13 | 6 | clean |
| `e6c46022-cddd-4b20-9415-923804ec318c` | RAON 발사 | 2026-08-22 14:04:54Z | set | set | 1028 | 6 | 194 | 160 | clean |

**Totals:** 49 image references in bodies, 20 `cover_url` values, 7,860 chars of `content_md` in total.

**Structural findings about `content_md`:**
- Every one of the 20 `cover_url` values is **byte-identical to the first `![](…)` in that post's own `content_md`** (0 mismatches). `cover_url` is pure denormalization — `src/lib/markdown.js#extractFirstImage`.
- The 49 body images and the 20 covers together are **69 reference occurrences pointing at only 49 distinct objects**. Nothing else is duplicated.
- **No post uses any Markdown construct other than images.** Zero headings, bullets, links, bold, code fences, or blockquotes across all 20 bodies. Bodies are `plain paragraph text + a run of image lines`. Alt text is always the original camera filename (`IMG_1409.jpeg`, `1000049722.jpg`, …) — 49 distinct, all meaningless as alt text.
- 3 posts have **no prose at all** — body text length 1 after stripping images (`260710TMS` has 8 chars of whitespace).

**`summary` is a stale denormalization, not a derivation.** `PostsPanel.jsx` writes `summary: buildSummary(body)`, which collapses `\n+` → space and trims. But **13 of 20 stored summaries do not match `buildSummary(content_md)`** — they retain raw newlines and leading/trailing whitespace:

```
title:   캔위성 설계
body:    "2025/8 발사체 ICX-I,ICX-II에 탑재할 캔위성 탑재체의 디자인 및 설계"
summary: "\n\n2025/8\n발사체 ICX-I,ICX-II에 탑재할 캔위성 탑재체의 디자인 및 설계"
```

**Root cause identified.** `0001_cms_auth_rls.sql` step 6 backfills `summary` in SQL:
```sql
summary = left(btrim(regexp_replace(regexp_replace(content_md,
            '!\[[^\]]*\]\([^)]+\)', '', 'g'),   -- strip images
            '[#>*_`\[\]]', '', 'g')), 160)         -- strip markdown symbols
```
That expression strips images and Markdown punctuation but **never collapses newlines** and `btrim` only removes outer whitespace — producing exactly the "raw `\n`, untrimmed" pattern seen above. Every post that existed when `0001` ran carries a SQL-backfilled summary; posts written later through `PostsPanel.jsx` carry a correct `buildSummary()` one. The two generations disagree and always will. 13 summaries contain raw newlines, 12 have untrimmed whitespace, 3 are blank-or-whitespace-only. **Do not migrate `summary` verbatim — recompute it from `content_md` at import time.**

---

## 2. Storage inventory — bucket `post-img`

Listed via `POST /storage/v1/object/list/post-img` with `{"prefix":"<folder>/","limit":1000}`.

| prefix | objects | total bytes | note |
|---|---|---|---|
| `posts/` | **52** | **90,881,239** (86.67 MiB) | the entire bucket |
| `rockets/` | **0** | 0 | folder never used |
| `members/` | **0** | 0 | folder never used |
| `""` (root) | 1 pseudo-entry | 0 | returns only the `posts` folder marker (`id: null`, no metadata); no loose files, no `.emptyFolderPlaceholder` |

**Bucket total: 52 objects, 90,881,239 bytes (86.67 MiB / 90.88 MB).**

Bucket access model (from `0001_cms_auth_rls.sql`, step 5): `post-img` is **public read for everyone** (`for select using (bucket_id = 'post-img')`), with insert/delete restricted to `authenticated and is_admin()`. Every object URL in the DB is therefore an unauthenticated public URL — the migration copy can be done with plain HTTP GETs, no credentials required. The flip side is that **the target bucket must match this public-read posture** or every migrated image 403s.

`src/lib/storage.js` provisions `posts/`, `rockets/`, and `members/` as upload targets, but **no rocket or member image was ever uploaded through the CMS** — every rocket/member image is still a repo asset (§3.3).

By mimetype: `image/jpeg` 41, `image/png` 9, `image/webp` 2.
By file extension: `.jpg` 21, `.jpeg` 20, `.png` 9 (**2 of them uppercase `.PNG`**), `.webp` 2.

Key format is `posts/<uuid-v4>.<original-ext>` (`crypto.randomUUID()` + the uploaded file's extension, extension case preserved). All objects have `cacheControl: max-age=3600`.

### 2.1 Full object manifest (`posts/`, ordered by `created_at`)

| name | size (bytes) | mimetype | created_at |
|---|---|---|---|
| `posts/9f4f0fc5-5f97-45f0-b451-7f84ff5b03f5.webp` | 54,466 | image/webp | 2026-01-23 19:34:03Z |
| `posts/dcf8fc1a-f92b-4abd-97a7-cd6ffc491dad.webp` | 149,884 | image/webp | 2026-01-23 20:08:57Z |
| `posts/6fc62896-ab36-4b0e-a34f-5694a3fa3dc9.png` | 983,349 | image/png | 2026-01-24 10:28:57Z |
| `posts/c5b200f7-4348-406d-85f2-005928511b83.png` | 174,647 | image/png | 2026-01-24 12:26:13Z |
| `posts/bb40c722-dc94-4a68-a8b9-1f3181409ea9.png` | 249,631 | image/png | 2026-01-24 12:30:41Z |
| `posts/b170d779-264d-45fb-ad25-7e144fbf129f.jpg` | 2,672,442 | image/jpeg | 2026-01-24 12:58:32Z |
| `posts/12bfe081-7cf3-44b4-9092-b26f1c8f0275.jpg` | 900,594 | image/jpeg | 2026-01-24 12:58:38Z |
| `posts/a361b500-f1a2-4d16-ba02-49478e23b3a7.jpg` | 3,932,305 | image/jpeg | 2026-01-24 13:01:54Z |
| `posts/dd5ba119-ea35-4f6f-8d56-bb60eb00ec2b.jpg` | 3,330,334 | image/jpeg | 2026-01-24 13:02:54Z |
| `posts/01b7f2a8-c10e-42ce-8edd-302fe4a51e5d.jpg` | 2,993,253 | image/jpeg | 2026-01-24 13:07:13Z |
| `posts/b3564442-06a3-4a4e-8ef7-731aded8c055.jpg` | 2,873,350 | image/jpeg | 2026-01-24 13:09:31Z |
| `posts/d74a461b-3128-4297-a34f-fc60af04d39b.png` | 1,592,367 | image/png | 2026-01-24 13:10:22Z |
| `posts/ff4bcd7b-11bf-4031-a98a-70772a3cf325.jpg` | 2,835,827 | image/jpeg | 2026-01-24 13:12:33Z |
| `posts/876eb4f2-7d79-41a1-866e-261b00342a84.PNG` | 145,115 | image/png | 2026-01-24 13:16:33Z |
| `posts/affff3c5-3a53-4d9e-bf00-3e0320a243b2.PNG` | 106,817 | image/png | 2026-01-24 13:16:38Z |
| `posts/be0b4518-5d2f-4f34-b0b3-2de7ba187cd5.jpg` | 441,586 | image/jpeg | 2026-01-24 13:20:50Z |
| `posts/0ce4db22-5110-4846-816c-7d4672493a88.png` | 433,472 | image/png | 2026-01-24 13:21:23Z |
| `posts/770591b8-4c98-47b7-b99e-20e7c9479880.png` | 983,349 | image/png | 2026-01-24 13:24:03Z |
| `posts/9d87aa59-9a4f-4e5e-aa0f-06d188a89afa.jpeg` | 835,668 | image/jpeg | 2026-06-16 11:58:05Z |
| `posts/86954191-e0e8-46f0-981a-da0452b6d5fe.jpeg` | 2,108,129 | image/jpeg | 2026-06-16 11:58:06Z |
| `posts/99426c92-1fe6-4b04-8378-a15c6709c043.jpeg` | 2,532,136 | image/jpeg | 2026-06-16 11:58:09Z |
| `posts/120c7bc9-8e37-4d8b-9a0c-457db7d79fd2.jpeg` | 2,202,458 | image/jpeg | 2026-06-16 11:58:11Z |
| `posts/a414c274-99f6-49ab-9433-5db1b6976370.jpg` | 3,839,134 | image/jpeg | 2026-06-16 13:44:13Z |
| `posts/b717d806-6903-4209-ab90-7dce31312ffa.jpg` | 583,620 | image/jpeg | 2026-06-16 13:44:25Z |
| `posts/edefd0bd-a0e8-43a4-9d5e-ae1d51e6f750.jpg` | 350,930 | image/jpeg | 2026-06-16 13:44:33Z |
| `posts/4504be0d-ad89-454e-bf1a-5c021f484fc9.jpeg` | 247,327 | image/jpeg | 2026-06-17 11:33:28Z |
| `posts/aa3e239c-316c-4388-8609-83a7f805e9d9.jpeg` | 1,701,088 | image/jpeg | 2026-07-11 14:53:36Z |
| `posts/f1bdd11f-377c-4c4a-b14e-0d75e2a87a0a.png` | 10,177,600 | image/png | 2026-07-11 14:53:45Z |
| `posts/8aedccc4-a750-46cc-8fa2-457eb6611599.jpeg` | 265,190 | image/jpeg | 2026-07-11 14:53:47Z |
| `posts/8532d40f-d744-435f-a8da-ddb4a9e426f6.jpeg` | 5,404,824 | image/jpeg | 2026-07-12 03:39:20Z |
| `posts/a91143a7-5c88-444f-91c5-ea8e6bab0dcd.jpg` | 2,780,343 | image/jpeg | 2026-07-24 23:23:14Z |
| `posts/b9172087-7130-4908-9004-b7022f49dd83.jpg` | 4,656,733 | image/jpeg | 2026-07-24 23:23:16Z |
| `posts/55833d32-43f0-458f-a2cd-21ee8c0969f3.jpg` | 3,377,300 | image/jpeg | 2026-07-24 23:23:17Z |
| `posts/30f03e05-76d4-4ef4-b5ec-f8db9f9e60dc.jpg` | 4,244,853 | image/jpeg | 2026-07-24 23:23:18Z |
| `posts/f55b00cf-97ce-445b-bfa3-f7b87e6dac55.jpg` | 672,832 | image/jpeg | 2026-07-24 23:23:19Z |
| `posts/ad20ca9c-e148-420c-bd92-78d90aef7c89.jpg` | 486,380 | image/jpeg | 2026-07-24 23:23:20Z |
| `posts/e08ce903-cbb9-41fb-a716-925591021b76.jpg` | 230,092 | image/jpeg | 2026-07-24 23:23:20Z |
| `posts/1df5c45f-484a-45b2-8703-ae8a2afbe63d.jpg` | 222,074 | image/jpeg | 2026-07-24 23:23:21Z |
| `posts/5a70425c-f343-4573-9abd-0496a2bb6bd7.jpg` | 782,585 | image/jpeg | 2026-07-24 23:23:22Z |
| `posts/017fa5ae-1002-4522-9c96-70820200afa7.jpg` | 336,787 | image/jpeg | 2026-07-24 23:23:23Z |
| `posts/462bb2b8-ba35-4a94-a10d-e74a804a9409.jpeg` | 130,474 | image/jpeg | 2026-08-05 15:16:25Z |
| `posts/fa8f6d77-88eb-48eb-83a2-277b5f565d6b.jpeg` | 2,240,913 | image/jpeg | 2026-08-05 16:35:10Z |
| `posts/3098bba1-1483-4bb4-a369-2578f5062ed3.jpeg` | 327,175 | image/jpeg | 2026-08-08 11:31:26Z |
| `posts/ac92b0ca-f640-4c51-aa17-9b4034a6401c.jpeg` | 215,095 | image/jpeg | 2026-08-22 14:02:31Z |
| `posts/1449759b-9053-4319-a4f6-298cee8ce696.jpeg` | 308,035 | image/jpeg | 2026-08-22 14:02:32Z |
| `posts/69a23bd1-83d7-4bc6-a879-f62cd44598d2.jpeg` | 2,318,360 | image/jpeg | 2026-08-22 14:02:35Z |
| `posts/af704dbe-a73a-4a81-a169-dd8024ddeae9.jpeg` | 4,096,021 | image/jpeg | 2026-08-22 14:04:22Z |
| `posts/0f7543dd-c178-476b-b21e-bc509414dd9f.jpeg` | 2,985,744 | image/jpeg | 2026-08-22 14:04:25Z |
| `posts/d5332741-9202-4820-827c-5c4704554493.jpeg` | 818,332 | image/jpeg | 2026-08-22 14:04:26Z |
| `posts/6b158a66-61b9-46bb-adfe-feda2143cf8a.jpeg` | 318,149 | image/jpeg | 2026-08-22 14:04:27Z |
| `posts/b488327e-d26a-4cc8-8e25-9b5b6a66b676.jpeg` | 17,031 | image/jpeg | 2026-08-22 14:04:28Z |
| `posts/259aeff4-4d48-4a4b-be8f-8d9fb2678bf9.jpeg` | 4,215,039 | image/jpeg | 2026-08-22 14:04:34Z |

**Size distribution:** 21 of 52 objects exceed 2 MiB. Two exceed 5 MiB: `posts/f1bdd11f-377c-4c4a-b14e-0d75e2a87a0a.png` at **10,177,600 B (9.7 MiB)** and `posts/8532d40f-d744-435f-a8da-ddb4a9e426f6.jpeg` at 5,404,824 B. These are unprocessed phone-camera originals — no derivatives, no thumbnails, no responsive variants exist anywhere in the bucket.

---

## 3. Reference graph & orphans

Sources cross-referenced: every object under `post-img` vs. every URL in `posts.content_md` (regex `!\[…\]\(url\)`), `posts.cover_url`, `rockets.img`, `members.image`, and every value in `site_content`.

**Summary:**

| | count |
|---|---|
| Storage objects | 52 |
| Distinct Storage objects referenced from the DB | 49 |
| Total reference occurrences (49 body images + 20 covers) | 69 |
| **Orphans** (in Storage, referenced nowhere) | **3** (1,187,699 B / 1.13 MiB) |
| **Broken references** (in DB, missing from Storage) | **0** |
| **Local repo-path references** (not Storage URLs) | **8** (all files present) |
| External / third-party URLs | 0 |

All 49 referenced objects resolve. `site_content` references zero media.

### 3.1 Orphan objects — exact paths

Safe to *not* migrate, but confirm with the team first (they may be images intended for posts that were never published).

| path | size (bytes) | mimetype | created_at |
|---|---|---|---|
| `posts/9f4f0fc5-5f97-45f0-b451-7f84ff5b03f5.webp` | 54,466 | image/webp | 2026-01-23 19:34:03Z |
| `posts/dcf8fc1a-f92b-4abd-97a7-cd6ffc491dad.webp` | 149,884 | image/webp | 2026-01-23 20:08:57Z |
| `posts/6fc62896-ab36-4b0e-a34f-5694a3fa3dc9.png` | 983,349 | image/png | 2026-01-24 10:28:57Z |

Notes:
- The two `.webp` orphans predate the earliest post (`2026-01-24 12:27:46Z`) — they are pre-launch test uploads.
- `posts/6fc62896-…png` is **byte-identical** (same eTag `cf1f0e34…`) to the *referenced* object `posts/770591b8-4c98-47b7-b99e-20e7c9479880.png`, which is the cover of `EDF TVC 기체 설계 완료`. It is a re-upload of the same file, not unique content. Dropping it loses nothing.

### 3.2 Broken references

**None.** Every Storage URL in the database resolves to an existing object. There is nothing to repair.

### 3.3 DB image values that are LOCAL repo paths (different migration path)

These 8 values are **not** Storage URLs — they are absolute site paths served from `public/`. They must be migrated by **uploading the repo file to object storage** and rewriting the DB value, not by copying a Storage object. Every file was verified to exist on disk under `/Users/aiden/dev/ICAROS-web/public/`.

| DB value | source column | file exists under `public/` | size (bytes) |
|---|---|---|---|
| `/assets/img/rocket/icx1.webp` | `rockets.img` (`icx1`) | yes | 6,970 |
| `/assets/img/rocket/icx1s.webp` | `rockets.img` (`icx1s`) | yes | 6,574 |
| `/assets/img/rocket/icxmv1.webp` | `rockets.img` (`icxmv1`) | yes | 5,486 |
| `/assets/img/rocket/icxmv1lr.webp` | `rockets.img` (`icxmv1lr`) | yes | 5,876 |
| `/assets/img/member/kimjihoo.webp` | `members.image` (김지후) | yes | 14,506 |
| `/assets/img/member/parkhyunbin.webp` | `members.image` (박현빈) | yes | 49,776 |
| `/assets/img/member/sungwoo.webp` | `members.image` (이성우) | yes | 995,796 |
| `/assets/img/member/yeahram.webp` | `members.image` (백예람) | yes | 50,324 |

**8/8 present.** Combined 1,135,308 B (1.08 MiB). `sungwoo.webp` at 996 KB is ~20× the other member portraits and should be re-encoded on the way in.

**Repo image assets NOT referenced by any DB row** (in `public/`, currently unreachable from data — decide per-asset whether they migrate as media or are dropped):

- `public/assets/img/rocket/icx2.webp`, `icx2s.webp` — the ICX-II pair. `src/assets/rocket_info.json` still describes both as rockets; the `rockets` table does not. **Ambiguous: deliberate removal or lost data.** Ask before dropping.
- `public/assets/img/member/profile.webp` (placeholder), `standhyo.webp`, `kimkunwoo.webp`, `yunho.jpg` — portraits of members with no corresponding `members.image` value (some may be former members).
- `public/assets/img/gallery/01.webp` … `15.webp` — 15 files. **Hardcoded in the frontend, not in any table.** If the rebuild wants an editable gallery, these become media objects with no existing DB rows to attach to.
- `public/assets/icx-2.fbx` — 3D model, hardcoded.
- `public/og.png`, `public/favicon.png`, `src/assets/logo_*.svg`, `src/assets/down.png` — brand/chrome assets, not content.

---

## 4. Migration mapping table

Target names are **conceptual**. The real Neon table names and the S3 bucket/prefix layout are decided in `essentia_infra` and are deliberately not invented here.

> **`posts` migrates into the ESSENTIA Community ICAROS board — the single source of truth. Do NOT create a new `icaros_posts` table.** The ICAROS site must read its news feed from the Community board via whatever read API/view Community exposes. Any design that keeps a parallel ICAROS-owned posts table re-creates the dual-write problem this migration exists to remove.

| # | Source | Target entity concept | Transformation needed | Risk / edge cases |
|---|---|---|---|---|
| 1 | `posts` (20 rows) | **Community post** on the ESSENTIA Community **ICAROS board** — *not* a new table | Map `title`→post title, `content_md`→post body, `created_at`→published-at. Preserve the legacy `uuid` in an external-ref column so `/posts/:id` deep links and any inbound links survive. Assign an author: posts have **no author column**, so every row needs a synthetic/team account decided by the Community model. | **Highest-risk item.** Community's post model almost certainly has required fields ICAROS has no data for (author, board id, slug, status, updated_at). If Community enforces an author FK, 20 rows need an identity that does not exist today. Community's body format may not be Markdown — if it is a rich-text/block format, all 20 bodies need conversion, and image nodes must be rebuilt rather than string-substituted. Idempotency: re-running the import must not duplicate the board. |
| 2 | `posts.content_md` image URLs (49 distinct, 69 occurrences) | **Media object** + inline reference inside the community post body | Rewrite every `https://<project-ref>.supabase.co/storage/v1/object/public/post-img/posts/<uuid>.<ext>` to the new media URL. Rewrite **after** the objects land, in one pass, keyed by old→new path map. | URL rewriting is a text substitution on user content — a partial/failed pass leaves posts pointing at a Supabase project that will be deleted. Keep the Supabase bucket public and alive through a verification window. Two objects use uppercase `.PNG`; **S3 keys are case-sensitive** — a lowercasing normalization step silently 404s them. Alt text is camera filenames; if Community renders alt text, this is visible garbage worth blanking. |
| 3 | `posts.cover_url` (20 rows) | **Post cover / featured media** pointer | **Do not migrate as data.** It is exactly `first image of content_md` for all 20 rows (verified, 0 mismatches). Recompute after the body import so cover and body can never diverge. | If Community has no cover concept, the field is dropped and the list view loses its thumbnails — check before import. If it *does*, make sure it points at the migrated media object, not the Supabase URL. |
| 4 | `posts.summary` (20 rows) | **Post excerpt** | **Recompute from the migrated body; do not copy.** 13/20 stored values disagree with the current `buildSummary()`, 3 are blank/whitespace-only. | Copying verbatim ports raw `\n`, untrimmed whitespace, and 3 empty excerpts into the new system. If Community auto-generates excerpts, drop the column entirely. |
| 5 | `rockets` (4 rows) | **Rocket / vehicle record** (ICAROS-owned domain entity) | 1:1. Keep the slug `id` as the public URL key. Keep `series` as the grouping axis. | `sort_order` is unique only **within `series`** — a global unique index rejects the import; use `(series, sort_order)`. Spec numbers in the DB **contradict** `src/assets/rocket_info.json`; the DB is authoritative but the divergence should be confirmed with the team. `created_at` is a seed timestamp identical across rows — do not surface it as "built on". |
| 6 | `rockets.engines` (jsonb, 6 engine objects across 4 rows) | **Engine spec** — either a child table or a preserved JSON column | Decide now: normalize to a child table (`rocket_id`, `type`, `thrust_n`, `burn_time_s`, `count`, ordinal) or keep as `jsonb`. Array order encodes stage order and must be preserved either way. | Element shape is **non-uniform** — `count` exists only on the "Black Powder" stage. A strict typed schema needs `count` nullable-defaulting-to-1. Normalizing loses array ordering unless an explicit ordinal column is added. Only 6 rows total, so either choice is cheap — but choose deliberately. |
| 7 | `rockets.img` (4 local paths) | **Media object** + `rockets.image_ref` | Upload `public/assets/img/rocket/*.webp` from the repo to object storage, then rewrite the column to the new URL. **Not** a Storage-to-S3 copy. | Easy to overlook because it looks like the posts case but isn't — a bucket-to-bucket sync migrates 0 of these 4. Also decide the fate of `icx2.webp` / `icx2s.webp`, which have no DB row. |
| 8 | `members` (27 rows) | **Team member record** (ICAROS-owned) | 1:1. Keep `uuid` PK. | `sort_order` has a **3-way tie at 5** and gaps at 14/24 — unique index fails; ordering is non-deterministic today, so pick an explicit tiebreak (name, or re-compact to a dense sequence) as a **deliberate** decision. |
| 9 | `members.role` (8 distinct free-text values) | **Team / role assignment** | Either keep free text, or split into `team` + `title` — four values mix both (`부주관 · 전자부장`, `비행제어부 부장`, `주관 · 전 부분 총괄 설계`, `SW, 디자인`). | Enum-ifying will break: `SW, 디자인` is two roles in one string, and the `·`/`,` separators are inconsistent. If the new schema wants an enum, someone must hand-map all 27 rows. |
| 10 | `members.image` (4 of 27, local paths) | **Media object** + `members.image_ref` | Same as #7: upload from repo, rewrite column. 23/27 stay null → the target must render a placeholder. | `sungwoo.webp` is 996 KB — re-encode. Portraits are **personal images of minors** (middle/high-school students); the new bucket's public-read policy and any future removal request need an owner. |
| 11 | `members.school` (23 of 27) | Team-member attribute | 1:1, nullable. | Same minor-PII consideration as #10 — school + name + face is identifying. Confirm the new deployment keeps the same public exposure. |
| 12 | `site_content` (18 key/value rows) | **Landing page copy / site settings** | Keep the flat key→value shape, or model per-section records. Values are **not Markdown**. | Three encoding traps: (a) `\n` is a real newline and `mission.list` / `donate.usage_list` are newline-delimited **lists** — model them as arrays or the renderer must keep splitting on `\n`; (b) `**word**` in `about.slogan` / `vision.slogan` is a **bespoke Highlight marker**, not bold — a Markdown renderer will silently change the design; (c) `donation.goal` / `donation.current` are **numbers stored as text**. All 18 keys must exist at import or the landing page falls back to hardcoded `DEFAULTS` in `home.jsx` and silently shows stale copy. |
| 13 | Storage `post-img/posts/*` (52 objects, 90,881,239 B) | **Media object store** (S3 prefix TBD) | Copy 49 referenced objects; skip or archive the 3 orphans. Preserve or re-derive `mimetype` and `cacheControl`. Generate derivatives (thumbnail + web-size) at import — 21 objects exceed 2 MiB and none has a variant today. | Extension case (`.PNG` ×2). Content-Type must be set explicitly on S3 or images download instead of rendering. 90 MB is small enough for a single scripted copy — no need for a batch job. Old public URLs die when the Supabase project is deleted; anything cached or linked externally breaks at that instant. |
| 14 | Storage `post-img/rockets/`, `post-img/members/` | — | **Nothing to migrate.** Both prefixes are empty; the CMS upload path exists but was never used. | Only risk is assuming they hold data and building a copy step that silently moves 0 files while the real rocket/member images (#7, #10) are missed. |
| 15 | `public.admins` | **Admin / authorization grant** | **Cannot be read with the anon key** (RLS returns `[]`). Must be dumped with `service_role` or read from the Dashboard **before** the Supabase project is torn down. | Silent data loss: the migration "succeeds" and nobody can log in, with no error to point at. Also `auth.users` (email/password identities) is entirely outside PostgREST's reach — the new auth system needs its own account provisioning; passwords are not portable. |
| 16 | `auth.users` + Supabase Auth session model | **Identity / account** | Out of scope for the anon-key inventory. Accounts must be re-provisioned in the target auth system. | Password hashes are not exportable via any client API. Every admin needs a fresh credential + a communicated cutover. |
| 17 | Frontend-hardcoded media: `public/assets/img/gallery/*` (15), `icx-2.fbx`, unused member portraits | **Media object** (no DB row exists) | If the rebuild makes the gallery editable, these need both an upload *and* new records invented — there is no source table. | Pure scope creep risk: it looks like a data migration but it is a new feature. Decide explicitly whether the gallery is in scope. |
| 18 | Schema/DDL itself | Neon schema | Partial DDL is recoverable from `git show HEAD:supabase/migrations/000{1,2}_*.sql` (currently **deleted from the working tree**) — it covers `admins`, `rockets`, `members`, `site_content`, `is_admin()`, and all RLS policies. **`posts` has no DDL anywhere**; it was created in the Dashboard. | Restore the deleted migration files before the deletion is committed. `posts`'s real column types/defaults/indexes exist only in the live DB — take `pg_dump --schema-only` (needs `service_role`/DB password) **before teardown**. Also note the seed data in `0002` is badly out of sync with live (7→4 rockets, 21→27 members with a different role taxonomy) — **never re-run it as a fallback**. |

### 4.1 Ordering constraint

Media must land before the URL rewrite (#2, #7, #10 before their column updates), and `admins` / `auth` (#15, #16) and the schema dump (#18) must be captured **while the Supabase project is still alive** — they are the only items that become permanently unrecoverable after teardown.

---

## 5. Cutover procedure (TBD — blocked on essentia_infra)

