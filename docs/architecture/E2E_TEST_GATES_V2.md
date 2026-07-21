# E2E Test Gates — Architecture v2.0

| | |
|---|---|
| **Status** | Official test gating for CP / Runtime v2 |
| **Date** | 2026-07-21 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) · [ADR-005](./ADR-005-control-plane-runtime-v2.md) |
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) |
| **Branch baseline** | `feat/cp-runtime-b1` |

---

## Nguyên tắc

1. **Không test từng module riêng** làm điều kiện merge — ưu tiên **kịch bản nghiệp vụ (E2E)** chứng minh nguyên tắc Architecture v2.0.
2. **Đừng biến Merge Gate thành “phải test mọi thứ”.** Chia **4 Gate** theo mức độ chứng minh.
3. Phân biệt rõ:
   - **Implementation Complete** = đã code + unit/smoke giả trên branch  
   - **Production Proven** = đã PASS gate tương ứng trên GPU / môi trường thật  

```text
Gate 1 (P0)  Merge          → Architecture hoạt động
Gate 2 (P1)  Go-Live        → Sản phẩm sẵn sàng cho khách
Gate 3 (B4)  Hardening      → Ổn định / hiệu năng / Warm-Ephemeral
Gate 4       Production     → Scale, chaos, multi-region
```

---

## Gate 1 — Merge (P0) — bắt buộc trước khi merge

Chứng minh **Architecture v2.0 thực sự chạy** (thin slice trên GPU thật nơi có thể).

| ID | Mục tiêu | PASS khi |
|----|----------|----------|
| **T2** | Generate bình thường | Submit Job → Attempt → Runtime chạy → output → assets ngoài GPU → Attempt success; CP chỉ qua Port/Adapter |
| **T3** | Destroy sau hoàn thành | Runtime destroy, GPU trả; output / project / history vẫn còn |
| **T4** | Session Restore ≠ Job Resume | Destroy Runtime → Runtime mới → mở lại Project: workflow / assets / session còn; **không** yêu cầu CUDA resume |
| **T6** | GPU chết trước Generate | Destroy Runtime rồi Generate → Runtime mới + Attempt mới; Session không lỗi |
| **T7** | GPU chết giữa Generate | Attempt A fail → Attempt B trên GPU mới → output cuối đúng; **không** resume CUDA (re-run full) |
| **T8** | Dual-run | Hai Attempt song song; **cùng GPU line gói đang dùng**; **khác host**; pre-check ≥2 host |
| **T9** | Winner | GPU nhanh hơn thắng; loser hủy/destroy; output = winner |
| **T10** | Một GPU chết vẫn có kết quả | Kill một nhánh → nhánh còn lại hoàn thành có output |
| **T17 hoặc T18** | Parity chặn Runtime xấu | Thiếu custom node **hoặc** sai Image Spec → **không submit**; lỗi rõ (một kịch bản đủ cho P0) |
| **T19** | Smoke ảnh thật | SDXL + LoRA (hoặc bộ smoke cố định của image) trên GPU thật |
| **A1–A8** | Nguyên tắc v2.0 | Xem bảng dưới — được PASS bằng code review + test giả + spot-check GPU, không bắt buộc 8 lần rent riêng |

### A1–A8 (kiến trúc)

| ID | Nguyên tắc | Cách chứng minh gợi ý |
|----|------------|------------------------|
| **A1** | CP không gọi trực tiếp ComfyUI API | Code path chỉ Port/Adapter; không import Comfy client từ CP orchestration |
| **A2** | Mất Runtime ≠ mất Session | T4 / session-restore |
| **A3** | Mất Runtime ≠ mất Project | T4 |
| **A4** | Mất Runtime ≠ mất Assets | T3 / T4 — Plane B còn |
| **A5** | Mất Runtime ≠ mất Billing | Session/ledger không phụ thuộc Comfy process |
| **A6** | Mất Runtime ≠ mất History | Job/Attempt trên CP (T3 / lich-su) |
| **A7** | Đổi Provider ≠ đổi Control Plane | Cùng Port/Job-Attempt; provider chỉ sau Adapter |
| **A8** | Dual-run = Runtime Policy | Không layer kiến trúc mới; Job → Attempt A/B (ADR-006) |

### Ghi chú P0

- **T1** (Create Runtime) không bắt buộc riêng nếu **T2** đã cover create + registry + Comfy ready.
- Dual-run (**T8–T10**) là P0 của PR/merge có B3. Nếu merge chỉ B1–B2, dual-run có thể trì hoãn theo PR dual-run — không trộn với “mọi thứ chưa xong”.
- **T12** (billing dual-run SCB) **không** thuộc Gate 1.

**Quyết định:** Toàn bộ Gate 1 PASS → **đủ điều kiện merge** nhánh runtime v2 (thin slice).

---

## Gate 2 — Go-Live (P1) — trước khi mở cho khách

Hoàn thiện sản phẩm / vận hành ngày một.

| ID / mục | PASS khi |
|----------|----------|
| **T12** | Hệ số Admin (vd 1.65×) áp vào settle SCB dual-run; không trừ 2 lần full; không âm giờ |
| **T11** | Billing phiên đơn: đúng giờ / đúng giá |
| **T13** | Vast: rent → generate → destroy |
| **T14** | Clore: tương đương Vast (nếu Clore trong routing) |
| **T20** | Smoke video (Wan / Hunyuan / … nếu image hỗ trợ) |
| **T5** | Snapshot Save → sửa → Restore đúng, assets còn |
| Dashboard | Job/Attempt, Dual-run card, restore banner hiển thị đúng |
| Log / alert | Runtime lỗi có log đủ; alert tối thiểu khi Runtime fail lặp |
| Retry thực tế | Failover / bad-host walk ổn trên marketplace thật |

**Quyết định:** Gate 1 + Gate 2 PASS → **đủ Go-Live** (khách thật).

---

## Gate 3 — Hardening (B4)

Tối ưu và cứng hóa — **không** chặn merge thin-slice.

| ID / mục | Ghi chú |
|----------|---------|
| CUDA Benchmark | Cold start, VRAM, ckpt + LoRA + video |
| Warm Runtime | Generate liên tiếp không lỗi (T21) |
| Ephemeral Runtime | Generate → destroy → generate lại (T22) |
| Health + auto failover | Monitor / policy |
| Stress | T23 (~10 Job), T24 (~100 Job), T25 (nhiều Runtime / registry) |
| Provider mở rộng | Salad / … theo roadmap |

---

## Gate 4 — Production Scale

Khi đã có tải / khách thật.

- Chaos: kill GPU ngẫu nhiên  
- Network partition / provider outage  
- Rollback Runtime / rolling update  
- Multi-region  
- Khôi phục sau sự cố  

---

## Mapping checklist phẳng T1–T25 → Gate

| Test | Gate mặc định | Ghi chú |
|------|---------------|---------|
| T1 | (gộp vào T2) | Không bắt buộc riêng ở P0 |
| T2, T3, T4, T6, T7 | **Gate 1** | Cốt lõi B1/B2 |
| T5 | Gate 2 | Snapshot |
| T8, T9, T10 | **Gate 1** (khi merge B3) | Dual-run |
| T11 | Gate 2 | Billing thường |
| T12 | Gate 2 | Billing dual-run SCB |
| T13, T14 | Gate 2 | Provider thật |
| T15 Cross-provider mid-job | Gate 2–3 / stretch | Không P0 trừ khi đã ship explicit |
| T16 | Gate 2 | Thiếu model (parity) |
| T17 / T18 | **Gate 1** (một cái) | Parity chặn |
| T19 | **Gate 1** | Smoke ảnh |
| T20 | Gate 2 | Smoke video |
| T21, T22 | Gate 3 | Warm / Ephemeral |
| T23–T25 | Gate 3 | Stress |
| A1–A8 | **Gate 1** | Nguyên tắc v2.0 |

---

## Trạng thái hiện tại (branch `feat/cp-runtime-b1`)

| Hạng mục | Trạng thái |
|----------|-----------|
| B1–B3 Implementation Complete | Code + unit/smoke giả trên branch |
| Gate 1 trên GPU thật | **Chưa** coi Production Proven |
| Migrations 0043–0047 | Trong repo/manifest — **không** mặc định đã apply prod |
| T12 SCB dual-run settle | Hệ số Admin có; nối settle thật còn lại → Gate 2 |

---

## Cách dùng

1. Trước merge PR runtime: chạy / tick **Gate 1** only.  
2. Trước bật khách: thêm **Gate 2**.  
3. Không để Gate 3–4 chặn merge.  
4. Cập nhật trạng thái Implementation vs Proven trong PR description khi merge.

### Related

- [B1_7_FAILOVER.md](./B1_7_FAILOVER.md) · [B2_SESSION_CONTINUITY.md](./B2_SESSION_CONTINUITY.md) · [B3_DUAL_RUN.md](./B3_DUAL_RUN.md) · [ADR-006](./ADR-006-dual-run-policy.md)
