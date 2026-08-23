# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

Site for **ICAROS**, a student aerospace/rocketry team. React (Vite) SPA with a **Supabase-backed CMS**: posts, rockets, members, and the landing-page copy are all editable from an admin console. Deployed at `icaros.kr` (a separate simulator lives at `sim.icaros.kr` and is only linked to). UI copy is Korean.

## Commands

```bash
npm run dev      # Vite dev server on http://0.0.0.0:5174
npm run build    # production build to dist/
npm run preview  # serve the built dist/
npm run lint     # eslint .  (see gotcha)
```

No test framework. `npm run lint` runs `eslint .` but **no `eslint.config.js` exists** — under ESLint 9 it fails until a flat config is added. Use `npm run build` to catch syntax/import errors.

## Stack & conventions

- **Plain JavaScript + JSX, not TypeScript.** All frontend source is `.jsx`/`.js`. Don't introduce TS into the frontend without asking.
- React 19, `react-router-dom` v6, Vite 7. No state library, no UI kit.
- **Per-component plain CSS** — each page/component imports its own CSS file (e.g. `posts.jsx` → `posts.css`). Class names loosely follow BEM.

## Architecture

**Routing.** `main.jsx` mounts `<BrowserRouter>`; `App.jsx` lazy-loads every page. `<Header>`/`<Footer>`/`<ScrollToTop>` render outside `<Routes>`. Client-side routing means both `vercel.json` (rewrites) and `public/_redirects` (Netlify) rewrite all paths to the SPA entry — keep both in sync.

**Everything is Supabase + RLS.** There is one trust model across all content:

- **Auth is Supabase email/password.** `/admin` calls `supabase.auth.signInWithPassword({ email, password })`. The app has login only — new users are created from the Supabase Dashboard (public signup disabled). There is no `VITE_ADMIN_PW` anymore.
- **Authorization is the `admins` table + `public.is_admin()`.** A row in `public.admins` (keyed by `auth.users.id`) marks an admin. `is_admin()` is a `security definer` SQL function; every table's write policy calls it. The admin UI also calls `supabase.rpc('is_admin')` just to toggle the console — but the real gate is RLS on each table.
- **The browser anon client (`src/lib/supabase.js`) does everything** — public reads and (when the session is an admin) writes. RLS decides what's allowed. There is **no Edge Function in the write path** and no `service_role` key in the app. (`supabase/functions/admin-posts/` is dead code left from the old design; safe to delete.)

**Data model** (all tables: public `SELECT`, `is_admin()` write; see `supabase/migrations/`):
- `posts` — blog. `content_md` (Markdown) plus denormalized `cover_url`/`summary` for light list rendering. Lists select only the light columns + `range()` pagination; the modal fetches `content_md` on demand.
- `rockets` — id (slug), name, img, `series` ('A' = ICX 1/2, 'B' = ICX MV), spec numbers, `engines` (jsonb array), `sort_order`.
- `members` — name, role, school, image, `sort_order`.
- `site_content` — `key`/`value` string pairs for landing copy + donation numbers (e.g. `about.body`, `donation.goal`). Slogans use `**word**` for highlight; bodies use `\n` newlines.

**Admin console** (`src/admin.jsx`) is an auth gate + tab container. Each tab is a panel in `src/admin/`: `PostsPanel`, `RocketsPanel`, `MembersPanel`, `LandingPanel`. All writes go through the anon client; RLS enforces admin-only.

**Public pages read from the DB.** `posts.jsx`, `rocket.jsx`, `member.jsx` fetch their tables directly. `home.jsx` loads `site_content` but ships the current copy as `DEFAULTS` and overlays DB values on top, so it renders instantly and never flashes empty. The old `src/assets/rocket_info.json` / `member.json` are no longer imported (kept only as seed reference).

**Shared libs** (`src/lib/`): `markdown.js` (cover/summary extraction, storage-path extraction for cleanup), `storage.js` (`uploadImage`/`removeImageByUrl` on the shared `post-img` bucket, folders `posts/`/`rockets/`/`members/`), `content.js` (`fetchSiteContent`/`saveSiteContent`). `src/component/Highlight.jsx` renders `**word**` slogans.

**Storage cleanup.** Deleting a post/rocket/member removes its Storage image(s) first (`removeImageByUrl`, or `extractStoragePaths` for post bodies) to avoid orphans.

## Supabase setup (required for the app to work)

Migrations in `supabase/migrations/` are **not auto-applied** (no CLI link, no `service_role` locally). Apply `0001_*` then `0002_*` via the Dashboard SQL Editor or `supabase db push`. Then:
1. In Dashboard → Authentication, disable "Allow new users to sign up"; create the admin under Users → Add user (email + password).
2. `insert into public.admins (user_id, email) select id, email from auth.users where email = '...';`
3. Ensure the `post-img` Storage bucket exists and is public.

## Environment variables

Client (`.env.local`, `VITE_`-prefixed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `VITE_ADMIN_PW` is obsolete. `.env.local` is **not** in `.gitignore` — verify it isn't committed.

## Gotchas

- Panels use `window.confirm` for deletes — avoid triggering during browser automation (blocking dialog).
- `build` config (`vite.config.js`) splits `react`/`react-dom`/`react-router-dom` into a `react-vendor` chunk.
- Adding a new editable landing field means adding the key in **three** places: migration seed, `home.jsx` `DEFAULTS`, and `LandingPanel.jsx` `SECTIONS`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
