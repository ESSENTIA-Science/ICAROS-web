#!/usr/bin/env bash
set +x
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  --help|--self-test)
    if [[ $# -ne 1 ]]; then echo 'FAIL: invalid arguments.' >&2; exit 2; fi
    exec node "$ROOT_DIR/scripts/essentia-production-write-smoke.mjs" "$1"
    ;;
  --apply-production-draft-test)
    if [[ $# -ne 1 ]]; then echo 'FAIL: invalid arguments.' >&2; exit 2; fi
    ;;
  *) echo 'FAIL: explicit --apply-production-draft-test required; use --help.' >&2; exit 2 ;;
esac
source "$ROOT_DIR/scripts/essentia-production-config.sh"
load_essentia_production_config
export ICAROS_API_DIR="${ICAROS_API_DIR:-$(dirname "$ROOT_DIR")/ICAROS-api}"
exec node "$ROOT_DIR/scripts/essentia-production-write-smoke.mjs" --apply-production-draft-test
