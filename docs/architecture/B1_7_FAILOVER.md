# B1.7 — Failover (Attempt mới, không resume CUDA)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.7 |
| **Depends** | [B1_6_PROVIDER_ATTEMPT.md](./B1_6_PROVIDER_ATTEMPT.md) · [RuntimePort.md](./RuntimePort.md) |
| **Code** | `src/lib/cp-runtime/failover.js` |
| **Architecture** | Session Restore ≠ Job Resume · Attempt FAIL → Attempt N+1 |

---

## Purpose

Khi Runtime/GPU chết giữa chừng:

1. Đánh Attempt hiện tại **`failed`** (không resume CUDA / queue Comfy).  
2. `destroy` Runtime A (release compute).  
3. Tạo **Attempt 2** trên máy B (Provider mới).  
4. **Chạy lại** cùng `workflowSnapshot` + input refs kho bền.  
5. Job hoàn thành nếu Attempt mới succeed.

**Xong khi:** Job xong trên máy B sau khi A chết (re-run).

---

## Flow

```text
Job (same workflow_snapshot + Plane B inputs)
 │
 ├─ Attempt 1 → Runtime A / GPU A
 │     monitor → lost | failed | timeout
 │     → Attempt 1 = failed
 │     → destroy Runtime A
 │
 └─ Attempt 2 → Runtime B / GPU B  (new createInstance)
       submit → monitor → fetch → destroy
       → Job outputs on Plane B
```

Không có: mid-job tensor migrate, resume `/queue`, reuse `prompt_id` của máy A.

---

## API

```js
import { runJobWithFailover, isFailoverRetryable } from '@/lib/cp-runtime/failover';

const result = await runJobWithFailover(bundle, {
  userId,
  jobId,
  requiredImageSpecRef: 'gpuvietnam.comfy.v3@1.0',
  gpuLine: 'rtx4090_1x',
  workflowSnapshot,
  maxAttempts: 2,       // default 2
  timeoutMs: 120_000,
});
// result.failoverUsed === true nếu Attempt > 1 thắng
```

### Retryable Port codes

`EXECUTION_LOST` · `EXECUTION_FAILED` · `TIMEOUT` · `UNAVAILABLE` · `RUNTIME_NOT_READY` · `FETCH_FAILED` · `DESTROY_FAILED`

**Không** failover: `PARITY_FAILED` · `INVALID_ARGUMENT` · `SUBMIT_REJECTED` (lỗi graph/config).

---

## Runbook (ops)

### Triệu chứng

- Attempt `running` rồi `failed` với `EXECUTION_LOST` / endpoint chết.  
- Registry Runtime A → `destroyed` / `error`.  
- Attempt 2 `provisioning` → `running` trên `instanceId` khác.

### Kiểm tra nhanh

1. Cùng `job_id`, hai `attempt_number` (1 failed, 2 succeeded).  
2. `runtime_id` / provider `instance_id` **khác nhau** giữa hai Attempt.  
3. Output Plane B dưới `…/attempts/2/outputs/…` (không phụ thuộc disk máy A).  
4. Log: không có resume `prompt_id` từ Attempt 1.

### Thao tác tay (nếu auto failover chưa bật trên path prod)

1. Xác nhận Attempt 1 failed + máy A đã destroy (tránh orphan).  
2. Submit lại Job (Attempt mới) — cùng workflow snapshot.  
3. Không SSH “tiếp tục” queue Comfy trên máy chết.

### Test tự động

```bash
node --test src/lib/cp-runtime/failover.test.mjs
```

Kịch bản: máy A chết sau submit → Attempt 2 trên máy B → output bền.

---

## Out of scope

- Dual-run song song (B3 — policy, không phải failover tuần tự)  
- Dashboard UI → [B1_8_DASHBOARD_JOBS.md](./B1_8_DASHBOARD_JOBS.md)  
- Auto health watcher daemon (B4 §4.3) — orchestrator sẵn dùng khi wire
