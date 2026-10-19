# Laya decision server (laya-serve) for local AI decisions.
#
# Laya is Apache-2.0 licensed (https://github.com/NhandaKishorM/laya, "Apache 2.0.
# Developed by Convai Innovations."). The package and the model weights this image
# downloads are used here unmodified.
#
# The server speaks the TypeSafe Jev `/v1/systemone` wire protocol; the adapter in
# `layers/automation-laya` is written against that protocol. Weights are pulled from
# the Hugging Face Hub on first start into the `laya-models` volume, so the model
# never leaves the machine afterwards.
FROM python:3.12-slim

# CPU-only PyTorch wheel, pinned: the CUDA build is an order of magnitude larger and
# this container has no GPU. `torch==2.14.1` is inside laya 0.4.11's `torch>=2.0.0`
# range and is the version `laya[serve]` resolves to; pinning keeps a rebuild from
# pulling a newer torch that the pinned transformers/NumPy stack was not tested with.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
  && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu "laya[serve]==0.4.11"

# The `laya-models` volume is mounted at $HF_HOME, so that path must already exist in
# the image owned by laya: Docker creates a missing mountpoint as root and copies the
# image directory's ownership into an empty volume on first mount, which would leave
# the Hugging Face cache root-owned and make the server fail on start.
RUN useradd --create-home --uid 1000 laya \
  && mkdir -p /home/laya/.cache/huggingface \
  && chown -R laya:laya /home/laya/.cache

# Weights, tokenizers and the Hugging Face cache live on the volume; the first start
# downloads ~1.3 GB for the multilingual checkpoint.
ENV HF_HOME=/home/laya/.cache/huggingface

USER laya
WORKDIR /home/laya

# Verified against laya 0.4.11 `laya/serve.py`:
#   LAYA_HOST (not LAYA_BIND_ADDRESS), LAYA_PORT, LAYA_MODELS, LAYA_PRELOAD,
#   LAYA_MAX_CONCURRENT, LAYA_API_KEY, LAYA_DEVICE.
ENV LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=1 \
    LAYA_MODELS=multilingual \
    LAYA_MAX_CONCURRENT=4

EXPOSE 8000

# Liveness only; details require the bearer when LAYA_API_KEY is set. Python is
# already in the image, so no curl (and no apt) is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('LAYA_PORT','8000'), timeout=3)" || exit 1

# laya-serve only requires the bearer when LAYA_API_KEY is set, so without the key the
# server would run unauthenticated. The wrapper refuses to start instead.
COPY --chmod=755 entrypoint.sh /usr/local/bin/laya-entrypoint

ENTRYPOINT ["laya-entrypoint"]
