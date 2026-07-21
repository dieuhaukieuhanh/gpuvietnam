# Implementation Roadmap — post Architecture v2.0 Freeze

| | |
|---|---|
| **Status** | **Official implementation plan** |
| **Effective** | 2026-07-21 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) · [ADR-005](./ADR-005-control-plane-runtime-v2.md) |
| **Code baseline** | Tag `checkpoint/pre-cp-runtime-split` · Freeze tag `architecture/v2.0-freeze` |
| **Gate question** | *Does this decision violate Architecture v2.0?* |

Làm **theo thứ tự**. Mỗi bước có **Deliverable** và tiêu chí **Xong khi**. Không nhồi Salad / Warm Pool / FE mới vào B1.

---

## Giai đoạn 0 — Nền tảng ✅

| Step | Việc | Deliverable | Xong khi |
|------|------|-------------|----------|
| 0.1 | Evidence ComfyUI #001–#006 | Investigation reports (external / prior work) | Boundary & ephemeral facts recorded |
| 0.2 | Code checkpoint | Tag `checkpoint/pre-cp-runtime-split` | Push lên GitHub |
| 0.3 | Architecture Freeze v2.0 | `ARCHITECTURE_V2_FREEZE.md` + ADR-005 + tag `architecture/v2.0-freeze` | Frozen & linked từ PROJECT_CONTEXT |

---

## Giai đoạn 1 — B1: Tách mỏng (làm trước)

**Mục tiêu:** Control Plane sở hữu Job/Attempt; Comfy chỉ Runtime; máy chết → Attempt mới (chạy lại).  
**Không làm trong B1:** dual-GPU, FE Comfy thay thế toàn bộ, Warm pool phức tạp.

Thứ tự xương sống:

```text
Job/Attempt
    ↓
Persistent Storage
    ↓
Runtime Image Spec          ← 1.3.5 (parity)
    ↓
Runtime Port
    ↓
Comfy Adapter
    ↓
Provider ↔ Attempt
    ↓
Failover (Attempt mới)
    ↓
Dashboard tối thiểu
```

| Step | Việc | Deliverable | Xong khi |
|------|------|-------------|----------|
| 1.1 | Branch làm việc từ freeze/checkpoint | Branch `feat/cp-runtime-b1` (từ `architecture/v2.0-freeze` / roadmap baseline) | Làm việc trên branch, không phá lung tung baseline |
| 1.2 | Mô hình Session / Project / Workflow / Job / Attempt / Runtime Registry + trạng thái | **Schema + Migration** (`supabase/cp-runtime-v2-foundation.sql` id **0043**) + [B1_2_DATA_MODEL.md](./B1_2_DATA_MODEL.md) | Lưu được Job/Attempt độc lập với một GPU |
| 1.3 | Kho bền: input/output (+ quy ước model) ngoài ổ GPU | **Storage Spec** [B1_3_STORAGE_SPEC.md](./B1_3_STORAGE_SPEC.md) + `cp_assets` (**0044**) + `src/lib/cp-runtime/storage-paths.js` | Hủy máy không mất file cần cho Attempt sau |
| **1.3.5** | **Runtime Image Spec** (parity): Docker image, custom nodes, models, LoRA, extensions bắt buộc cho một Attempt | [RuntimeImageSpec.md](./RuntimeImageSpec.md) + `runtime-image-spec.js` + `jobs.required_image_spec_ref` (**0045**) | Trước submit biết Runtime “đủ môi trường” hay không |
| 1.4 | Runtime Port (create / submit / monitor / fetch / destroy) | [RuntimePort.md](./RuntimePort.md) + `src/lib/cp-runtime/runtime-port.js` (stub/interface) | CP chỉ nói chuyện qua Port |
| 1.5 | Comfy Adapter implement Port | [B1_5_COMFY_ADAPTER.md](./B1_5_COMFY_ADAPTER.md) + `comfy-adapter.js` + smoke test (fake Comfy e2e via Port) | Một Job end-to-end qua Adapter, CP không gọi Comfy trực tiếp |
| 1.6 | Provider gắn Attempt: thuê máy → metadata → submit | [B1_6_PROVIDER_ATTEMPT.md](./B1_6_PROVIDER_ATTEMPT.md) + `provider-runtime-bind.js` | Một Attempt = một Runtime/GPU |
| 1.7 | Failover: Runtime chết → Attempt FAIL → Attempt 2 trên máy mới | Failover path + test/runbook | Job hoàn thành trên máy B sau khi A chết (chạy lại, không resume CUDA) |
| 1.8 | Dashboard tối thiểu: trạng thái Job/Attempt | UI tối thiểu trên dashboard | User thấy queued / running / failed / retry |

### Definition of Done — B1

Hủy Runtime giữa chừng → máy mới → Attempt 2 chạy lại → output trên kho bền; CP không gọi Comfy trực tiếp; Attempt chỉ chạy khi Image Spec parity đạt.

---

## Giai đoạn 2 — B2: Phiên web không mất

**Mục tiêu:** Đổi GPU mà Project/Session/Workflow vẫn còn; khách tiếp tục soạn bài (Session Restore ≠ Job Resume).

| Step | Việc | Deliverable | Xong khi |
|------|------|-------------|----------|
| 2.1 | Workflow SoT trên Control Plane | Persist/sync graph & settings về CP | Mất máy A không mất bài đang soạn |
| 2.2 | Session Restore UX (thông báo máy mới / job chạy lại) | **Session Restore Demo** | Khách không bắt đầu lại Project từ zero |
| **2.2.5** | **Project Snapshot** — user Save → CP lưu snapshot (nền cho restore nhanh + versioning sau) | Snapshot API/model + “Save” flow | Restore từ snapshot ổn định, tái lập được |
| 2.3 | Rebind proxy / Runtime URL theo Runtime mới | Proxy/token rebind spec + behavior | Endpoint/`work.*` trỏ đúng máy hiện tại |
| 2.4 | History sản phẩm = Job/Attempt trên CP | History UI/API từ CP | Xem lại run cũ sau đổi máy (không phụ thuộc `/history` Comfy) |

### Definition of Done — B2

Đổi GPU: Session/Project/Workflow (và snapshot) còn trên web; Job đang chạy vẫn chỉ qua Attempt mới nếu fail.

---

## Giai đoạn 3 — B3: Render an toàn (dual-run)

**Mục tiêu:** Dual-run là **Runtime Policy**, không phải kiến trúc mới.

| Step | Việc | Deliverable | Xong khi |
|------|------|-------------|----------|
| 3.1 | Policy Dual-run: Job → Attempt A + Attempt B | **DualRun policy note / ADR nhỏ** (policy, không đổi lớp) | Spec + cờ bật cho KH |
| 3.2 | Chọn kết quả thắng; hủy Attempt còn lại | Winner selection + cleanup | Một output thắng khi một GPU chết hoặc chậm |
| 3.3 | Billing + UX “chạy 2 GPU” | Pricing/UX copy + flags | KH bật/tắt và hiểu chi phí |

### Definition of Done — B3

Bật an toàn → hai Attempt song song; một Runtime chết vẫn có kết quả từ Attempt còn lại (nếu còn sống và xong).

---

## Giai đoạn 4 — Cứng hóa vận hành

**Thứ tự đã chỉnh:** đo GPU thật **trước** khi chốt Warm/Ephemeral policy (policy dựa trên số liệu).

```text
CUDA Benchmark
    ↓
Parity checks (dựa trên Image Spec)
    ↓
Health + auto failover
    ↓
Runtime Policy (Warm / Standby / Ephemeral)
    ↓
Provider hoàn thiện
```

| Step | Việc | Deliverable | Xong khi |
|------|------|-------------|----------|
| 4.1 | Đo CUDA thật: cold start, VRAM, ckpt + LoRA + video | **CUDA Benchmark Report** | Có số liệu để chọn policy |
| 4.2 | Parity gate trước mọi submit (dùng Runtime Image Spec) | Automated parity check | Attempt bị từ chối nếu thiếu node/model |
| 4.3 | Health monitoring + auto Attempt FAIL → Attempt mới | Auto-failover rules + metrics | Failover không cần thao tác tay trong case chuẩn |
| 4.4 | Runtime Policy: Ephemeral / Warm / Standby (cấu hình) | Policy config + docs | Policy chọn dựa trên báo cáo 4.1 |
| 4.5 | Chuẩn hóa thêm provider trong Provider Adapter | Provider parity checklist | Thêm/đổi provider không phá SoT CP |

---

## Việc song song (không chặn B1)

- Giữ SCB Architecture Freeze (billing) không đụng lung tung.  
- Chuẩn hóa Docker image ComfyUI (khớp Runtime Image Spec).  
- Làm trên feature branch; không commit secret/log.

---

## Một dòng ưu tiên

```text
0 ✅ Freeze
→ 1.1 Branch
→ 1.2 Schema Job/Attempt
→ 1.3 Storage Spec
→ 1.3.5 Runtime Image Spec
→ 1.4 RuntimePort.md
→ 1.5 ComfyAdapter
→ 1.6–1.7 Provider + Failover Attempt
→ 1.8 UI tối thiểu
→ 2.x Session Restore + Project Snapshot
→ 3.x Dual-run policy
→ 4.1 CUDA Benchmark → parity → health → policy
```

---

## Revisions vs first draft

| Điều chỉnh (từ review) | Lý do |
|------------------------|--------|
| Thêm **1.3.5 Runtime Image Spec** | Bắt buộc parity sớm; giảm rủi ro B4 |
| Thêm **2.2.5 Project Snapshot** | Restore nhanh + versioning sau này |
| **CUDA Benchmark trước Runtime Policy** | Policy dựa trên số liệu, không đoán |
| Cột **Deliverable** mỗi bước | Quản lý tiến độ rõ |

Roadmap này là **kế hoạch triển khai chính thức** sau Architecture Freeze v2.0.
