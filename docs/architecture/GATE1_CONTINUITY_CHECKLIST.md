# Gate 1 — Continuity checklist (Comfy ↔ CP trên GPU thật)

| | |
|---|---|
| **Mục tiêu** | Chứng minh Architecture v2.0 trên GPU thật: **Control Plane là SoT**, Runtime chỉ thực thi, GPU thay được mà không mất phiên |
| **Trước khi** | A0.5 / A1 (Frontend Separation) |
| **Liên quan** | [GATE1_TEST_STATUS.md](./GATE1_TEST_STATUS.md) · [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md) · [B2_SESSION_CONTINUITY.md](./B2_SESSION_CONTINUITY.md) · [A0_FRONTEND_SEPARATION_REPORT.md](./A0_FRONTEND_SEPARATION_REPORT.md) |
| **Branch** | `feat/cp-runtime-b1` |

**Phân loại**

| Gate | Bài | Bắt buộc? |
|------|-----|-----------|
| **Gate 1 Continuity** | **G1–G6** | Có — trước A0.5 |
| **Gate 2 / Go-Live** | **G7** (nhiều lần chuyển Runtime) | Khuyến nghị trước khách lâu dài |

Không thay thế toàn bộ Gate 1 merge (T2–T19 dual-run/parity); G1–G6 map vào T2/T4/T6–T7/A2.

---

## Chuẩn bị (một lần)

1. Migrations **0043 → 0046** (CP foundation + `cp_workflows`) đã apply trên môi trường test.
2. Cloudflare Worker `comfy-proxy` đã deploy bản có `/gpuvietnam/cp/sync`.
3. Image Comfy có `gpuvietnam_cp_sync` (build mới) — thuê **máy mới** sau khi build.
4. `COMFY_PROXY_ENABLED=1` + mint `workUrl` hoạt động; tài khoản còn giờ GPU.

---

## Gate 1 — G1–G6 (bắt buộc)

| # | Mục tiêu | Cách làm | PASS khi | Map |
|---|----------|----------|----------|-----|
| **G1** | Sync CP | Soạn graph → chờ **「Control Plane: đã lưu」** | Đã lưu; revision tăng (tuỳ chọn kiểm API) | B0 sync |
| **G2** | CP là SoT | Sau G1: **tắt hẳn trình duyệt** → mở lại → mở Comfy | Graph còn đủ (không localStorage) | SoT thật |
| **G3** | Stop bình thường | Stop dashboard → máy mới → mở Comfy | Graph còn | ≈ T4 |
| **G4+G6** | Kill Provider + Generate restore | Chạy **kịch bản hoàn chỉnh** bên dưới (một lần) | Attempt A Failed; Project còn; Runtime B restore đúng graph; Attempt B OK; output đúng graph | ≈ T6/T7 + T2 |
| **G5** | Session Restore UX | Trong/sau kịch bản G4+G6 (hoặc G3) | Banner đúng; **không** claim resume CUDA | T4 UX |

G4 và G6 **nên gộp** — mô phỏng sự cố ngoài đời tốt hơn chạy rời.

### G2 — tránh PASS giả

- Không chỉ F5 trong cùng tab.  
- Không dựa Comfy local draft / browser cache.  
- PASS = đọc lại từ Control Plane (`cp_workflows`).

### Kịch bản hoàn chỉnh G4+G6 (khuyến nghị chạy)

```text
Soạn graph
      ↓
Đã lưu lên Control Plane          ← G1
      ↓
Generate trên Runtime A
      ↓
Kill GPU A từ Provider            ← không dùng nút Stop dashboard
      ↓
Attempt A = Failed
      ↓
Project / Workflow vẫn còn        ← Job chết, Project sống
      ↓
Runtime B
      ↓
Session Restore                   ← G5
      ↓
Graph được restore                ← đúng graph đã sync, không soạn mới
      ↓
Generate lại
      ↓
Attempt B thành công
      ↓
Output đúng graph vừa restore     ← G6 + parity cơ bản
```

Một lần chạy chứng minh gần như toàn bộ Architecture v2.0 continuity:

- Control Plane = SoT  
- Runtime disposable  
- Job ≠ Session (không resume CUDA)  
- Restore đúng Project/Workflow  
- Runtime mới thực thi được graph cũ  
- Parity image/node/model đủ để chạy lại  

**Session Restore ≠ Job Resume.**

---

## Gate 2 / Go-Live — G7 (khuyến nghị)

Không bắt buộc để PASS Gate 1 / mở A0.5. Nên làm trước khi khách dùng project nhiều ngày.

| # | Mục tiêu | PASS khi |
|---|----------|----------|
| **G7** | Nhất quán sau **nhiều** lần chuyển Runtime | Graph trên Runtime C = **phiên bản mới nhất** (đã sửa trên B), không bị rollback về bản A |

```text
Runtime A → Soạn + Generate → Kill
      ↓
Runtime B → Sửa graph → Lưu CP → Generate → Kill
      ↓
Runtime C → Graph = phiên bản mới nhất (sau sửa trên B)
```

Chứng minh CP không chỉ “giữ được Project” mà luôn giữ **revision mới nhất** qua nhiều vòng stop/start / thay GPU.

---

## Kết quả ghi nhận

| ID | Gate | Kết quả (PASS/FAIL/BLOCKED) | Ghi chú |
|----|------|-----------------------------|---------|
| G1 | 1 | | |
| G2 | 1 | | |
| G3 | 1 | | |
| G4+G6 | 1 | | machine / order / attempt ids |
| G5 | 1 | | |
| G7 | 2 | | revision sau B vs C |

---

## Quyết định

| Kết quả | Hành động |
|---------|-----------|
| **G1–G6 PASS** | Architecture v2 continuity **đã chứng minh** trên GPU thật → được mở **A0.5** |
| **Một bài Gate 1 FAIL** | Sửa sync/session/destroy/failover; **không** mở A0.5/A1 |
| **G7 FAIL** | Không chặn A0.5; **chặn Go-Live** lâu dài đến khi sửa revision/SoT |
| **BLOCKED** | Ghi blocker; không đánh PASS |

**A0.5** sau Gate 1 chỉ còn hỏi: *đưa Comfy Editor lên CP mà vẫn tương thích Runtime được không?* — không còn là bài toán giữ dữ liệu.
