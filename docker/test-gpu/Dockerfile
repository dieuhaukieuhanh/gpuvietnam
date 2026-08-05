# GPU Test Image — lightweight infrastructure probe (~200-300 MB)
# No ComfyUI, no PyTorch. Just CUDA runtime + nvidia-smi + health HTTP.
#
# Purpose: pre-validate Vast hosts every 15 min without pulling the full
# ComfyUI image (5-8 GB). This image starts in ~20-30s vs 2-5 min.
#
# Build: docker build -t gpuvietnam/gpu-test:v1 .
# Push:  docker push gpuvietnam/gpu-test:v1

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Minimal system deps: python3 for HTTP server + curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy health server
COPY server.py /app/server.py

# Copy CUDA smoke test (tiny C binary compiled against CUDA runtime)
# Build this binary separately: nvcc -o cuda_smoke cuda_smoke.cu -lcuda
# For now, we use nvidia-smi + python ctypes as the smoke mechanism.
COPY cuda_check.py /app/cuda_check.py

WORKDIR /app

# Health server listens on :: (IPv6 dual-stack, same as ComfyUI image convention)
ENV HOST=::
ENV PORT=8080

EXPOSE 8080

CMD ["python3", "/app/server.py"]
