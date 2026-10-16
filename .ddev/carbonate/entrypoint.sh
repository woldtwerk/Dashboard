#!/bin/sh
set -eu

: "${CARBONATE_CONTROL_TOKEN:?CARBONATE_CONTROL_TOKEN is not set (.ddev/.env.carbonate)}"

# The control API runs the `carbonate auth` and `carbonate serve` processes and
# keeps the session on the volume; it is the container's only foreground process.
exec python3 /opt/carbonate-control/control.py
