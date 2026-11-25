# lumo-tamer: unofficial, OpenAI-compatible proxy for Proton's Lumo, plus a control
# API so the setup wizard can sign the Proton account in (tamer has no HTTP login).
# Unreleased third-party software, pinned by commit; GPL-3.0.
# https://github.com/ZeroTricks/lumo-tamer
ARG TAMER_REF=8818a2bbfd939a015ea16d6098a50affa6130fc2

# Upstream source at that commit, without a history the build does not need
FROM node:22-alpine AS source

ARG TAMER_REF

RUN apk add --no-cache git \
  && git init --quiet /src \
  && cd /src \
  && git remote add origin https://github.com/ZeroTricks/lumo-tamer.git \
  && git fetch --quiet --depth 1 origin "${TAMER_REF}" \
  && git checkout --quiet FETCH_HEAD \
  && rm -rf /src/.git

# Static Go binaries that perform the Proton SRP login (`tamer auth login`)
FROM golang:1.26-alpine AS go-builder

COPY --from=source /src/src/auth/login/go /build
WORKDIR /build
RUN CGO_ENABLED=0 go build -o proton-auth

COPY --from=source /src/src/auth/login-captcha/go /build-captcha
WORKDIR /build-captcha
# The CAPTCHA binary pins its package through the `tool` directive in go.mod
RUN CGO_ENABLED=0 sh -c 'go build -o proton-auth-captcha $(go list tool)'

FROM node:22-alpine AS builder

RUN apk add --no-cache python3 py3-setuptools make g++ libc6-compat \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

WORKDIR /app
COPY --from=source /src ./
RUN npm ci \
  && npm run build \
  && npm prune --production

FROM node:22-alpine

# python3: the control API, tini: reaps orphans while it runs as PID 1
RUN apk add --no-cache python3 tini

WORKDIR /app

COPY --from=source /src/package.json /src/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=source /src/config.defaults.yaml ./

COPY --from=go-builder /build/proton-auth ./dist/proton-auth
COPY --from=go-builder /build-captcha/proton-auth-captcha ./dist/proton-auth-captcha

# The `tamer` command the control API drives
RUN npm link

COPY --chmod=755 entrypoint.sh /usr/local/bin/tamer-entrypoint
COPY control.py /opt/tamer-control/control.py

# 3003: OpenAI-compatible API (the dashboard), 3004: control API (the setup wizard)
EXPOSE 3003 3004

ENTRYPOINT ["/sbin/tini", "--", "tamer-entrypoint"]
