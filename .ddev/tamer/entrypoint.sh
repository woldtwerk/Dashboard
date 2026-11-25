#!/bin/sh
set -eu

: "${TAMER_CONTROL_TOKEN:?TAMER_CONTROL_TOKEN is not set (.ddev/.env.tamer)}"
: "${TAMER_API_KEY:?TAMER_API_KEY is not set (.ddev/.env.tamer)}"

# The host file is read-only; tamer rewrites /app/config.yaml after a sign-in
cp /etc/tamer/config.yaml /app/config.yaml

exec python3 /opt/tamer-control/control.py
