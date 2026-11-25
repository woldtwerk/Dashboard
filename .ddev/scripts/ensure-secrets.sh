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
IMGPOPROXY="$DDEV_DIR/.env.imgproxy"
CLIENT_ACCESS="$DDEV_DIR/.env.client-access"
LAYA="$DDEV_DIR/.env.laya"
TAMER="$DDEV_DIR/.env.tamer"
TAMER_CONFIG="$DDEV_DIR/tamer/config.yaml"
TAMER_KEY="$DDEV_DIR/tamer/secrets/lumo-vault-key"

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

# Web Push VAPID key pair. The public key goes to the browser, the private one signs the
# messages; they belong together, so they are only created while both are missing.
# Both are base64url without padding, as the Push API expects.
vapid() {
  local public private
  public="$(get "$WEB" NUXT_VAPID_PUBLIC_KEY)"
  private="$(get "$WEB" NUXT_VAPID_PRIVATE_KEY)"

  if [[ -n "$public" && -n "$private" ]]; then
    return
  fi
  if [[ -n "$public" || -n "$private" ]]; then
    echo "ensure-secrets: WARNING NUXT_VAPID_PUBLIC_KEY and NUXT_VAPID_PRIVATE_KEY must be created together; left unchanged" >&2
    return
  fi

  local key
  key="$(mktemp)"
  trap 'rm -f "$key"' RETURN

  openssl ecparam -name prime256v1 -genkey -noout -out "$key"
  # The private key is the 32-byte scalar behind the DER header; the public key is the
  # 65-byte uncompressed point at the end of the SubjectPublicKeyInfo
  private="$(openssl ec -in "$key" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  public="$(openssl ec -in "$key" -pubout -outform DER 2>/dev/null | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=')"

  rm -f "$key"
  trap - RETURN

  set_value "$WEB" NUXT_VAPID_PRIVATE_KEY "$private"
  set_value "$WEB" NUXT_VAPID_PUBLIC_KEY "$public"
}

# lumo-tamer's vault key. tamer accepts either 32 raw bytes or their base64, and
# NEVER regenerates a key it already has: a new key makes the existing vault
# unreadable, so an existing file is left alone. It is a file of its own rather
# than a value in .env.tamer because Docker Compose mounts it as the
# `lumo-vault-key` secret.
tamer_vault_key() {
  [[ -s "$TAMER_KEY" ]] && return
  mkdir -p "$(dirname "$TAMER_KEY")"
  if command -v openssl >/dev/null 2>&1; then
    (umask 077 && openssl rand 32 > "$TAMER_KEY")
  else
    (umask 077 && head -c 32 /dev/urandom > "$TAMER_KEY")
  fi
  chmod 600 "$TAMER_KEY"
  echo "ensure-secrets: created TAMER_VAULT_KEY in .ddev/tamer/secrets/lumo-vault-key"
}

# The config tamer reads at startup: the entrypoint copies it from /etc/tamer to
# /app, where tamer rewrites it after a sign-in. It must exist before the
# container starts, otherwise Docker mounts a directory at its path. Written
# once, because it holds the proxy key that .env.tamer keeps.
tamer_config() {
  [[ -f "$TAMER_CONFIG" ]] && return
  local key
  key="$(get "$TAMER" TAMER_API_KEY)"
  mkdir -p "$(dirname "$TAMER_CONFIG")"
  (umask 077 && cat > "$TAMER_CONFIG" <<EOF
# Generated by .ddev/scripts/ensure-secrets.sh; gitignored.
auth:
  vault:
    keyFilePath: /run/secrets/lumo-vault-key
server:
  apiKey: ${key}
  port: 3003
  # The 360 kB default is too small for assistant history plus mail tool results
  bodyLimit: "2mb"
  # Custom tool detection is on by design: the mail tools arrive as JSON
  customTools:
    enabled: true
  # Only one request runs at a time, so thinking would just delay the queue
  reasoning:
    default: "none"
  allowedModels: [lumo, lumo-lite, lumo-max]
conversations:
  useFallbackStore: true
EOF
  )
  chmod 600 "$TAMER_CONFIG"
  echo "ensure-secrets: created config.yaml in .ddev/tamer"
}

ensure "$WEB" NUXT_APP_SECRET
# nuxt-auth-utils seals the session cookie with this; it requires at least 32 characters
ensure "$WEB" NUXT_SESSION_PASSWORD
vapid
ensure_default "$WEB" NUXT_VAPID_SUBJECT "mailto:admin@allmight.localhost"
ensure_pair "$MEILI" MEILI_MASTER_KEY "$WEB" NUXT_MEILISEARCH_API_KEY
ensure_pair "$BRIDGE" BRIDGE_CONTROL_TOKEN "$WEB" NUXT_PROTON_BRIDGE_TOKEN
ensure_pair "$CARBONATE" CARBONATE_CONTROL_TOKEN "$WEB" NUXT_CARBONATE_TOKEN
ensure_pair "$DRIVE" PROTON_DRIVE_CONTROL_TOKEN "$WEB" NUXT_PROTON_DRIVE_TOKEN

# imgproxy signing pair (hex, see the imgproxy service) and the HMAC secret of
# the source endpoint (only ever read by the app)
ensure_pair "$IMGPOPROXY" IMGPROXY_KEY "$WEB" NUXT_IMGPROXY_KEY
ensure_pair "$IMGPOPROXY" IMGPROXY_SALT "$WEB" NUXT_IMGPROXY_SALT
ensure "$WEB" NUXT_IMAGE_SOURCE_SECRET

# Shared secret between the client-access proxy and the app's internal auth
# endpoints (/_client-access/...). The proxy presents it in
# X-Client-Access-Secret; a mismatch makes the endpoints answer 404.
ensure_pair "$CLIENT_ACCESS" CLIENT_ACCESS_SECRET "$WEB" NUXT_CLIENT_ACCESS_SECRET

# Laya decision server bearer; the app presents it as NUXT_LAYA_API_KEY and the
# container requires it as LAYA_API_KEY.
ensure_pair "$LAYA" LAYA_API_KEY "$WEB" NUXT_LAYA_API_KEY

# lumo-tamer: the control API token is shared with the app (NUXT_LUMO_TAMER_TOKEN),
# TAMER_API_KEY is the proxy's own bearer key; the vault key is write-once and
# must never change, and config.yaml carries the proxy key.
ensure_pair "$TAMER" TAMER_CONTROL_TOKEN "$WEB" NUXT_LUMO_TAMER_TOKEN
ensure "$TAMER" TAMER_API_KEY
tamer_vault_key
tamer_config

# Paperless-ngx admin, secret key and initial superuser (injected into the paperless service)
ensure_default "$PAPERLESS" PAPERLESS_ADMIN_USER admin
ensure "$PAPERLESS" PAPERLESS_ADMIN_PASSWORD
ensure "$PAPERLESS" PAPERLESS_SECRET_KEY
