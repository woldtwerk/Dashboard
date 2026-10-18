#!/bin/sh
# Entrypoint for the local Laya decision server.
#
# laya-serve (0.4.11) only enforces `Authorization: Bearer` when LAYA_API_KEY is
# set, so an empty key would leave the whole decision API open to anything on the
# ddev network. It is bind-mounted only inside the project network, but "no auth at
# all" is still the wrong default, so refuse to start instead.
set -eu

if [ -z "${LAYA_API_KEY:-}" ]; then
  echo "laya: LAYA_API_KEY is empty; refusing to start an unauthenticated laya-serve." >&2
  echo "laya: .ddev/scripts/ensure-secrets.sh writes it to .ddev/.env.laya on 'ddev start'." >&2
  exit 1
fi

exec laya-serve
