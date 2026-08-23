# 04 — Target Architecture (Next.js 16 on Vercel)

---

> ## ⚠️ 2026-08-23 갱신 — 아래 문서의 두 전제가 사실과 다릅니다
>
> `essentia_infra` 회신(1/2)으로 확인된 사실:
>
> 1. **ESSENTIA는 Drizzle을 쓰지 않습니다.** 2026-08-03에 Next 풀스택 → 정적 프론트 + **Spring Boot**로
>    전환하면서 Drizzle 43파일이 삭제됐습니다. 현재 스키마 소유자는 **Flyway** 단독
>    (`V1__baseline.sql` ~ `V18__vote_anonymous.sql`, `flyway_schema_history` 이력).
>    → 이 문서 §"Two-repo migration ownership"의 *"두 Drizzle 저장소 충돌"* 프레이밍은 무효.
>      다만 **결론(`push` 금지 · `generate`+`migrate`만 · 전용 원장 · 최소권한 role)은 그대로 유효**하며,
>      상대가 Flyway라 오히려 도구 충돌 위험은 사라지고 **스키마 분리**가 더 깨끗한 해법이 됩니다.
>
> 2. **Neon은 ESSENTIA의 AWS 인프라가 아닙니다.** 별도 SaaS 계정이며 Neon 콘솔 접근이 따로 필요합니다.
>
> **새로 드러난 최대 위험**: ESSENTIA는 `spring.jpa.hibernate.ddl-auto: validate`로 기동합니다.
> `public` 스키마에 낯선 컬럼·테이블이 생기면 **ESSENTIA API가 기동 실패**할 수 있습니다.
> → ICAROS 테이블은 `public.icaros_*`가 아니라 **별도 `icaros` 스키마**로 간다 (`05-database-plan.md` 참조).
>
> 버전 표·Next 16 API·Argon2id·R3F 관련 내용은 전부 유효합니다.

---


Research date: **2026-08-23**. Every version and API claim below was checked against a
primary source (nextjs.org docs at `version: 16.3.2`, vercel.com/docs, orm.drizzle.team,
neon.com/docs, npm registry, nodejs.org, OWASP). Anything not confirmed is tagged
`[unverified]`.

Scope: the migration of `icaros.kr` from a Vite + React 19.2 SPA (`/`, `/rocket`,
`/member`, `/posts`, `/admin`, 404) to a Next.js 16 App Router app on Vercel, with
Neon Postgres via Drizzle, self-managed admin auth, R3F for rocket 3D, and S3 for media.

No concrete table DDL or bucket names appear here — those are blocked on the
`essentia_infra` session (see [Open questions](#open-questions)).

---

## Target stack

Confidence key: **High** = stated in primary docs or read from the npm registry today.
**Med** = inferred from primary docs but the exact combination is not documented.
**Low** = not confirmed; treat as a decision to validate in a spike.

### Framework & runtime

| Package / setting | Version | Why | Confidence |
| --- | --- | --- | --- |
| `next` | `16.3.2` | Current `latest` on npm (published 2026-08-21). Turbopack stable + default, Cache Components, `proxy.ts`. | High |
| `react` / `react-dom` | `19.2.8` | Current `latest`. Next 16's App Router ships a React Canary that *includes* 19.2 features; `next`'s declared peer range is `^18.2.0 \|\| ^19.0.0`, so 19.2.8 is in range. | High |
| Node.js (Vercel) | `24.x` | Vercel default for new projects; `20.x` and `22.x` also offered. Next 16 minimum is **20.9.0**. Pin via `engines.node` in `package.json`. | High |
| TypeScript | `>= 5.1` | Next 16 hard minimum. Use latest 5.x. | High |
| Bundler | Turbopack (default) | Next 16 uses Turbopack for `next dev` **and** `next build`. A custom `webpack` config makes `next build` **fail** — so we ship zero webpack config. Turbopack options move to top-level `turbopack` in `next.config.ts`. | High |
| Vercel compute | Fluid compute (default) | "As of April 23, 2025, fluid compute is enabled by default for new projects." Enables warm TCP reuse + `waitUntil`. | High |

### Data layer

| Package | Version | Why | Confidence |
| --- | --- | --- | --- |
| `drizzle-orm` | `0.45.2` (`latest`) | Stable line. A `1.0.0-rc.4` exists under the `rc` tag and the docs site already shows `npm i drizzle-orm@rc`; **do not** adopt the RC for a production migration (see note below). | High (versions) / Med (choice) |
| `drizzle-kit` | `0.31.10` (`latest`) | Must match the `drizzle-orm` major. `1.0.0-rc.4` under `rc`. | High |
| `pg` | `8.23.0` | Vercel's and Neon's **current** recommendation for Vercel Functions on Fluid compute is a standard TCP driver, not an HTTP driver. Used via `drizzle-orm/node-postgres`. | High |
| `@types/pg` | `8.23.1` | Types for the above. | High |
| `@vercel/functions` | `3.9.5` | Provides `attachDatabasePool(pool)`, which uses Fluid's `waitUntil` to drain idle connections before instance suspension. | High |
| `@neondatabase/serverless` | `1.1.0` | **Not** in the default stack. Keep as the fallback if we ever need an Edge-runtime read path. Requires Node `>=19`. | High |
| `zod` | `4.4.3` | Input validation at every mutation boundary. Drizzle docs' own security guidance is "schema validation only checks the *shape*" — so zod is necessary, not sufficient. | High |
| `drizzle-zod` | `0.8.3` | Optional: derive insert/select schemas from the Drizzle table definitions. | High |

> **Drizzle v1 note.** `orm.drizzle.team` currently documents the v1 RC (`drizzle-orm@rc`),
> which is what the Neon connect page tells you to install. The v1 line is an architecture
> rewrite explicitly aimed at "kit and migration issues." Since our single highest risk is
> *migration behavior against a shared database*, take the boring option: pin `0.45.2` /
> `0.31.10`, and re-evaluate v1 after it goes stable. When reading the Drizzle docs, be aware
> the code samples may be v1-shaped. `[unverified]` — no published stable-release date for
> Drizzle v1.

### Auth & crypto

| Package | Version | Why | Confidence |
| --- | --- | --- | --- |
| `@node-rs/argon2` | `2.1.0` | Argon2id via NAPI-RS prebuilt binaries — **no node-gyp, no postinstall compile**. Already on Next.js's built-in `serverExternalPackages` auto-opt-out list, so Turbopack will not try to bundle the `.node` files. Its library defaults are exactly OWASP's recommended `m=19456, t=2, p=1`. | High |
| `server-only` | `0.0.1` | Build-time guard. Next handles the import internally; installing it only satisfies lint rules about extraneous deps. | High |
| `node:crypto` | built-in | `randomBytes(size)` for session tokens, `timingSafeEqual(a, b)` for constant-time comparison of token hashes, `createHash` for at-rest hashing of session tokens. | High |

Rejected alternatives:

- **`argon2` (`0.45.1`, node-argon2)** — also on Next's external list, but it is node-gyp based
  and historically needed `outputFileTracingIncludes` gymnastics on Vercel. Slower than
  `@node-rs/argon2` at identical `m/t/p` per node-rs's own published benchmark, and its
  *defaults* (`m=65536, t=3, p=4`) are heavier than OWASP's baseline.
- **`hash-wasm` (`4.12.0`)** — pure WASM, zero native binding risk, but ~2.6× slower than the
  native binding at `m=19456, t=2, p=1`. Keep as the escape hatch if `@node-rs/argon2` ever
  fails to resolve its platform package on a Vercel build.
- **`node:crypto.argon2` / `argon2Sync`** — landed in Node 24.7.0 and Vercel's default runtime
  is 24.x, so this would be zero-dependency. But it is **Stability 1 (Experimental)** and it is a
  *raw KDF* — it returns a derived tag, not a PHC-encoded string, so we'd hand-roll salt
  generation, encoding, and parameter versioning. Revisit when it stabilizes.
  `[unverified]` — the exact parameter-object field names (`nonce` vs `salt`, `memory` vs
  `memoryCost`, `passes`, `tagLength`) were not confirmed from the Node docs; a small-model
  read of the page returned an "Added in" version inconsistent with the release notes.

### 3D

| Package | Version | Why | Confidence |
| --- | --- | --- | --- |
| `three` | `0.185.1` | Current `latest` (2026-07-01). | High |
| `@react-three/fiber` | `9.7.0` | Peer: `react: ">=19 <19.3"`, `react-dom: ">=19 <19.3"`, `three: ">=0.156"`. React 19.2.8 is inside that window. | High |
| `@react-three/drei` | `10.7.8` | Peer: `react: "^19"`, `three: ">=0.159"`, `@react-three/fiber: "^9.0.0"`. | High |
| `@gltf-transform/cli` | `4.4.2` | Build-time GLB optimization (Draco / meshopt / KTX2). Dev dependency only — never shipped. | High |

**R3F's React 19 status, precisely.** R3F **v9 is the React 19 compatibility release** — it
upgraded the internal reconciler for React 19 and dropped React 18. The peer range is a
*window*, not an open upper bound: when React went to 19.2.x it bumped its internal reconciler
in a way that was not backward-compatible with 19.1.x, so R3F declares
`react: ">=19 <19.3"` and is "compatible with all versions of React between 19.0 and 19.2."
React 19.2 support landed in R3F **9.5.0**; 9.7.0 was published 2026-07-31.

**The React 19.3 cliff is the real risk here.** React 19.3 canaries are being published
(`19.3.0-canary-*`, latest 2026-08-19). The moment React 19.3 ships as `latest`,
`npm install react@latest` will break the R3F peer constraint. Consequences:

- Pin `react` and `react-dom` to an exact `19.2.x` in `package.json` (not `^19.2.0`).
- Next 16's own peer range (`^19.0.0`) will happily accept 19.3, so npm will not protect us.
- Treat "R3F declares support for React 19.3" as a gate before any React minor bump.
- `[unverified]` — no R3F statement about React 19.3 or a v10 timeline. `10.0.0-alpha.3` exists
  on the `alpha` tag; its React target is unknown.

`@react-three/drei@10.7.8` was published 2026-08-05, after `three@0.185.1` (2026-07-01), so the
pairing is plausible, but `[unverified]` — neither R3F nor drei publishes an explicit
"tested against three 0.185" statement. Their declared peer floors (`>=0.156` / `>=0.159`) are
satisfied. Lock `three` to an exact version and bump it deliberately.

### Media / storage

| Package | Version | Why | Confidence |
| --- | --- | --- | --- |
| `@aws-sdk/client-s3` | `3.1116.0` | Current v3. `engines.node >= 20`. On Next's default `serverExternalPackages` list. | High |
| `@aws-sdk/s3-request-presigner` | `3.1116.0` | `getSignedUrl(client, new PutObjectCommand(...))` — presigned **PUT**. | High |
| `@aws-sdk/s3-presigned-post` | `3.1116.0` | `createPresignedPost(...)` — presigned **POST** with a server-enforced policy. Also on Next's default external list. | High |

All three `@aws-sdk/*` packages share the same version line; keep them in lockstep.

**`@google/model-viewer` is not in the stack.** Its latest (`4.3.1`) declares
`peerDependencies: { "three": "^0.183.0" }`, which conflicts with `three@0.185.1`. If we ever
adopt it, it replaces R3F rather than coexisting with it.

---

## Rendering & routing model

### Route map

| Route | Component kind | Rendering | Notes |
| --- | --- | --- | --- |
| `app/layout.tsx` | Server | Static shell | Root layout. **Must not** read `cookies()`/`headers()` — see the `loading.tsx` caveat below. |
| `app/page.tsx` (`/`) | Server | Cacheable | Landing copy read from DB in a Server Component. No more `DEFAULTS` overlay hack — the server already has the data before first paint. |
| `app/rocket/page.tsx` | Server shell + **client 3D island** | Cacheable shell, client-only canvas | Rocket specs/table are Server Components. The R3F canvas is the only client subtree. |
| `app/member/page.tsx` | Server | Cacheable | Pure list render. |
| `app/posts/page.tsx` | Server | Cacheable, paginated | Selects only the light columns. Pagination via `searchParams` (now `Promise`). |
| `app/posts/[slug]/page.tsx` | Server | Cacheable per slug | Replaces the current client-side modal fetch of `content_md`. Markdown → HTML **on the server**; the `react-markdown` + `rehype-highlight` + `highlight.js` bundle leaves the client entirely. |
| `app/admin/**` | Server gate + **client forms** | Always dynamic | Session cookie read ⇒ request-time. Panels are Client Components; every write is a Server Action. |
| `app/not-found.tsx` | Server | — | Replaces the SPA `path="*"` route. The `FuzzyText` canvas component becomes a small client island. |
| `app/error.tsx`, `app/global-error.tsx` | **Client** (required) | — | See conventions below. |
| `proxy.ts` | Node runtime | — | Only if we need admin path gating at the edge of routing. See below. |

### Async request APIs — the mechanical breaking change

In Next.js 16 synchronous access is **fully removed** (the 15-era compatibility shim is gone).
Everything below is a `Promise`:

- `cookies()`, `headers()`, `draftMode()`
- `params` in `layout`, `page`, `route`, `default`, `opengraph-image`, `twitter-image`,
  `icon`, `apple-icon`
- `searchParams` in `page`
- **New in 16:** the `params` and `id` props passed to the *image-generating* functions in
  `opengraph-image` / `twitter-image` / `icon` / `apple-icon` are Promises. (`generateImageMetadata`
  still receives synchronous `params`.)
- **New in 16:** the `id` passed to a `sitemap` function from `generateSitemaps` is a Promise.

Use the generated prop helpers rather than hand-writing the Promise types:

```tsx
// app/posts/[slug]/page.tsx
export default async function Page(props: PageProps<'/posts/[slug]'>) {
  const { slug } = await props.params
  const query = await props.searchParams
}
```

`PageProps` / `LayoutProps` / `RouteContext` are generated by `npx next typegen`.

### `loading.tsx` / `error.tsx` / `not-found.tsx` in 16

**`loading.tsx`** — unchanged convention (introduced v13.0.0), but two behaviors matter:

- It wraps `not-found.js`, `page.js`, and nested `layout.js` in a `<Suspense>` boundary. It does
  **not** wrap the `layout.js`, `template.js`, or `error.js` in the *same* segment.
- **If a layout reads uncached/runtime data, `loading.tsx` will not show a fallback for it** —
  navigation blocks until the layout finishes. Keep all runtime data reads in `page.tsx`, or wrap
  them in their own `<Suspense>` inside the layout. This is a hard design constraint on our root
  layout: the header must not await anything request-scoped.

**`error.tsx`** — must be a Client Component. **The prop changed in 16:**

- `retry: () => void` became **stable in v16.3.0** (it was `unstable_retry` in 16.2.0). `retry()`
  re-fetches *and* re-renders the boundary's children.
- `reset` still exists but the docs now say "in most cases, you should use `retry()` instead" —
  `reset` only clears error state and re-renders without re-fetching.
- `error.message` from a **Server** Component is a generic string in production; correlate via
  `error.digest` against server logs.
- `global-error.tsx` must render its own `<html>`/`<body>`, does **not** get global styles, and
  cannot export `metadata`/`generateMetadata` (use React's `<title>` component).

**`not-found.tsx`** — root `app/not-found.tsx` handles both `notFound()` throws and unmatched
URLs. Status-code caveat that matters for SEO: Next returns **200 for streamed responses** and
404 for non-streamed ones, injecting `<meta name="robots" content="noindex">` in the streamed
case. If we ever need a real 404 status for `/posts/[bad-slug]`, the existence check must run
**before** any `await` that can suspend, and before the first Suspense fallback renders.
`global-not-found.js` exists but is still experimental (`experimental.globalNotFound`) — skip it,
we have a single root layout.

### Metadata for CMS-driven titles / OG

Use `generateMetadata` in `app/posts/[slug]/page.tsx` and `app/page.tsx`. Two things to get right:

1. **Streaming metadata is the default and it is what keeps TTFB low.** Next renders and sends the
   initial UI without waiting for `generateMetadata`; when it resolves, the tags are appended to
   `<body>`. Bots that execute JS (Googlebot) see them in the DOM. For **HTML-limited bots** that
   can't execute JS (`facebookexternalhit`, Twitterbot), Next detects the User-Agent and *blocks*
   so the tags land in `<head>`. The bot list is overridable via the top-level `htmlLimitedBots`
   config. **Do not touch `htmlLimitedBots`** — the docs explicitly warn that overriding it leads
   to longer response times, and the default handles our OG-preview case correctly.
2. **Deduplicate the fetch.** `generateMetadata` and the page both need the post. Wrap the loader
   in React's `cache()` so both calls share one query per request. This is the same
   `cache()`-wrapped-DAL pattern Next's data-security guide recommends.

If we later enable `cacheComponents`, `generateMetadata` follows the same rules as any component:
a page that is otherwise fully prerenderable but whose metadata defers to request time will raise
a **build error** demanding an explicit choice. The documented fix is `'use cache'` inside
`generateMetadata` — with the caveat that its return value must then be serializable, so
`metadataBase` has to be a string (`url.toString()`), not a `URL`.

### Caching posture — start without Cache Components

`cacheComponents: true` is the Next 16 successor to `experimental.ppr` + `dynamicIO` + `useCache`
(all three flags removed). It is explicitly **not a rename-only change**: it surfaces build errors
for uncached data outside `<Suspense>` and requires adopting the whole Cache Components model.

**Recommendation: ship the migration with `cacheComponents` off.** The rebuild is already changing
the framework, the database, the auth model, and the storage backend simultaneously. Adopt Cache
Components as a follow-up PR once the app is stable, then the `instant` route segment config
(16.x, Cache-Components-only) becomes available to validate navigation instantness in dev.

Without `cacheComponents`, all dynamic code runs at request time by default — which for a
low-traffic team site is entirely adequate.

### Where R3F is isolated

```
app/rocket/page.tsx            Server Component — specs, copy, table
  └─ components/RocketViewer.tsx        'use client'   ← the boundary
       └─ const Scene = dynamic(() => import('./RocketScene'), { ssr: false })
            └─ components/RocketScene.tsx   'use client' — <Canvas>, three, drei
```

**`next/dynamic` with `ssr: false` still works in Next 16, but only inside a Client Component.**
The docs are explicit: *"`ssr: false` is not allowed with `next/dynamic` in Server Components.
Please move it into a Client Component."* Hence the two-file split — `RocketViewer` exists solely
to be the `'use client'` file that legally owns the `ssr: false` call.

Additional caveats for this pattern in 16:

- *"When a Server Component dynamically imports a Client Component, automatic code splitting is
  currently **not** supported."* Another reason the `dynamic()` call lives inside `RocketViewer`,
  not in `page.tsx`.
- Turbopack magic comments differ from webpack's: use `turbopackIgnore` / `turbopackOptional`.
  `webpackOptional` is not supported.
- WebGL context creation must be feature-detected, not assumed — see the fallback strategy below.

### GLB delivery

**Compression.** Run `@gltf-transform/cli` at build time (or once, offline, committed as an
optimized artifact). Draco and meshopt land in a similar place for a typical rocket model
(one published comparison: 5.03 MB → 3.29 MB Draco vs 3.4 MB meshopt, with `gltfpack`'s advanced
meshopt options reaching ~2.5 MB). `[unverified]` — those figures come from a community forum
thread, not vendor docs; measure our own model before choosing.

Decision rule for us:

- **Meshopt (`EXT_meshopt_compression`)** is the default choice: the decoder is small and
  synchronous, and drei/three wire it up without shipping a separate WASM+worker bundle the way
  Draco does.
- **Draco** if the model is geometry-dominated and meshopt leaves it >2 MB. Note Draco compresses
  only static geometry — it cannot compress morph targets.
- Compress the **final** asset only. Blender and most DCC tools cannot re-open compressed GLB.
- Textures: KTX2/Basis via the same CLI, not PNG/JPEG in the GLB.

**`<model-viewer>` vs R3F.** `<model-viewer>` is a lower-effort, lower-ceiling option: a web
component with built-in `poster`, lazy loading, and AR, at the cost of a fixed camera/interaction
model and a `three@^0.183.0` peer pin that fights our `three@0.185.1`. R3F costs more code but
gives full control over the scene, and we already have the React idiom. **Choose R3F**, and steal
`<model-viewer>`'s good idea — the poster — rather than the library.

**Mobile / no-WebGL fallback (three tiers).**

1. **Poster first, always.** Render a static, `next/image`-optimized still of the rocket as the
   default content of the viewer slot. It is in the HTML from the server, so LCP is a plain image.
2. **Upgrade to WebGL on the client** only after (a) the `RocketViewer` client island mounts,
   (b) a WebGL2 context probe succeeds, and (c) an IntersectionObserver says the slot is in view.
   Only then does `dynamic(..., { ssr: false })` pull the three/R3F chunk.
3. **Never upgrade** when the probe fails, `navigator.connection.saveData` is set, or
   `prefers-reduced-motion: reduce` — the poster stays. `[unverified]` — no vendor guidance
   prescribes this exact ladder; it is a design recommendation, not a documented pattern.

---

## Data access layer

### Connection: `pg` + `attachDatabasePool`, not the Neon HTTP driver

This is a reversal of the older "always use the serverless HTTP driver" advice, and both vendors
now say so. Neon's own decision table:

| Environment | Driver | Pooling |
| --- | --- | --- |
| Vercel (Fluid) | `pg` | `@vercel/functions` |
| Cloudflare Workers | `@neondatabase/serverless` | N/A |
| Netlify / Deno Deploy | `@neondatabase/serverless` | N/A |

Neon: *"Vercel Fluid keeps functions warm long enough to reuse TCP connections, so you skip the
connection setup cost on subsequent requests."* Vercel's engineering post frames it as solving the
classic leak: `attachDatabasePool` uses Fluid's `waitUntil` to "keep the function alive until the
timer fires and closes the client" before suspension.

The documented shape (Neon's own Drizzle example, verbatim in structure):

```ts
// src/server/db/client.ts
import 'server-only'
import { attachDatabasePool } from '@vercel/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
attachDatabasePool(pool)

export const db = drizzle({ client: pool, schema })
```

**Pooled vs unpooled connection strings.** Neon's pooled endpoint carries a `-pooler` suffix in the
host and runs PgBouncer in transaction mode; the direct endpoint omits it. Neon's guidance:

- **Runtime (the app):** pooled. Handles many short-lived connections; PgBouncer's
  `max_client_conn` is 10,000 while raw `max_connections` is compute-size-bound (104–4,000).
- **Migrations:** **direct/unpooled.** Neon states schema migrations need direct connections
  because "tools may not support transaction pooling."
- Pooled connections do not support `SET`, temp tables, or SQL-level `PREPARE`/`DEALLOCATE`.
  Practical consequence: **never rely on `SET search_path`** — always qualify the schema in queries,
  which Drizzle does for us if the schema is declared on the table objects.

So we need **two** env vars, not one. Names are pending the infra session, but the shape is
`DATABASE_URL` (pooled, used by the app) and a separate unpooled URL used only by `drizzle-kit`.
`[unverified]` — Neon's Fluid-compute Drizzle example uses `DATABASE_URL` without stating whether
it is the pooled or direct string. Given the general pooled-at-runtime guidance, treat it as pooled.

**Fluid compute interaction.** Fluid shares one process across concurrent invocations
("in-function concurrency"), so the `Pool` is genuinely shared, and pool sizing is per-instance
rather than per-request. Keep `max` small (single digits) — with in-function concurrency, a large
per-instance pool multiplied by instance count is how you exhaust Neon's `default_pool_size`
(90% of `max_connections`).

### Two-repo migration ownership — the highest-risk item

**The situation.** Two independently deployed repos (this one and ESSENTIA's Community app) share
one Neon database. Our `drizzle-kit` must be structurally incapable of touching ESSENTIA's tables.
A single careless `drizzle-kit push` against the shared database is a data-loss event.

Defense in depth, four layers. Layers 1 and 2 are mandatory; 3 and 4 are strongly recommended.

#### Layer 1 (mandatory) — never introspect the live database: `generate` + `migrate` only

This is the single most important rule, and it is a property of how the two commands work:

- **`drizzle-kit generate`** *"will read through your previous migrations folders and compare
  current json snapshot to the most recent one."* It compares **schema files against a stored JSON
  snapshot in our own `out/` folder**. It does not connect to the database and **does not require
  credentials**. Tables it has never seen simply do not exist in either side of the diff, so no
  `DROP` can ever be emitted for them.
- **`drizzle-kit push`** does the opposite: it *introspects the live database* and reconciles it
  toward our schema files. That is exactly the operation that can propose dropping tables it
  doesn't own. `[unverified]` — the Drizzle docs never state explicitly that `push` drops unknown
  tables; they only document `--force` as data-loss-capable and `--explain` as the dry run. Because
  the docs are silent, treat `push` as unsafe by assumption.

**Rule: `drizzle-kit push` is banned in this repo.** Enforce it — no `db:push` script in
`package.json`, and a CI grep that fails the build if `drizzle-kit push` appears anywhere. The only
sanctioned commands are `drizzle-kit generate` (locally, no credentials) and `drizzle-kit migrate`
(against the **unpooled** URL, applying only our own committed SQL files).

#### Layer 2 (mandatory) — a private migrations ledger

`drizzle-kit migrate` records applied migrations in `__drizzle_migrations` in the `drizzle` schema
**by default**. Both repos would collide there. Override it:

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/*',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  migrations: {
    table: '__drizzle_migrations_icaros', // `__drizzle_migrations` by default
    schema: 'drizzle',                    // or our own schema — see Layer 3
  },
  tablesFilter: ['icaros_*'],
  // schemaFilter: ['icaros'],  // if Layer 3 uses a dedicated schema
})
```

Both `migrations.table` and `migrations.schema` are documented config keys with exactly those
defaults.

#### Layer 3 (recommended) — own a namespace, either a schema or a prefix

Two viable ways to make ownership legible, and they are not mutually exclusive:

**(a) A dedicated Postgres schema** — the strongest boundary. Declare our tables under a
`pgSchema('icaros')` and set `schemaFilter: ['icaros']` so `drizzle-kit` never even looks at
`public`. Requires a Postgres role whose grants are scoped to that schema (blocked on the infra
session). Caveat: because the pooled endpoint can't run `SET search_path`, every query must be
schema-qualified — Drizzle does that automatically when the schema is on the table object.

**(b) A table-name prefix via `pgTableCreator`** — Drizzle's own documented "Multi-project schema"
pattern for exactly this situation:

```ts
import { serial, text, pgTableCreator } from 'drizzle-orm/pg-core'

const pgTable = pgTableCreator((name) => `icaros_${name}`)

export const users = pgTable('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
})
```

paired with `tablesFilter: ['icaros_*']` in the config. The generated DDL is
`CREATE TABLE "icaros_users" (...)`. This works without any role/schema coordination, which is why
it is the recommendation **if the infra session says a dedicated schema and role are not on the
table**.

`tablesFilter` is glob-based (`string | string[]`, default `"*"`) and `schemaFilter` is
`string[]` (default `["*"]`). The docs describe them as the mechanism for *"when you have external
systems managing certain tables — Drizzle won't attempt changes to filtered-out objects."* That is
literally our case. Note that these filters primarily govern the introspecting commands
(`push`, `pull`, `studio`); they are the belt to Layer 1's braces, not a substitute for it.

#### Layer 4 (recommended) — least-privilege at the database

Ask the infra session for a role whose grants cover only our namespace. If the ORM literally lacks
`DROP` privileges on ESSENTIA's tables, the worst-case migration bug is a failed migration rather
than a destroyed table. This is the only layer that survives human error in layers 1–3.

#### Operational rules

- **Review every generated SQL file before committing.** `generate` writes plain `.sql`; any
  `DROP TABLE` / `DROP COLUMN` that isn't ours is an immediate stop.
- **`drizzle-kit migrate` runs as an explicit, gated step**, never as part of `next build`. A Vercel
  build runs on every preview deploy; migrations must not.
- **Never run `drizzle-kit pull`** against the shared database into our schema folder — it would
  import ESSENTIA's tables into our snapshot and make them look like ours.
- Keep the `drizzle/` folder (SQL + `meta/*.json` snapshots) in version control. The snapshots
  *are* the source of truth for `generate`; losing them means the next `generate` tries to create
  the world from scratch.

### Data Access Layer shape

Follow Next's documented **Data Access Layer** pattern (their explicit recommendation for new
projects, over "component-level data access"):

```
src/server/
  db/
    client.ts      import 'server-only'  — the Pool + drizzle instance
    schema/*.ts    table definitions (prefixed / schema-scoped)
  data/
    posts.ts       import 'server-only'  — queries + authz + DTO mapping
    rockets.ts
    members.ts
    site-content.ts
  auth/
    session.ts     import 'server-only'  — cache()'d getCurrentUser()
```

Rules the Next docs state directly:

- The DAL *"should only run on the server, perform authorization checks, and return safe, minimal
  Data Transfer Objects (DTOs)."*
- *"Secret keys should be stored in environment variables, but **only the Data Access Layer should
  access `process.env`**."*
- Wrap the session read in React's `cache()` so it is shared per-request without being passed from
  component to component — *"this discourages passing it from Server Component to Server Component
  which minimizes risk of passing it to a Client Component."*
- Return DTOs, never raw rows. Never `select *` into a prop for a Client Component.

---

## Mutation model

### Decision: Server Actions for CMS writes, Route Handlers for upload presigning

**Server Actions are the default** for every admin CMS mutation (create/update/delete post,
rocket, member, landing copy). Reasons, from the docs:

- **One roundtrip.** When an action calls `updateTag`, `revalidatePath`, `refresh`, `redirect`, or
  mutates cookies, Next runs the action *and* re-renders the current route server-side, returning
  both the action's return value and a fresh RSC Payload in a single Flight stream. *"Your
  application code does not need a follow-up fetch to see the updated UI."* This is exactly the
  admin-panel interaction shape.
- **Framework CSRF for free** (details below).
- **Encrypted, rotating action IDs + dead-code elimination**, so unused actions have no public
  endpoint at all.

**Route Handlers** are the right tool in exactly two places:

1. **S3 presigned-URL issuance.** Next dispatches Server Actions **one at a time per client** —
   *"do not rely on `Promise.all` to parallelize Server Actions from the client."* Uploading five
   images would serialize five presign requests. A `POST /api/admin/uploads/presign` Route Handler
   has no such queue. The docs themselves point to Route Handlers "for non-mutation requests."
2. **Anything a non-browser client calls** (webhooks, health checks). None planned today.

**Everything else stays a Server Action.** Do not build a REST layer.

### Where the mutation logic lives

Thin `'use server'` actions delegating to a `server-only` DAL — the pattern the data-security guide
now shows explicitly:

```ts
// src/server/data/posts.ts
import 'server-only'
// auth + authz + db access live here

// app/admin/posts/actions.ts
'use server'
import { deletePost } from '@/server/data/posts'
import { revalidatePath } from 'next/cache'

export async function deletePostAction(postId: string) {
  await deletePost(postId)   // auth + authz inside the DAL
  revalidatePath('/posts')
}
```

The docs confirm `import 'server-only'` is legal in both the DAL *and* the `"use server"` file,
even when the action is imported into a Client Component for `useActionState`, "because
`"use server"` modules are resolved in a server-only webpack layer."

### What Next gives you, and what you must add

**Provided by the framework (verified):**

| Protection | Detail |
| --- | --- |
| CSRF: Origin/Host check | Server Actions are POST-only, and Next compares `Origin` against `Host` (or `X-Forwarded-Host`); mismatch ⇒ request aborted. |
| Body size limit | 1MB default. Tunable via `experimental.serverActions.bodySizeLimit`. |
| Encrypted action IDs | Non-deterministic, regenerated on new builds, cached at most 14 days. |
| Dead-code elimination | Unused exported actions are stripped from the client bundle, so no public endpoint is created. |
| Closure encryption | Variables captured by an inline action are encrypted before being sent to the client. |

Config note: `serverActions` (both `allowedOrigins` and `bodySizeLimit`) is documented **under
`experimental`** in the 16.3.2 docs, despite Server Actions themselves being stable since 14:

```js
// next.config.js
module.exports = {
  experimental: {
    serverActions: {
      allowedOrigins: ['my-proxy.com', '*.my-proxy.com'],
      bodySizeLimit: '2mb',
    },
  },
}
```

We are a single apex domain behind Vercel's own proxy, so **we should not need `allowedOrigins`**
— add it only if a preview-domain or custom-proxy setup starts failing the Origin check.

**You must add yourself.** The docs are blunt: *"Framework protections are not a substitute for
application-level checks"* and *"a page-level authentication check does not extend to the Server
Actions defined within it."*

Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` only if we self-host across multiple instances; on Vercel
this is managed. `[unverified]` — Vercel docs were not checked for whether they set this
automatically for Next deployments.

### Mutation checklist — every action must satisfy all seven

1. **Authenticate inside the action** (or inside the DAL it calls). Never rely on the fact that the
   form only renders on an authenticated page.
2. **Authorize the specific resource**, not just the session. Guard against IDOR: *"a well-formed
   `Item` object can still refer to a row the caller does not own."* For a single-tenant admin
   console this collapses to "is this session an admin," but write the check explicitly.
3. **Take a reference, not the record.** Accept an id plus the user's change; re-read everything
   else from the database using the session. Never accept a whole row from the client.
4. **Validate shape with zod.** `FormData`, `searchParams`, and headers are untrusted. Remember
   validation checks shape only — it is step 4, not step 2.
5. **Constrain the return value.** Action returns are serialized to the client. Return
   `{ success: true }` or a narrow DTO, never a raw row.
6. **Revalidate deliberately.** Pick one:
   - `updateTag(tag)` — read-your-own-writes, Server-Actions-only. Expires and immediately refetches
     within the same request. **This is the default for admin CMS writes** — the editor must see
     their edit instantly.
   - `revalidatePath('/posts')` — invalidate by URL; simplest when one route is affected. Also
     triggers the in-response re-render.
   - `revalidateTag(tag, profile)` — **now requires a second `cacheLife` argument in 16**
     (`'max'`, `'hours'`, `'days'`, or `{ expire: 3600 }`). The single-argument form is deprecated
     and produces a TypeScript error. Stale-while-revalidate: it does **not** include a re-render
     in the action response. Use only for public content where eventual consistency is fine.
   - `refresh()` — refetch the current route's RSC Payload without touching the cache.
   - Call revalidation **before** `redirect()`, because `redirect` throws a control-flow exception
     and nothing after it runs.
   - Note `revalidateTag`/`cacheTag`/`cacheLife` lost their `unstable_` prefixes in 16 — import
     them plainly from `next/cache`.
7. **Force a hard failure on destructive ops.** Deletes should throw, not silently no-op, when a
   check misses. Consider elevated/re-auth for bulk deletes.

Deployment consideration to design the admin UI around: action IDs rotate with builds
("at most every 14 days, even when the source is unchanged"), so a client sitting on an old build
can hit a missing action ID and get *"Failed to find Server Action."* Surface it as a retry prompt
("페이지를 새로고침해 주세요"), not a hard error.

### Session cookie design

`cookies()` is async in 16 (async since 15.0.0-RC; the sync shim is gone in 16). It can only be
*written* in a Server Function or Route Handler — *"HTTP does not allow setting cookies after
streaming starts."*

```ts
// login action
const cookieStore = await cookies()
cookieStore.set('icaros_admin_session', token, {
  httpOnly: true,   // no JS access
  secure: true,     // HTTPS only
  sameSite: 'lax',  // see below
  path: '/',
  maxAge: 60 * 60 * 8,
})
```

`sameSite: 'lax'` over `'strict'`: `'strict'` would drop the cookie on any cross-site navigation
into `/admin` (e.g. an emailed link), forcing a re-login for no real gain here. `'lax'` still
blocks cross-site POST, and Server Actions add the Origin/Host check on top. Choose `'strict'`
only if the admin console never needs to be reachable from an external link.

Session token handling, all with Node built-ins:

- **Generate:** `crypto.randomBytes(32)` → base64url. High-entropy, opaque, no JWT to mis-verify.
- **Store:** persist only `sha256(token)` in the sessions table. A database leak then yields no
  usable cookies.
- **Compare:** `crypto.timingSafeEqual(a, b)` on the two hash **buffers**. Note both inputs must be
  the same length — comparing fixed-length SHA-256 digests satisfies that naturally, whereas
  comparing raw tokens would leak length. This is another reason to compare hashes, not tokens.
- **Password verify:** `argon2.verify(storedPhcString, submittedPassword)` — the PHC string carries
  its own salt and parameters, so no separate salt column and no manual comparison.

**Runtime.** No action needed: the route segment `runtime` option **defaults to `'nodejs'`** in
Next 16, and `'edge'` is marked *deprecated* in the config table. So Argon2 and `pg` run on Node
without any `export const runtime` declaration. Two related notes:

- If we add a `proxy.ts`, note **the `edge` runtime is NOT supported in `proxy`** — `proxy` is
  Node.js and *cannot be configured*. That is convenient for us, but keep proxy logic thin
  (cookie-presence check and redirect at most). The real authorization gate stays in the DAL.
- `middleware.ts` is deprecated in favor of `proxy.ts`; config flags renamed too
  (`skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`).

### Argon2id parameters

Use OWASP's baseline: **`m=19456` KiB (19 MiB), `t=2`, `p=1`**, Argon2id, v19, 32-byte tag.
OWASP lists five configurations and states *"these configuration settings provide an equal level of
defense, and the only difference is a trade off between CPU and RAM usage"*:

| memory | iterations | parallelism |
| --- | --- | --- |
| m=47104 (46 MiB) | t=1 | p=1 |
| **m=19456 (19 MiB)** | **t=2** | **p=1** |
| m=12288 (12 MiB) | t=3 | p=1 |
| m=9216 (9 MiB) | t=4 | p=1 |
| m=7168 (7 MiB) | t=5 | p=1 |

`@node-rs/argon2`'s own defaults are already `memoryCost: 19456`, `timeCost: 2`,
`parallelism: 1`, `outputLen: 32`, `algorithm: Argon2id`, `version: V0x13` — so
`await hash(password)` with no options is the OWASP-recommended configuration. Still pass them
explicitly so a future library default change can't silently weaken us.

Why not a heavier config: under Fluid compute, concurrent invocations share one instance, and
`memoryCost` is *per thread*. 19 MiB × concurrency is the real footprint. This is an admin-only
login with single-digit hashes per day, so raising `t` is cheap — but `m=19456,t=2,p=1` already
lands at ~7.6 ms on modern hardware, comfortably inside OWASP's "less than one second" ceiling with
huge headroom if we ever want to raise it.

Also: **rate-limit the login action.** Argon2's cost is the defense against offline cracking, not
online guessing. The docs point at the Backend-for-Frontend guide's rate-limiting example for
"expensive operations."

### S3 presigned uploads: PUT vs POST

**Recommendation: presigned POST (`createPresignedPost` from `@aws-sdk/s3-presigned-post`).**

| | Presigned PUT (`getSignedUrl` + `PutObjectCommand`) | Presigned POST (`createPresignedPost`) |
| --- | --- | --- |
| Size enforcement | None server-side. You can sign a `Content-Length`, but the client controls the request. | **`['content-length-range', 0, N]` policy condition**, enforced by S3 itself. |
| MIME enforcement | `ContentType` must match what was signed, or the request fails signature validation — effectively a pin to one exact value. Historically leaky. | `['starts-with', '$Content-Type', 'image/']` and key-prefix `starts-with` conditions. |
| Client shape | Single `fetch(url, { method: 'PUT', body: file })`. | Multipart form POST with returned `fields`. |
| Extra header signing | Supports `unhoistableHeaders` for `x-amz-*` (e.g. checksums). | Policy-based. |

For **browser uploads with size and MIME enforcement** — which is precisely our admin image-upload
case — the policy conditions of presigned POST are the deciding factor. A presigned PUT cannot stop
a client from uploading a 2 GB file to the URL you handed it; the POST policy's
`content-length-range` can. `[unverified]` — the `content-length-range` and `starts-with` condition
syntax above came from a search summary of AWS docs, not a direct read of the
`@aws-sdk/s3-presigned-post` API reference. Verify the exact `Conditions` array shape before
implementing.

Presigned-URL expiry can be set as high as 7 days via the SDKs; use **minutes**, not days.

The presign Route Handler must still run the full mutation checklist: authenticate, authorize,
validate the requested content-type against an allowlist, and generate the object key server-side
(never accept a client-supplied key — that's a path-traversal / overwrite vector).

---

## Server/client boundary enforcement

Four mechanisms, from strongest to weakest. Use all four.

**1. `import 'server-only'` at the top of every server module.** Causes a **build error** if the
module is ever reached from a client graph. Apply to: `src/server/db/client.ts`, every file in
`src/server/data/`, `src/server/auth/`, and any module that touches `@aws-sdk/*` or reads a secret
env var. Next handles the import internally — the npm package's contents are unused — but install
it anyway so lint rules about extraneous dependencies stay quiet.

**2. Environment-variable discipline.** Only `NEXT_PUBLIC_`-prefixed vars reach the client; that
part is automatic. The discipline we add: *only the DAL reads `process.env`*, per Next's own
guidance. `serverRuntimeConfig` / `publicRuntimeConfig` were **removed in 16** — env vars are the
only mechanism. If a value must be read at runtime rather than inlined at build time, call
`await connection()` from `next/server` before reading `process.env`.

**3. `serverExternalPackages` for native/Node-only dependencies.** Note the config was renamed in
v15.0.0 from `experimental.serverComponentsExternalPackages` to the top-level
`serverExternalPackages` — many blog posts and StackOverflow answers still use the old name.
**Good news: we probably need zero config here.** Next 16 ships a built-in auto-external list that
already contains `@node-rs/argon2`, `argon2`, `pg`, `@aws-sdk/client-s3`, and
`@aws-sdk/s3-presigned-post`. Add entries only if a build error says otherwise.

**4. DTO discipline as the last line.** Even a correctly-bundled server module can leak by *passing*
data across the boundary. Return narrow objects from the DAL; never hand a raw row to a
`'use client'` component. Optionally enable React's taint APIs
(`experimental.taint: true` + `experimental_taintObjectReference` /
`experimental_taintUniqueValue`), but the docs are clear this is *"an additional layer of
protection"* on top of filtering, not a replacement.

### How to verify it actually holds

- **`npm run build` is the primary gate.** `server-only` violations fail the build, and Next 16
  removed `size` / `First Load JS` from the build output (they were "inaccurate in server-driven
  architectures"), so the build log is now a correctness signal rather than a size signal.
- **Grep the client chunks.** After a build, search `.next/static/chunks/**` for a sentinel string
  from a server module and for fragments of secret env var *names*. This is the only check that
  catches a leak the type system can't see.
- **Audit checklist from the Next docs**, run before each release: are database packages and
  `process.env` imported outside the DAL? Do `'use client'` component props expect private data or
  have overly broad type signatures? Are `"use server"` args validated and the caller re-authorized?
  Are `[param]` folders validating their input? `proxy.ts` and `route.ts` *"have a lot of power —
  spend extra time auditing these."*
- **Bundle-size guard in CI.** Because the build output no longer reports First Load JS, add an
  explicit size assertion on the client chunks so a stray `import { db }` in a client file shows up
  as a 400 KB regression rather than passing silently. `[unverified]` — no vendor-recommended tool
  for this under Turbopack; Lighthouse/Vercel Analytics are what the docs point to instead.

---

## Open questions

Blocked on the **`essentia_infra`** session:

**Neon / schema ownership**
1. Do we get a **dedicated Postgres schema** (Layer 3a) or must we live in `public` with a
   table-name prefix (Layer 3b)? This decides `schemaFilter` vs `tablesFilter` and whether the
   Drizzle schema files use `pgSchema()` or `pgTableCreator()`.
2. What is the agreed **namespace token**? The document assumes `icaros_*` / `icaros`; the actual
   prefix must be agreed with ESSENTIA so the two never collide.
3. Does ESSENTIA's repo already use `__drizzle_migrations` in the `drizzle` schema? If so, confirm
   our override (`__drizzle_migrations_icaros`) does not collide — and confirm ESSENTIA is *also*
   overriding, so neither repo's `migrate` can read the other's ledger.
4. Is ESSENTIA using Drizzle at all, or a different migration tool? If a different tool, does it
   introspect (and would it try to drop *our* tables)? This risk runs in both directions.

**Roles & credentials**
5. Can we get a **least-privilege Postgres role** scoped to our namespace (Layer 4)? Explicitly:
   no `DROP` on objects we don't own.
6. Two connection strings confirmed — the **pooled** (`-pooler`) URL for the app and the **direct**
   URL for `drizzle-kit migrate`. What are the agreed env var names, and is the direct URL
   available to CI only (not to the runtime function)?
7. Which Neon compute size / `max_connections`? Needed to size `Pool({ max })` sensibly against
   Fluid's in-function concurrency.
8. Are Neon **branches** available for preview deployments? If preview deploys point at the shared
   production database, a bad preview build could mutate live data — that would change the
   migration gating recommendation.

**S3**
9. Bucket name, region, and whether it is public-read or fronted by CloudFront. Affects
   `images.remotePatterns` in `next.config.ts` (note `images.domains` is deprecated in 16).
10. Key-prefix convention for our objects, and whether the bucket is shared with ESSENTIA. If
    shared, the presigned POST policy needs a `starts-with` condition on our prefix, and the IAM
    policy should scope to it too.
11. Which IAM principal issues presigned URLs, and is it a long-lived access key in Vercel env vars
    or an OIDC-federated role? `[unverified]` — Vercel's OIDC federation support for AWS was not
    researched.
12. CORS configuration on the bucket — presigned POST from the browser needs `POST` allowed with
    the right `AllowedHeaders`.

**Non-infra, needs a decision from us**
13. **React version pin policy.** Given R3F's `<19.3` ceiling, do we pin `react` exactly and accept
    lagging behind React minors, or drop R3F for a poster-only rocket page until R3F supports 19.3?
14. **Drizzle v1.** Ship on `0.45.2` now (recommended) and schedule the v1 upgrade, or wait for v1
    stable before starting? `[unverified]` — no published v1 stable date.
15. **Cache Components.** Confirmed as a post-migration follow-up, not part of the initial cutover?
16. Where do the **rocket GLB assets** live — the S3 bucket, or committed to the repo and served
    from Vercel's CDN? Affects whether the loader path needs CORS and signed access.
