# carbonate: CalDAV + CardDAV bridge for Proton Calendar and Contacts.
#
# Unreleased third-party software, pinned by commit: it talks to Proton's
# private API, which can change without warning. MIT licensed.
# https://github.com/develonrails/carbonate
FROM golang:1.26-bookworm AS build

ARG CARBONATE_COMMIT=baa9818402e980208ac0041ea6544f3d4683d29d

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --quiet https://github.com/develonrails/carbonate.git . \
  && git checkout --quiet "${CARBONATE_COMMIT}"

# Static binary, so the runtime image needs no libc beyond what slim ships
RUN CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X main.version=${CARBONATE_COMMIT}" \
  -o /out/carbonate ./cmd/carbonate

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 carbonate

COPY --from=build /out/carbonate /usr/local/bin/carbonate
COPY entrypoint.sh /usr/local/bin/carbonate-entrypoint
COPY control.py /opt/carbonate-control/control.py
RUN chmod 755 /usr/local/bin/carbonate-entrypoint

USER carbonate
WORKDIR /home/carbonate

# 8080: control API (the setup wizard), 8081: CalDAV/CardDAV (the dashboard)
EXPOSE 8080 8081

ENTRYPOINT ["carbonate-entrypoint"]
