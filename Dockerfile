# v4 — Studio / RTX 5090 (Blackwell): CUDA 12.8 + PyTorch cu128
# Official Node Pack: docs/COMFYUI_IMAGE.md + image/official-nodes.lock
# Starter/Pro (3090/4090) use Dockerfile.v3 → tag :v3
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV COMFYUI_PORT=8080

RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    curl \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN ln -s /usr/bin/python3.10 /usr/bin/python

WORKDIR /app
RUN git clone https://github.com/comfyanonymous/ComfyUI.git \
    || git clone https://github.com/comfyanonymous/ComfyUI.git

WORKDIR /app/ComfyUI
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 --default-timeout=300 --retries 5
RUN pip install --no-cache-dir comfyui-frontend-package==1.45.20
RUN pip install --no-cache-dir -r requirements.txt || pip install --no-cache-dir -r requirements.txt --no-deps

# SAM2 (Impact Pack) — local vendor copy; skip CUDA compile on CPU builders
COPY vendor/sam2 /app/vendor/sam2
# --no-build-isolation: reuse image torch (avoids re-downloading torch as build dep)
RUN SAM2_BUILD_CUDA=0 pip install --no-cache-dir --no-build-isolation --default-timeout=300 --retries 5 /app/vendor/sam2

# Official Node Pack (v4 = common + video nodes) — pinned SHAs
COPY image/official-nodes.lock /app/official-nodes.lock
COPY scripts/install-official-nodes.sh /app/install-official-nodes.sh
RUN sed -i 's/\r$//' /app/install-official-nodes.sh \
    && chmod +x /app/install-official-nodes.sh \
    && PROFILE=v4 COMFYUI_DIR=/app/ComfyUI LOCKFILE=/app/official-nodes.lock /app/install-official-nodes.sh

# GPUVietnam branding + backup flush node
COPY comfyui-extensions/gpuvietnam_branding/ /app/ComfyUI/custom_nodes/gpuvietnam_branding/
COPY comfyui-extensions/gpuvietnam_backup/ /app/ComfyUI/custom_nodes/gpuvietnam_backup/
COPY comfyui-extensions/gpuvietnam_cp_sync/ /app/ComfyUI/custom_nodes/gpuvietnam_cp_sync/

RUN mkdir -p /app/ComfyUI/models/checkpoints \
    && mkdir -p /app/ComfyUI/models/loras \
    && mkdir -p /app/ComfyUI/models/controlnet \
    && mkdir -p /app/ComfyUI/models/upscale_models \
    && mkdir -p /app/ComfyUI/user/default/workflows \
    && mkdir -p /app/ComfyUI/output

RUN find /app/ComfyUI/custom_nodes/gpuvietnam_branding /app/ComfyUI/custom_nodes/gpuvietnam_backup /app/ComfyUI/custom_nodes/gpuvietnam_cp_sync -type f \( -name '*.py' -o -name '*.js' \) -exec sed -i 's/\r$//' {} \;

COPY workflows/ /app/ComfyUI/workflows-stock/

COPY scripts/download-models.sh /app/download-models.sh
COPY scripts/setup-workstation.sh /app/setup-workstation.sh
COPY scripts/restore-environment.sh /app/restore-environment.sh
COPY scripts/start.sh /app/start.sh
COPY scripts/periodic-backup.sh /app/periodic-backup.sh
COPY scripts/filmmaker-resume.py /app/filmmaker-resume.py
RUN sed -i 's/\r$//' /app/download-models.sh /app/setup-workstation.sh /app/restore-environment.sh /app/start.sh /app/periodic-backup.sh /app/filmmaker-resume.py \
    && chmod +x /app/setup-workstation.sh /app/start.sh /app/download-models.sh /app/restore-environment.sh /app/periodic-backup.sh /app/filmmaker-resume.py

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=900s --retries=5 \
    CMD curl -f http://localhost:8080/ || exit 1

CMD ["/app/start.sh"]
