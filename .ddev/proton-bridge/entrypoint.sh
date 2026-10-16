#!/bin/sh
set -eu

: "${BRIDGE_CONTROL_TOKEN:?BRIDGE_CONTROL_TOKEN is not set (.ddev/.env.proton-bridge)}"

# Bridge keeps its vault key in a keychain; in a container that is `pass` with a GPG key.
# The key has no passphrase, so the volume holding /home/bridge is what protects the accounts.
if ! gpg --list-secret-keys bridge-vault >/dev/null 2>&1; then
  gpg --batch --passphrase '' --quick-generate-key bridge-vault default default never
  pass init bridge-vault
fi

# Bridge only listens on 127.0.0.1; socat makes IMAP reachable for the web container
socat TCP-LISTEN:1144,fork,reuseaddr TCP:127.0.0.1:1143 &

exec python3 /opt/bridge-control/control.py
