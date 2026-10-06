# Sourced by dev.sh and the read-only smoke launcher. ROOT_DIR must be set.
load_essentia_production_config() {
  # Disable shell tracing before touching credentials, including when invoked with bash -x.
  set +x
  local config="$ROOT_DIR/docs/.local/essentia-production.env"
  if ! node - "$config" <<'JS'
const fs = require('node:fs');
try {
  const stat = fs.lstatSync(process.argv[2]);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) process.exit(1);
} catch { process.exit(1); }
JS
  then
    echo "Production config missing or unsafe: create docs/.local/essentia-production.env owned by you with chmod 600." >&2
    return 1
  fi
  if ! git -C "$ROOT_DIR" check-ignore -q docs/.local/essentia-production.env; then
    echo "Production config must be git-ignored." >&2
    return 1
  fi
  # Trusted, owner-only shell assignments. Suppress parse errors that may contain secret values.
  if ! bash -n "$config" 2>/dev/null; then
    echo "Production config has invalid shell syntax." >&2
    return 1
  fi
  unset ESSENTIA_SERVICE_ORIGIN ESSENTIA_SERVICE_TOKEN ESSENTIA_SERVICE_CATEGORY ESSENTIA_AUTHOR_LABEL
  set -a
  if ! source "$config" >/dev/null 2>&1; then
    set +a
    echo "Could not load production config." >&2
    return 1
  fi
  set +a
  local name
  for name in ESSENTIA_SERVICE_ORIGIN ESSENTIA_SERVICE_TOKEN ESSENTIA_SERVICE_CATEGORY ESSENTIA_AUTHOR_LABEL; do
    if [[ -z "${!name:-}" || "${!name}" =~ ^[[:space:]]*$ ]]; then
      echo "Production config requires $name. No local fallback is permitted." >&2
      return 1
    fi
  done
  if [[ "$ESSENTIA_SERVICE_ORIGIN" != "https://api.essentia-sci.org" ]]; then
    echo "Production ESSENTIA_SERVICE_ORIGIN must be https://api.essentia-sci.org (no trailing slash)." >&2
    return 1
  fi
}
