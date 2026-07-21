# Gate 1 (P0) — Test status

| | |
|---|---|
| **Date** | 2026-07-21 |
| **Branch** | `feat/cp-runtime-b1` (`bbce550`+) |
| **Gates doc** | [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md) |

---

## Agent đã chạy (auto — fake Comfy / unit)

```bash
node --test src/lib/cp-runtime/*.test.mjs src/lib/gpu/exclude-host-keys.test.mjs
# → 41/41 PASS (2026-07-21)
```

| Gate 1 ID | Auto coverage | Kết quả auto | Cần GPU thật? |
|-----------|---------------|--------------|---------------|
| **T2** Generate | `comfy-adapter` smoke e2e via Port | ✅ PASS (fake) | **Có** — chứng minh trên GPU thật |
| **T3** Destroy + data còn | `provider-runtime-bind` destroy; storage-paths Plane B | ✅ Partial | **Có** — project/history UI + R2/DB |
| **T4** Session Restore | `b2-session` + `b2-workflow-snapshot` | ✅ PASS (logic/mock DB) | **Có** — UI destroy → mở lại |
| **T6** GPU chết trước Generate | Failover paths / re-provision patterns | ⚠️ Indirect | **Có** |
| **T7** GPU chết giữa Generate | `failover.test` A die → Attempt 2 | ✅ PASS (fake) | **Có** — kill máy thật giữa job |
| **T8** Dual-run 2 host + same line | `dual-run` + capacity + exclude host | ✅ PASS (fake) | **Có** — rent 2 host marketplace |
| **T9** Winner / cancel loser | dual-run B wins when A slow | ✅ PASS (fake) | **Có** |
| **T10** Một GPU chết vẫn có kết quả | Policy + orchestrator (partial) | ⚠️ Partial auto | **Có** — kill 1 nhánh khi dual-run |
| **T17/T18** Parity chặn | image-spec + adapter parity mismatch | ✅ PASS (unit) | **Nên** spot-check 1 lần trên create thật |
| **T19** SDXL/LoRA smoke | — | ❌ Chưa | **Có — bắt buộc bạn làm** |
| **A1** CP không gọi Comfy trực tiếp | Chỉ `comfy-adapter` import ComfyClient; failover/dual-run/API cp không | ✅ Review PASS | Spot-check OK |
| **A2–A6** Session/Project/Assets/Billing/History | B2 tests + storage + design | ✅ Logic PASS | **Có** — verify UI/DB sau destroy |
| **A7** Provider đổi ≠ đổi CP | Port/Adapter layering | ✅ Review PASS | Optional T13/T14 ở Gate 2 |
| **A8** Dual-run = policy | ADR-006 + dual-run module | ✅ Review PASS | Covered by T8–T10 thật |

**Tóm tắt auto:** Implementation Complete đã chứng minh trên fake. **Gate 1 chưa Production Proven** cho đến khi bạn chạy cột “Cần GPU thật”.

---

## Việc BẠN cần làm (Gate 1 — GPU thật)

### Chuẩn bị (một lần)

1. **Apply migrations** `0043`–`0047` lên Supabase **staging/dev** (không prod nếu chưa sẵn sàng).
2. Deploy hoặc chạy local nhánh `feat/cp-runtime-b1` với `VAST_AI_KEY` / `CLORE_API_KEY` và storage Plane B (R2) như môi trường hiện tại.
3. Tài khoản **Pro hoặc Studio** còn giờ; marketplace có **≥ 2 host** cùng loại GPU gói (4090 / 5090).

### Checklist tay (tick khi PASS)

```text
☐ T2  Start máy → generate 1 ảnh workflow đơn giản → thấy output; Job/Attempt trên dashboard (nếu đã wire UI)
☐ T3  Stop/destroy máy → file output + project/workflow vẫn còn; lịch sử Job còn
☐ T4  Destroy → start máy mới → mở lại project/workflow đã soạn (không mất bài); không kỳ vọng resume CUDA giữa job
☐ T6  Start máy → destroy ngay → bấm generate/start lại → máy mới lên, session không vỡ
☐ T7  Đang generate → kill/destroy máy giữa chừng → hệ thống Attempt mới / start lại → có output; không “tiếp tục CUDA”
☐ T8  Bật Render an toàn → 2 GPU cùng line gói, khác host (kiểm tra host_id / máy khác nhau)
☐ T9  Dual-run: máy nhanh hơn xong trước → output đó được giữ; máy kia bị hủy
☐ T10 Dual-run: cố ý destroy 1 GPU đang chạy → GPU còn lại vẫn ra output
☐ T18 (hoặc T17)  Thử image/spec lệch (nếu có cách admin/test) → bị chặn, không submit mù
☐ T19 Generate SDXL + LoRA trên GPU thật, kết quả ổn
☐ A2–A6  Sau các bước trên: Session / Project / Assets / Billing ledger / History không mất vì destroy Runtime
```

### Không cần bạn làm lúc này (Gate 2+)

- T12 billing dual-run SCB settle  
- T20 video, T13/T14 riêng, Warm/Ephemeral, stress  

---

## Cách báo kết quả

Với mỗi ID: **PASS / FAIL / BLOCKED** + 1 dòng ghi chú (request id / machine id / screenshot nếu FAIL).

Khi Gate 1 GPU thật PASS hết → đủ điều kiện **merge** theo [E2E_TEST_GATES_V2.md](./E2E_TEST_GATES_V2.md).
