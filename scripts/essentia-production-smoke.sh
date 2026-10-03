#!/usr/bin/env bash
set +x
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--help" && $# -eq 1 ]]; then
  cat <<'HELP'
Usage: bash scripts/essentia-production-smoke.sh [--help]
Loads ignored, owner-only docs/.local/essentia-production.env.
Uses the actual ICAROS-api adapter listDrafts/readSnapshot with GET only.
No servers, AWS commands, database access, or writes. Prints counts only.
ICAROS_API_DIR overrides the sibling ICAROS-api checkout.
HELP
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Unknown argument. Use --help." >&2
  exit 2
fi
source "$ROOT_DIR/scripts/essentia-production-config.sh"
load_essentia_production_config
export ICAROS_API_DIR="${ICAROS_API_DIR:-$(dirname "$ROOT_DIR")/ICAROS-api}"
exec node "$ROOT_DIR/scripts/essentia-production-smoke.mjs"
