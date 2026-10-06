#!/usr/bin/env bash
set +x
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="${ICAROS_API_DIR:-$(cd "$ROOT_DIR/.." && pwd)/ICAROS-api}"
cd "$ROOT_DIR"
if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: ./dev.sh

Builds the public web from local PostgreSQL and serves it with the writable
local CMS API. Successful publish rebuilds the static site. Published media
is downloaded using the essentia AWS profile. ICAROS content uses local DB.

Public web: http://127.0.0.1:5174/
CMS:        http://127.0.0.1:5175/admin/
When local ESSENTIA (8081) and docs/.local/essentia-service-token are available,
posts connect automatically. Set ICAROS_LOCAL_ESSENTIA=0 to disable or =1 to require.
Set ICAROS_ESSENTIA_TARGET=production to load docs/.local/essentia-production.env.
WARNING: production mode sends CMS post saves/publishes to PRODUCTION ESSENTIA.
Check readiness first: bash scripts/essentia-production-smoke.sh
CMS login requires Cognito settings in docs/.local/cognito.env; see docs/cognito-local.md.
Press Ctrl+C to stop all servers.
HELP
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Unknown argument. Run ./dev.sh --help" >&2
  exit 2
fi

if [[ -f docs/.local/cognito.env ]]; then
  set -a
  source docs/.local/cognito.env
  set +a
fi
source "$ROOT_DIR/scripts/essentia-production-config.sh"
if [[ -z "${ICAROS_ESSENTIA_TARGET:-}" && -f docs/.local/essentia-target ]]; then
  ICAROS_ESSENTIA_TARGET="$(cat docs/.local/essentia-target)"
fi
essentia_target="${ICAROS_ESSENTIA_TARGET:-local}"
case "$essentia_target" in
  local) ;;
  production)
    load_essentia_production_config
    echo "ESSENTIA target: PRODUCTION. CMS post saves/publishes write to production."
    ;;
  *) echo "ICAROS_ESSENTIA_TARGET must be local or production." >&2; exit 2 ;;
esac

if [[ ! -d node_modules ]]; then
  echo "Dependencies are missing. Run npm ci first." >&2
  exit 1
fi
if [[ ! -f "$API_DIR/src/local-server.ts" || ! -d "$API_DIR/node_modules" ]]; then
  echo "ICAROS-api is required at $API_DIR with npm dependencies installed." >&2
  exit 1
fi

for port in 5174 5175 5176; do
  if PORT="$port" node -e 'const s=require("node:net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.env.PORT),"127.0.0.1",()=>s.close())'; then
    :
  else
    echo "Port $port is already in use. Stop that process and retry." >&2
    exit 1
  fi
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to serve the static export." >&2
  exit 1
fi

for service in db minio; do
  container="icaros-$service"
  if docker container inspect "$container" >/dev/null 2>&1; then
    docker start "$container" >/dev/null
  else
    docker compose -f legacy/compose.yaml up -d "$service" >/dev/null
  fi
done
if ! docker exec icaros-db pg_isready -U icaros -d icaros >/dev/null; then
  echo "Local PostgreSQL is not ready. Retry shortly." >&2
  exit 1
fi
export AWS_ACCESS_KEY_ID=icaros_local AWS_SECRET_ACCESS_KEY=icaros_local_dev
export AWS_REGION=us-east-1 S3_ENDPOINT=http://127.0.0.1:9010
export S3_BUCKET=icaros-local S3_PREFIX=icaros-web
export ICAROS_LOCAL_S3_BUCKET="$S3_BUCKET"
for attempt in {1..20}; do
  if aws --endpoint-url "$S3_ENDPOINT" s3api list-buckets >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 20 ]]; then echo "Local MinIO is not ready." >&2; exit 1; fi
  sleep 1
done
aws --endpoint-url "$S3_ENDPOINT" s3api head-bucket --bucket "$S3_BUCKET" >/dev/null 2>&1 ||
  aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$S3_BUCKET" >/dev/null

local_essentia_mode="${ICAROS_LOCAL_ESSENTIA:-auto}"
if [[ "$essentia_target" == "local" ]] && { [[ "$local_essentia_mode" == "1" ]] || {
  [[ "$local_essentia_mode" == "auto" && -f docs/.local/essentia-service-token ]] &&
    curl -fsS http://127.0.0.1:8081/api/ping >/dev/null 2>&1
}; }; then
  if [[ ! -f docs/.local/essentia-service-token ]] || ! curl -fsS http://127.0.0.1:8081/api/ping >/dev/null; then
    echo "Local ESSENTIA API and docs/.local/essentia-service-token are required." >&2
    exit 1
  fi
  export ESSENTIA_SERVICE_ORIGIN=http://127.0.0.1:8081
  export ESSENTIA_SERVICE_TOKEN="$(cat docs/.local/essentia-service-token)"
  export ESSENTIA_SERVICE_CATEGORY="$(docker exec essentia-postgres-1 psql -U essentia -d essentia -Atc "select title from public.projects where slug='icaros' limit 1" 2>/dev/null)"
  export ESSENTIA_AUTHOR_LABEL='ICAROS 팀'
  if [[ -z "$ESSENTIA_SERVICE_CATEGORY" ]]; then echo "Local ESSENTIA ICAROS project is missing." >&2; exit 1; fi
fi

echo "Building the public site from the local icaros database..."
npm run build:web:local
node scripts/promote-web-local.mjs

pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 -m http.server 5174 --bind 127.0.0.1 --directory docs/.local/web-current &
pids+=("$!")
unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_ROLE_ARN AWS_WEB_IDENTITY_TOKEN_FILE
export API_LOCAL=1 API_PORT=5176
export ICAROS_LOCAL_DATABASE_URL=postgres://icaros:icaros_local_dev@127.0.0.1:5435/icaros
cognito_admin_list="${COGNITO_LOCAL_ADMIN_EMAILS:-${COGNITO_LOCAL_ADMIN_EMAIL:-}}"
if [[ -n "$cognito_admin_list" ]]; then
  IFS=',' read -r -a cognito_admin_emails <<< "$cognito_admin_list"
  for cognito_admin_email in "${cognito_admin_emails[@]}"; do
    if [[ -n "$cognito_admin_email" ]]; then
      (cd "$API_DIR" && COGNITO_LOCAL_ADMIN_EMAIL="$cognito_admin_email" npm run provision:local-admin)
    fi
  done
fi
export ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:5175,http://localhost:5175
export WEB_SOURCE_REVISION=local
export BUILD_WORKER_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
(cd "$API_DIR" && ICAROS_WEB_ROOT="$ROOT_DIR" node --import tsx src/local-server.ts) &
pids+=("$!")
ICAROS_CMS_API_TARGET=http://127.0.0.1:5176 npm run dev -w @icaros/cms -- --host 127.0.0.1 --port 5175 --strictPort &
pids+=("$!")

echo
echo "Public web: http://127.0.0.1:5174/"
echo "CMS:        http://127.0.0.1:5175/admin/"
echo "Local DB content. Successful publish rebuilds the static site."

while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A demo server stopped unexpectedly." >&2
      exit 1
    fi
  done
  sleep 1
done
