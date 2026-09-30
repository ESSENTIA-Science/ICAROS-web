#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
npm run typecheck
npm run lint
npm run test
npm run build:web:local
node scripts/promote-web-local.mjs
test -s apps/web/out/index.html
test -s apps/web/out/posts/index.html
echo "Local predeploy checks passed; output is in apps/web/out. No deployment was performed."
