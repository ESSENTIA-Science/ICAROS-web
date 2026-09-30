# Legacy Next.js application

This directory preserves the ICAROS web application at baseline commit `91cbf0d`, including the uncommitted source changes present when the split began. It is excluded from the new workspace build.

From this directory, run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build`. The original root `.env.local` and other local secrets were deliberately left outside this directory. Provide local environment values separately when running the legacy app; do not copy secrets into Git.

The application routes, DB migrations, scripts, and static assets remain here for comparison and rollback planning. Production still runs the existing `main` deployment until a separately approved cutover.
