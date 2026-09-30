#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: ./dev.sh

Builds the public web from local PostgreSQL and serves it with the writable
local CMS API. Successful publish rebuilds the static site. Published media
is downloaded using the essentia AWS profile. No production DB write occurs.

Public web: http://127.0.0.1:5174/
CMS:        http://127.0.0.1:5175/admin/
Press Ctrl+C to stop all servers.
HELP
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Unknown argument. Run ./dev.sh --help" >&2
  exit 2
fi

if [[ ! -d node_modules ]]; then
  echo "Dependencies are missing. Run npm ci first." >&2
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

echo "Building the public site from the local icaros database..."
npm run build:web:local
node scripts/promote-web-local.mjs
node scripts/bootstrap-local-admin.mjs

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
if [[ "${ICAROS_API_RUNTIME:-real}" == "real" ]]; then
  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_ROLE_ARN AWS_WEB_IDENTITY_TOKEN_FILE
  export API_LOCAL=1 API_PORT=5176
  export ICAROS_LOCAL_DATABASE_URL=postgres://icaros:icaros_local_dev@127.0.0.1:5435/icaros
  export ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:5175
  export WEB_SOURCE_REVISION=local
  export BUILD_WORKER_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  node --import tsx services/api/src/local-server.ts &
else
  node --import tsx scripts/dev-demo-api.mjs &
fi
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
