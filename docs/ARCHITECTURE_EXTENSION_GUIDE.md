# Architecture Extension Guide

> Hướng dẫn mở rộng **sau Architecture 2.0 Final** (SCB M1–M14).  
> Đọc cùng [ARCHITECTURE_LOCK.md](./ARCHITECTURE_LOCK.md) và [EXTENSION_POINTS.md](./EXTENSION_POINTS.md).

**Quy tắc chung:** Mở rộng qua **adapter / port / detection** — không sửa Core Domain trừ bug fix hoặc Architecture Review.

---

## 1. Thêm GPU Provider mới

### Mục tiêu

Hỗ trợ marketplace GPU thứ hai (RunPod, Akash, …) mà **không** thay đổi Session Lifecycle, Settlement, hoặc Remaining.

### Được phép sửa / thêm

| Layer | Vị trí | Việc làm |
|-------|--------|----------|
| Provider adapter | `src/lib/gpu/providers/<name>/` | Implement `GPUProvider` interface |
| Service wiring | `src/lib/gpu/gpu-service.js`, `getGpuService()` | Chọn provider theo config/feature flag |
| Provision | `src/lib/gpu/provision-instance.js` | Map offer → instance (nếu khác Vast) |

### Contract (Provider Port)

Provider adapter phải implement:

- `provisionInstance` / rent flow
- `getInstanceStatus` → normalized status codes
- `destroyInstance`
- Optional: `healthCheck` cho ComfyUI/runtime endpoint

Provider Verify (M4) đọc trạng thái qua `createProviderVerifyPortFromGpuService()` — **không** verify logic trong adapter.

### Không được sửa

| Module | Lý do |
|--------|-------|
| `session-lifecycle.js` | Session SoT |
| `settlement.js` | Settlement SoT |
| `remaining-time.js` | Remaining SoT |
| `destroy-pipeline-run.js` | Pipeline order frozen |

### Luồng tham chiếu

```
API start-machine
  → session-start.js (M3 + M4)
  → GPUService → [New Provider Adapter]
  → provider-verify.js (gate RUNNING)
```

Destroy luôn qua `runDestroyPipeline` (M7) — adapter chỉ thực thi provider destroy API.

### Checklist

- [ ] Adapter implements `GPUProvider` interface
- [ ] Status codes map qua `normalizeGpuStatusCode()` (M4)
- [ ] Không import `settlement.js` / `remaining-time.js` từ adapter
- [ ] Integration test: provision → verify running → destroy pipeline

---

## 2. Thêm Payment Gateway mới

### Mục tiêu

Nạp ví / xác nhận Order qua gateway mới (PayOS, Stripe, VietQR, …) **không** sửa Settlement Engine.

### Được phép sửa / thêm

| Layer | Vị trí | Việc làm |
|-------|--------|----------|
| Payment adapter | `src/lib/payment/` hoặc `src/pages/api/webhooks/<gateway>.js` | Webhook verify, idempotent state update |
| Order / deposit flow | API routes hiện có (wallet deposit, plan renew) | Gọi adapter; map kết quả → DB |

### Payment vs Settlement

| | Payment Gateway | Settlement (M6) |
|---|-----------------|-----------------|
| Khi nào | User mua gói, nạp ví | Session **closed** + verify DESTROYED |
| Ghi gì | `wallet_balance`, Order status, inventory grant | `hours_used`, wallet charge theo allocation |
| Core module | Adapter + admin approve paths | `settlement.js` only |

Payment **tăng entitlement** (inventory, wallet). Settlement **tiêu thụ entitlement** khi phiên kết thúc.

### Không được sửa

- `settlement.js`, `settlement-core.js` — allocation order frozen
- `session-lifecycle.js` — không gắn payment vào session transitions

### Checklist

- [ ] Webhook idempotent (duplicate callback safe)
- [ ] Không gọi `settleSession` từ payment webhook
- [ ] Admin/manual path vẫn hoạt động song song

---

## 3. Thêm Entitlement Type mới

### Mục tiêu

Loại entitlement mới (ví dụ: promo bucket, enterprise grant) tham gia consumption khi session settle.

### Điểm mở rộng duy nhất

**Settlement allocation** trong `settlement-core.js` / `settlement.js`:

- `orderPlansForSettlement()` — thứ tự consumption (ADR-002, SCB §6)
- `allocateSettlementCharge()` — map charge → inventory rows
- `buildSettlementBreakdown()` — audit JSON shape

### Quy trình

1. Thêm column/type trên `user_plan_inventory` (schema migration + Architecture Review nếu ảnh hưởng SoT).
2. Mở rộng `compareSettlementPlanPriority` / tier — **một chỗ** trong settlement-core.
3. Cập nhật `remaining-time.js` **chỉ** nếu entitlement mới tham gia **cùng công thức** Remaining (đọc inventory) — cần Architecture Review.
4. Test: allocation order + idempotent settle + remaining consistency.

### Không được

- Duplicate settlement trong API route
- Frontend tự trừ entitlement
- Reconciliation gọi settlement cho drift repair (trừ delegate M6 `settleSession` khi session đã closed + verified — xem M13)

### Checklist

- [ ] Single allocation path trong M6
- [ ] `settlement_breakdown` JSON ghi rõ nguồn mới
- [ ] M2 `calculateRemaining` đọc cùng inventory rules

---

## 4. Thêm Reconciliation Detector mới

### Mục tiêu

Phát hiện drift mới (ví dụ: pending timeout) mà **không** thêm settlement/remaining logic.

### Kiến trúc (M13)

```
reconciliation-core.js     ← Detection only (pure)
        ↓
reconciliation.js          ← repairDriftItem() routes
        ↓
M3 / M4 / M6 / M7          ← Existing domains
```

### Thêm detector

1. **Detection:** Thêm hàm pure trong `src/lib/infrastructure/reconciliation-core.js`:
   - `detect<Name>Drift(session, machine, providerSnapshot, …)`
   - Trả về `buildDriftDescriptor(DRIFT_TYPE.*, …)` hoặc `null`
2. **Register:** Gọi từ `detectSessionDrifts` / `detectMachineDrifts` / `detectSettlementDrifts` (detection-only).
3. **Repair:** Thêm case trong `repairDriftItem()` — **chỉ delegate**:
   - Session → `interruptSession` / `closeSession` (M3)
   - Verify → `verifyProviderState` / pipeline verify (M4/M7)
   - Settlement retry → `settleSession` (M6) khi đủ điều kiện eligibility
   - Operator-only → `REPAIR_OUTCOME.SKIPPED`
4. **Test:** `reconciliation.test.mjs` — detection + idempotent repair + no double settle.

### Không được

- Tính `billableSeconds` trong reconciliation
- Gọi `calculateRemaining`
- Implement settlement allocation trong reconciliation
- Provider destroy trực tiếp (bypass M7)

### Observability

- Persist qua `reconciliation-persist.js` → `drift_items`
- Admin: `AdminReconciliationPanel` — chỉ gọi API, không logic mới

---

## 5. Thêm Frontend Feature mới

### Nguyên tắc

```
UI (React)
  ↓ fetch
API route (orchestration + mapping)
  ↓ call
Core Domain (M2–M7, M13)
```

View model (nếu cần): **API → display only** — pattern từ M11/M12 (`scb-ui-view-model.js`, `scb-session-history-view-model.js`).

### Được phép trong UI

- Hiển thị field từ API (`remainingHours`, `settlementStatus`, `billableLabel`, …)
- Poll/refresh API (không client elapsed billing timer)
- Admin scan/repair qua `/api/admin/infrastructure/reconcile`

### Cấm trong UI

| Cấm | Thay bằng |
|-----|-----------|
| `hours_total - hours_used` | `remainingHours` từ API |
| Client `billableSeconds` math | `billableSeconds` / `durationLabel` từ API |
| Infer `settlementStatus` từ `session.status` | Field từ API |
| localStorage billing SoT | API poll (M11) |

### Checklist feature mới

- [ ] API trả đủ field; không tính domain trên client
- [ ] View model chỉ map + format label
- [ ] Grep regression test (pattern `scb-ui-m11.test.mjs`, `scb-m14.test.mjs`)
- [ ] Không import `settlement.js` / `remaining-time.js` trong components

---

## Quick Reference — Core Domain Paths

| Domain | Path |
|--------|------|
| Remaining | `src/lib/gpu/remaining-time.js` |
| Session Lifecycle | `src/lib/gpu/session-lifecycle.js` |
| Provider Verify | `src/lib/gpu/provider-verify.js` |
| Settlement | `src/lib/gpu/settlement.js` |
| Destroy Pipeline | `src/lib/destroy-pipeline-run.js` |
| Reconciliation | `src/lib/infrastructure/reconciliation.js` |
| Reconciliation detection | `src/lib/infrastructure/reconciliation-core.js` |

---

## Khi nào cần Architecture Review?

Xem [ARCHITECTURE_LOCK.md](./ARCHITECTURE_LOCK.md#change-policy). Mở rộng qua extension guide **không** thay thế review khi thay đổi công thức, state machine, hoặc SoT.

**Tài liệu liên quan:** [EXTENSION_POINTS.md](./EXTENSION_POINTS.md) · [CODING_RULES.md](./CODING_RULES.md) §4, §11, §14
