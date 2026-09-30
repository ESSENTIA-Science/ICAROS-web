# ICAROS public web

Next.js 16 static export. Public pages are generated only from a pinned publication snapshot. This app does not read the production database.

## Local and CI

From the repository root, run `npm run build:web:fixture`. The fixture at `apps/web/fixtures/public.synthetic.json` contains synthetic, public-safe content and is never a replacement for a production publication snapshot.

For a real publication build:

```bash
cd apps/web
ICAROS_SNAPSHOT=/absolute/path/to/published.json \
ICAROS_SNAPSHOT_SHA256=<64-character-sha256> \
npm run build
```

Both variables are required. A missing file, changed hash, incomplete snapshot, non-public media path, or unpublished record fails the build. `out/` contains the static result. The publisher must put versioned public media at the URLs referenced by the snapshot before publishing HTML.

## Snapshot contract

`src/lib/content/snapshot.ts` defines the local typed interface. The snapshot contains `version`, `publishedAt`, `site`, ordered `sections` and `panels`, vehicle `taxonomy`, published `vehicles`, published `members`, published `posts`, and a public media URL map. Vehicle slugs and post IDs determine exported routes. Every member portrait currently uses the generic placeholder until an explicit public portrait policy is available.

Routes: `/`, `/vehicles/`, `/vehicles/types/{type}/`, `/vehicles/types/{type}/{series}/`, `/vehicles/{slug}/`, `/member/`, `/posts/`, `/posts/page/{n}/`, `/posts/{id}/`, `/posts/legacy/{slug}/`, `/sitemap.xml`, and the framework's 404 page. Unknown detail paths are absent from the export; the CDN must return a real HTTP 404 for absent files. With `trailingSlash: true`, configure a request for `/posts/{id}/` to serve `/posts/{id}/index.html`.

The vehicle index retains the two tab rows and displays only the selected series. Every type and series has its own HTML, so tabs and card filtering work without JavaScript. Before serving old bookmarks, configure CDN redirects from `/vehicles?type=T&series=S` to `/vehicles/types/T/S/`, from `?type=T` to `/vehicles/types/T/`, and from `?series=S` to the owning type and series path using the published taxonomy map. Invalid IDs should redirect to `/vehicles/`. The default combination may redirect to `/vehicles/`. These redirects are outside this FE app.

Posts retain 12 cards per page. Pages after the first are generated as `/posts/page/{n}/` with their own HTML and sitemap entries. For snapshots with 12 or fewer posts, the build removes Next.js's required temporary page 2 from `out/`. Before serving old bookmarks, configure a CDN redirect from `/posts?page=N` (zero-based `N >= 1`) to `/posts/page/{N+1}/`; `page=0` maps to `/posts/`. Ignore unrelated query parameters. The current CSS and public components are copied from `legacy/`. Public media URLs must be CDN URLs or local `/assets/` paths; the legacy `/api/media/{id}` proxy is not available here.
