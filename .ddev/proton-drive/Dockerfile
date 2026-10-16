# Proton Drive CLI with a control API, so the setup wizard can sign an account in
# and the dashboard can browse, upload and download without the CLI's terminal.
# Installs Proton's official binary, verified against a pinned SHA-512.
FROM debian:bookworm-slim

ARG PROTON_DRIVE_VERSION=0.9.0
ARG TARGETARCH
# Proton Drive CLI 0.9.0 (cli-drive@0.9.0+75612299), published per architecture
ARG PROTON_DRIVE_SHA512_X64=3533025ba69ae112b64e3e01fbcc1ad0688136a4043f6cf6a72886967d85fdcd9ec235479c2e113171614be5225bfba93427509a05ca5aa6071d924fa7e91ca8
ARG PROTON_DRIVE_SHA512_ARM64=c8d5a6b174e57f06d05cb5483400b9963faf58e743b6b33706bb73ecff718047ffce6b439994255b94b5b226b90d2e91bef7418ec96c1c3f5d8bf39b6cd01321

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg pass python3 \
  && case "${TARGETARCH:-amd64}" in \
    amd64) url="https://proton.me/download/drive/cli/${PROTON_DRIVE_VERSION}/linux-x64/proton-drive"; sha="${PROTON_DRIVE_SHA512_X64}" ;; \
    arm64) url="https://proton.me/download/drive/cli/${PROTON_DRIVE_VERSION}/linux-arm64/proton-drive"; sha="${PROTON_DRIVE_SHA512_ARM64}" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /usr/local/bin/proton-drive "$url" \
  && echo "${sha}  /usr/local/bin/proton-drive" | sha512sum -c - \
  && chmod 755 /usr/local/bin/proton-drive \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get purge -y curl \
  && apt-get autoremove -y

RUN useradd --create-home --uid 1000 drive

COPY --chmod=755 entrypoint.sh /usr/local/bin/drive-entrypoint
COPY control.py /opt/drive-control/control.py

USER drive
WORKDIR /home/drive

# 8080: control API (the setup wizard and the dashboard)
EXPOSE 8080

ENTRYPOINT ["drive-entrypoint"]
