#!/bin/sh
set -eu

: "${PROTON_DRIVE_CONTROL_TOKEN:?PROTON_DRIVE_CONTROL_TOKEN is not set (.ddev/.env.proton-drive)}"

# The CLI keeps its session in a keychain; in a container that is `pass` with a GPG
# key. The key has no passphrase, so the volume holding /home/drive protects the account.
if ! gpg --list-secret-keys drive-vault >/dev/null 2>&1; then
  gpg --batch --passphrase '' --quick-generate-key drive-vault default default never
  pass init drive-vault
fi

# Headless containers store the session in `pass`; never in a plain file on disk
export PROTON_DRIVE_CREDENTIALS_STORE="${PROTON_DRIVE_CREDENTIALS_STORE:-pass}"
# Everything the CLI caches (session, metadata) lives on the volume
export PROTON_DRIVE_CACHE_DIR="${PROTON_DRIVE_CACHE_DIR:-/home/drive/.cache/proton-drive}"

exec python3 /opt/drive-control/control.py
