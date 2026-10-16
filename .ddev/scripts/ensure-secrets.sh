#!/usr/bin/env bash
# Creates missing secrets in the gitignored .ddev/.env.* files; runs as pre-start hook.
#
# - Never overwrites an existing value: NUXT_APP_SECRET encrypts the stored services,
#   so a new one would make them unreadable.
# - Keys that must match on both sides (app <-> container) are completed from the side
#   that has a value; a mismatch is reported, not fixed.
# - Prints key names only, never values.
set -euo pipefail

DDEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$DDEV_DIR/.env.web"
MEILI="$DDEV_DIR/.env.meilisearch"
BRIDGE="$DDEV_DIR/.env.proton-bridge"
CARBONATE="$DDEV_DIR/.env.carbonate"
DRIVE="$DDEV_DIR/.env.proton-drive"
PAPERLESS="$DDEV_DIR/.env.paperless"

random() {
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Value of KEY in FILE, without quotes; empty when missing
get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | sed -E "s/^${key}=//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/" || true
}

# Sets KEY in FILE (replacing an empty entry), in the format `ddev dotenv set` writes
set_value() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  chmod 600 "$file"
  if grep -qE "^${key}=" "$file"; then
    local rest
    rest="$(grep -vE "^${key}=" "$file" || true)"
    printf '%s\n' "$rest" | sed '/^$/d' > "$file"
  fi
  printf '%s="%s"\n' "$key" "$value" >> "$file"
  echo "ensure-secrets: created ${key} in .ddev/$(basename "$file")"
}

ensure() {
  local file="$1" key="$2"
  [[ -n "$(get "$file" "$key")" ]] || set_value "$file" "$key" "$(random)"
}

# Like ensure(), but with a fixed, non-secret default
ensure_default() {
  local file="$1" key="$2" value="$3"
  [[ -n "$(get "$file" "$key")" ]] || set_value "$file" "$key" "$value"
}

# Both sides of a shared secret get the same value
ensure_pair() {
  local file_a="$1" key_a="$2" file_b="$3" key_b="$4"
  local a b
  a="$(get "$file_a" "$key_a")"
  b="$(get "$file_b" "$key_b")"

  if [[ -z "$a" && -z "$b" ]]; then
    a="$(random)"
    set_value "$file_a" "$key_a" "$a"
    set_value "$file_b" "$key_b" "$a"
  elif [[ -z "$a" ]]; then
    set_value "$file_a" "$key_a" "$b"
  elif [[ -z "$b" ]]; then
    set_value "$file_b" "$key_b" "$a"
  elif [[ "$a" != "$b" ]]; then
    echo "ensure-secrets: WARNING ${key_a} (.ddev/$(basename "$file_a")) and ${key_b} (.ddev/$(basename "$file_b")) differ; left unchanged" >&2
  fi
}

ensure "$WEB" NUXT_APP_SECRET
ensure_pair "$MEILI" MEILI_MASTER_KEY "$WEB" NUXT_MEILISEARCH_API_KEY
ensure_pair "$BRIDGE" BRIDGE_CONTROL_TOKEN "$WEB" NUXT_PROTON_BRIDGE_TOKEN
ensure_pair "$CARBONATE" CARBONATE_CONTROL_TOKEN "$WEB" NUXT_CARBONATE_TOKEN
ensure_pair "$DRIVE" PROTON_DRIVE_CONTROL_TOKEN "$WEB" NUXT_PROTON_DRIVE_TOKEN

# Paperless-ngx admin, secret key and initial superuser (injected into the paperless service)
ensure_default "$PAPERLESS" PAPERLESS_ADMIN_USER admin
ensure "$PAPERLESS" PAPERLESS_ADMIN_PASSWORD
ensure "$PAPERLESS" PAPERLESS_SECRET_KEY
