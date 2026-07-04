# Base image với CUDA 12.0 và Ubuntu 22.04
FROM nvidia/cuda:12.0.0-runtime-ubuntu22.04

# Thiết lập môi trường
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV COMFYUI_PORT=8080

# Cài đặt các gói cần thiết
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    curl \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Tạo symlink python
RUN ln -s /usr/bin/python3.10 /usr/bin/python

# Clone ComfyUI
WORKDIR /app
RUN git clone https://github.com/comfyanonymous/ComfyUI.git \
    || git clone https://github.com/comfyanonymous/ComfyUI.git

# Cài đặt dependencies của ComfyUI
WORKDIR /app/ComfyUI
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 --default-timeout=300 --retries 5
# Cài đặt gói cụ thể trước để tránh xung đột phiên bản
RUN pip install --no-cache-dir comfyui-frontend-package==1.45.20

# Cài đặt các gói còn lại. Nếu có lỗi, bỏ qua việc kiểm tra dependencies để quá trình build không bị dừng.
RUN pip install --no-cache-dir -r requirements.txt || pip install --no-cache-dir -r requirements.txt --no-deps

# Cài ComfyUI Manager
WORKDIR /app/ComfyUI/custom_nodes
RUN git clone https://github.com/ltdrdata/ComfyUI-Manager.git
WORKDIR /app/ComfyUI/custom_nodes/ComfyUI-Manager
RUN pip install --no-cache-dir -r requirements.txt

# Tạo thư mục cho models và workflows
RUN mkdir -p /app/ComfyUI/models/checkpoints
RUN mkdir -p /app/ComfyUI/models/loras
RUN mkdir -p /app/ComfyUI/models/controlnet
RUN mkdir -p /app/ComfyUI/models/upscale_models
RUN mkdir -p /app/ComfyUI/user/default/workflows
RUN mkdir -p /app/ComfyUI/output

# Workflow mẫu GPUVietnam (stock — setup-workstation.sh chọn theo môi trường)
COPY workflows/ /app/ComfyUI/workflows-stock/

# Script tải models (chạy thủ công trong container hoặc trước deploy)
COPY scripts/download-models.sh /app/download-models.sh

# Script chọn môi trường + khởi động
COPY scripts/setup-workstation.sh /app/setup-workstation.sh
COPY scripts/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/download-models.sh /app/setup-workstation.sh /app/start.sh \
    && chmod +x /app/setup-workstation.sh /app/start.sh /app/download-models.sh

# Expose port
EXPOSE 8080

# Health check (start-period dài vì lần đầu tải model ~6GB)
HEALTHCHECK --interval=30s --timeout=10s --start-period=900s --retries=5 \
    CMD curl -f http://localhost:8080/ || exit 1

# Khởi động
CMD ["/app/start.sh"]
