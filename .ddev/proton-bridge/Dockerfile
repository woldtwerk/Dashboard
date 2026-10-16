# Proton Mail Bridge (CLI) with a control API, so the setup wizard can sign accounts in.
# Installs Proton's official .deb, verified against its signature and a pinned checksum.
FROM debian:bookworm-slim

ARG BRIDGE_VERSION=3.27.1
ARG BRIDGE_SHA256=d69eab5674335a41428bf77bde6a9f85667867e2083205625a710f6948e54d86
# Proton Technologies AG (ProtonMail Bridge developers) <bridge@protonmail.ch>
ARG BRIDGE_KEY_FINGERPRINT=D51E64D3E63EDC3EEF7864CEE2C75D68E6234B07

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg binutils pass socat python3 \
  && cd /tmp \
  && curl -fsSLO "https://proton.me/download/bridge/protonmail-bridge_${BRIDGE_VERSION}-1_amd64.deb" \
  && echo "${BRIDGE_SHA256}  protonmail-bridge_${BRIDGE_VERSION}-1_amd64.deb" | sha256sum -c - \
  && curl -fsSL -o bridge_pubkey.gpg https://proton.me/download/bridge/bridge_pubkey.gpg \
  && export GNUPGHOME="$(mktemp -d)" \
  && gpg --batch --import bridge_pubkey.gpg \
  && ar x "protonmail-bridge_${BRIDGE_VERSION}-1_amd64.deb" \
  && cat debian-binary control.tar.gz data.tar.gz > signed \
  && gpg --batch --status-fd 1 --verify _gpgorigin signed | grep -q "VALIDSIG ${BRIDGE_KEY_FINGERPRINT}" \
  && apt-get install -y --no-install-recommends "./protonmail-bridge_${BRIDGE_VERSION}-1_amd64.deb" \
  && rm -rf /tmp/* "$GNUPGHOME" /var/lib/apt/lists/* \
  && apt-get purge -y curl binutils \
  && apt-get autoremove -y

RUN useradd --create-home --uid 1000 bridge

COPY --chmod=755 entrypoint.sh /usr/local/bin/bridge-entrypoint
COPY control.py /opt/bridge-control/control.py

USER bridge
WORKDIR /home/bridge

# 1144: IMAP (forwarded to Bridge on 127.0.0.1:1143), 8080: control API
EXPOSE 1144 8080

ENTRYPOINT ["bridge-entrypoint"]
