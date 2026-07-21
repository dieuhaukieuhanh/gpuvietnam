# GPUVietnam — Smoke Test Checklist (E2E)

**Images**

| Tag | Gói / GPU target | Ghi chú |
|-----|------------------|---------|
| `dieuhaukieuhanh/gpuvietnam-comfyui:v3` | Starter (RTX 3090) · Pro (RTX 4090) | CUDA ~12.0 · PyTorch cu118 |
| `dieuhaukieuhanh/gpuvietnam-comfyui:v4` | Studio (RTX 5090 marketing) | CUDA 12.8 · PyTorch cu128 · AnimateDiff + VHS |

**SoT liên quan (bắt buộc đọc trước khi PASS):**

- Image / Official Node Pack: [`docs/COMFYUI_IMAGE.md`](./COMFYUI_IMAGE.md)
- Smart Restore Level 1: [`docs/SMART_RESTORE.md`](./SMART_RESTORE.md)
- Backup paths: [`docs/BACKUP_RUNBOOK.md`](./BACKUP_RUNBOOK.md)

---

## Mục tiêu

Xác nhận image + app (provision → Comfy → backup → restore) ổn định trên Vast.ai / Clore.ai **trước khi mở production**.

Checklist này = **E2E trên Dashboard thật**. Smoke node pack tối thiểu vẫn nằm trong `COMFYUI_IMAGE.md` — cả hai phải PASS.

---

## Tiêu chí PASS / FAIL

| Mức | Ý nghĩa |
|-----|---------|
| **Blocker** | FAIL → **không** ship / không mở KH |
| **Ghi nhận** | Điền số liệu (phút/giây); chậm ≠ FAIL trừ khi timeout / không vào được Comfy |

Mọi mục Blocker FAIL: ghi log cụ thể (requestId / container log / screenshot) rồi dừng và sửa trước khi tiếp tục.

---

## Điều kiện tiên quyết

- [ ] App đang deploy đúng resolve image: Starter/Pro → `:v3`, Studio → `:v4`
- [ ] Docker Hub đã có digest mới nhất của tag cần test
- [ ] R2 stock models cấu hình (`GPUVIETNAM_MODELS_BASE_URL` / runbook stock models)
- [ ] Auto Backup **bật** cho user test (Starter nếu policy đã bật)
- [ ] R2 backup bucket + Supabase `backup_logs` truy cập được
- [ ] User test có đủ giờ gói Starter (v3) và Studio (v4)

---

## PHẦN A — Image v3 (Starter / Pro)

### A0. Provision (Blocker)

- [ ] Dashboard → gói **Starter** (hoặc Pro) → môi trường **Character & Art**
- [ ] Bấm mở phiên làm việc
- [ ] Vào được ComfyUI (qua app / Open Comfy) — **Blocker**
- [ ] Thời gian từ bấm đến Comfy dùng được: ___ phút *(ghi nhận)*
- [ ] Tab Chrome hiển thị đúng short name môi trường: **`Character & Art`** (không phải `GPUVietnam — …`) — **Blocker** nếu sai hẳn / không đổi tên

### A1. Gen ảnh cơ bản (Blocker)

- [ ] Load workflow `sinh-anh-co-ban.json`
- [ ] Prompt đơn giản (vd. `A cute cat, cartoon style`)
- [ ] Queue Prompt → ảnh ra thành công — **Blocker**
- [ ] Thời gian ảnh đầu: ___ giây *(ghi nhận)*

### A2. Official Node Pack v3 (Blocker — map `COMFYUI_IMAGE.md`)

Chạy tối thiểu 1 case / mục (workflow sẵn hoặc graph nhỏ). Node đỏ / import lỗi = FAIL.

- [ ] Face Detailer (Impact Pack)
- [ ] IPAdapter cơ bản (không yêu cầu FaceID / insightface)
- [ ] ControlNet — 1 preprocessor
- [ ] Ultimate SD Upscale
- [ ] Florence2
- [ ] RMBG

### A3. Stock models từ R2 (Blocker nếu cả hai miss + gen fail)

Trong **logs container** (Vast/Clore), tìm pattern thực tế (không dùng emoji ✅ cũ):

- [ ] Có dòng dạng `[Models] OK: …` cho checkpoint (vd. `sd_xl_base_1.0.safetensors` và/hoặc `RealVisXL_V6.0_B1.safetensors`)
- [ ] Nếu R2 miss: có `[Models] R2 miss …` rồi fallback HF/symlink — ghi rõ nguồn: R2 / fallback / symlink
- [ ] Trong Comfy: checkpoint load được khi queue — **Blocker**

### A4. Periodic backup (Blocker)

Sau khi có vài output mới, chờ interval Auto Backup (hoặc flush nếu có):

- [ ] R2: object dưới `users/{userId}/outputs/…` (đúng prefix runbook — **không** yêu cầu `…/periodic/outputs/`)
- [ ] Có thể thấy thêm `workflows/` / `settings/` nếu đã đổi — *(ghi nhận)*
- [ ] Thời gian từ tạo ảnh → object xuất hiện: ___ phút *(ghi nhận)*

### A5. Stop + backup cuối (Blocker)

- [ ] Dashboard → tắt máy / đóng phiên
- [ ] R2: có archive / object stop-backup (theo runbook)
- [ ] Supabase `backup_logs`: có bản ghi mới cho user — **Blocker**

### A6. Smart Restore Level 1 (Blocker)

Bật máy mới cùng user (Starter/Pro → image v3):

**Phân loại (xem UI / tick):**

- [ ] Workspace **nhỏ (≤ ~200MB Level-1)**: auto `workspace_restoring` → `workspace_ready` (không bắt buộc hỏi)
- [ ] Workspace **lớn**: UI `workspace_choice` hiện size/breakdown + nút tiếp tục / phiên mới
- [ ] **Refresh trang** khi đang `workspace_choice` / `workspace_failed`: prompt **không mất** — **Blocker** nếu mất

**Sau continue / auto:**

- [ ] Outputs phiên trước có trong Comfy output (hoặc đã restore) — **Blocker** nếu đã backup mà trống hoàn toàn
- [ ] Workflow cá nhân / workflow env khôi phục được — **Blocker** nếu đã backup workflows mà mất hết

**Fail path (nếu tái hiện được):**

- [ ] `workspace_failed` vẫn mở được Comfy + có nút thử lại / bỏ qua

**Ngoài phạm vi Level 1 (không FAIL nếu thiếu):**

- Models / LoRA user, custom nodes tự cài — chưa auto-restore (L3 / L2)

---

## PHẦN B — Image v4 (Studio)

### B0. Provision (Blocker)

- [ ] Dashboard → gói **Studio** → môi trường **Video AI** (hoặc Character nếu đang test gen ảnh)
- [ ] Vào được ComfyUI — **Blocker**
- [ ] Thời gian boot: ___ phút *(ghi nhận)*
- [ ] Tab title short name đúng môi trường (vd. `Video AI`) — **Blocker** nếu sai

### B1. CUDA / GPU (Blocker linh hoạt)

Host marketplace có thể lệch marketing; ưu tiên **đúng image v4 + GPU dùng được**:

- [ ] Logs / `nvidia-smi` / Comfy startup: CUDA **12.8** (hoặc stack cu128) — **Blocker** nếu image v3 nhầm lên Studio
- [ ] Device CUDA visible (tên GPU ghi nhận: ____________ ; VRAM ___ MB)
- [ ] Không bắt buộc đúng chữ `RTX 5090` nếu host thay thế cùng class — ghi thực tế vào bảng tổng kết

### B2. Gen ảnh cơ bản (Blocker)

- [ ] `sinh-anh-co-ban.json` → tạo ảnh OK — **Blocker**
- [ ] Thời gian render: ___ giây *(ghi nhận)*

### B3. Official Node Pack v4 (Blocker)

Toàn bộ mục A2, thêm:

- [ ] AnimateDiff Evolved (1 graph/workflow tối thiểu chạy được)
- [ ] Video Helper Suite (load/save hoặc node VHS tương đương không đỏ)

### B4. Backup / Restore nhanh (Blocker)

- [ ] Periodic hoặc stop-backup tạo được object R2 + (nếu tắt máy) `backup_logs`
- [ ] Phiên sau: Smart Restore auto hoặc choice hoạt động như A6 (có thể rút gọn nếu A6 đã cover cùng user — vẫn nên 1 vòng Studio)

---

## PHẦN C — Failover & bad host (Ghi nhận / Blocker có điều kiện)

Chỉ **Blocker** nếu hệ thống fail ngay offer đầu mà **không** retry khi còn offer, hoặc loop vô hạn.

### C1. Retry khi offer đầu fail

- [ ] Trong app logs: thấy `[vast/…]` hoặc `[clore/…]` thử offer / host tiếp theo khi offer đầu lỗi
- [ ] Ít nhất 2 attempt (nếu marketplace còn ứng viên) trước khi báo hết máy — *(ghi nhận số attempt: ___)*

### C2. Bad-host memory

Không chỉ nhìn Supabase:

- [ ] Sau bad host: có dấu hiệu exclusion (log `bad-host` / `remembered` / skip host)
- [ ] Optional: row `provider_bad_hosts` (dual-write) — thiếu row **không** FAIL nếu file TTL / log exclusion vẫn có
- [ ] Runtime thường: `tmp/vast-bad-hosts.json` hoặc `tmp/clore-bad-hosts.json` trên app server *(nếu truy cập được)*

---

## PHẦN G — HTTP-first provision gate (Clore + Vast)

Gate hard path = public Comfy HTTP (`/system_stats` + `/prompt` smoke). SSH fail **không** được hủy máy nếu HTTP pass (`ops_degraded` / badge Admin `ops↓`).

### G0. Customer-path (Blocker)

- [ ] Mở phiên → log có `gate.http_pass` (hoặc stage RUNNING) — **Blocker**
- [ ] Vào được Comfy qua app — **Blocker**
- [ ] Nếu SSH kém: log `gate.ssh_soft_fail` + máy vẫn giao (`ops_degraded=true`) — **không** FAIL provision
- [ ] Admin Customers: badge `ops↓` khi `ops_degraded` *(ghi nhận)*

### G1. Backup HTTP trên máy ops-degraded (Blocker nếu SSH chết)

- [ ] Đóng phiên / stop trên máy `ops_degraded` (SSH fail)
- [ ] Log `L2 HTTP flush` succeed (không bắt buộc fallback SSH) — **Blocker** nếu chỉ còn SSH và SSH chết
- [ ] Có `backup_logs` completed — **Blocker**

### G2. Provision journal (tự động)

Mỗi lần rent+gate (Clore/Vast) ghi 1 dòng vào `tmp/provision-journal.jsonl`.

```bash
npm run provision:journal
npm run provision:journal -- --provider=clore
```

Xem funnel: Rent → http_pub → HTTP → system_stats → prompt smoke → RUNNING + fail-by-step.

Mục tiêu thống kê: **10–15** lần trước, rồi hướng tới **30–50** trước khi chốt Clore primary.

### G3. Clore-only verdict (sau gate mới)

Chạy nhiều lần mở với `GPU_CLORE_ONLY=true`. Ghi:

| Lần | HTTP pass? | SSH soft? | RUNNING? | Backup HTTP? |
|:---:|:---:|:---:|:---:|:---:|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

**Giữ Clore** nếu tỷ lệ `rent → RUNNING` chấp nhận được **và** backup HTTP OK trên máy degraded.  
**Loại / hạ Clore** nếu HTTP customer-path cũng fail hàng loạt (không kết luận chỉ vì SSH).

---

## TỔNG KẾT

| Hạng mục | v3 Starter/Pro | v4 Studio | Blocker? | Ghi chú |
|:---|:---:|:---:|:---:|:---|
| Provision → Comfy | ✅ / ❌ | ✅ / ❌ | Có | Boot: v3 ___ phút · v4 ___ phút |
| Tab title short name | ✅ / ❌ | ✅ / ❌ | Có | |
| Gen ảnh cơ bản | ✅ / ❌ | ✅ / ❌ | Có | Render: v3 ___ s · v4 ___ s |
| Official Node Pack | ✅ / ❌ | ✅ / ❌ | Có | v4 gồm AnimateDiff + VHS |
| Models stock dùng được | ✅ / ❌ | ✅ / ❌ | Có | Nguồn: R2 / fallback |
| Periodic backup `users/{id}/outputs/` | ✅ / ❌ | ✅ / ❌ | Có | |
| Stop-backup + `backup_logs` | ✅ / ❌ | ✅ / ❌ | Có | |
| Smart Restore L1 (+ refresh hydrate) | ✅ / ❌ | ✅ / ❌ | Có | |
| Failover / bad-host | ✅ / ❌ / N/A | ✅ / ❌ / N/A | Có điều kiện | |

**GPU thực tế v4:** ____________ · **CUDA:** ____________

**Kết luận ship production:** ✅ / ❌  

Chỉ ✅ khi **mọi Blocker PASS** (kể cả node pack trong `COMFYUI_IMAGE.md`).

---

## Ghi chú vận hành

1. FAIL Blocker → dừng, gửi log/requestId/ảnh màn hình; không mở KH.
2. Thời gian boot/render chỉ để so sánh host — không dùng một mình để FAIL.
3. Level 1 **không** khôi phục models user / custom nodes — thiếu những thứ đó không FAIL smoke image v1.0.
4. Sau mọi mục PASS: có thể mở production; lần đổi Official Pack sau này = rebuild + chạy lại checklist (ít nhất Phần A2/B3 + A0/B0).
