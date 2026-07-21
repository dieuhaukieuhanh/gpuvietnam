# B3 — Dual-run / Render an toàn

| | |
|---|---|
| **ADR** | [ADR-006-dual-run-policy.md](./ADR-006-dual-run-policy.md) |
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §3.x |
| **Migration** | `supabase/cp-runtime-v2-dual-run.sql` (**0047**) |
| **Product** | [GPUVietnam_TinhNang_RenderAnToan.md](../GPUVietnam_TinhNang_RenderAnToan.md) |

---

## Goal

Dual-run là **Runtime Policy**: một Job → Attempt A + Attempt B song song trên hai GPU.  
Winner = Attempt có output bền (Plane B) trước; loser bị hủy.

---

## Deliverables

| Step | Artifact |
|------|----------|
| **3.1** | ADR-006 + `dual-run-policy.js` + `/api/cp/dual-run` |
| **3.2** | `runJobWithDualRun` + `selectDualRunWinner` + abort sibling |
| **3.3** | Billing estimate (cap 1.9×) + `DualRunSafetyCard` UX |

---

## Flow

```text
eligibility (plan Pro/Studio + ≥2 hosts)
    │
    ├─ no  → single Attempt (fallback)
    └─ yes → Promise.all(Attempt A, Attempt B)
                │
                ├─ first durable success → winner
                └─ shouldAbort() → cancel loser Runtime
```

---

## Billing (app layer, not SCB core)

- Customer band ~1.5–1.8×; **hard cap 1.9×** single equivalent.  
- Loser billed only until cancel.  
- No dual surcharge if eligibility fails (single fallback).

---

## Tests

```bash
node --test src/lib/cp-runtime/dual-run.test.mjs
```
