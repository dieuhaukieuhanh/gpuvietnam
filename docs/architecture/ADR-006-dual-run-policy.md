# ADR-006 — Dual-run (“Render an toàn”) as Runtime Policy

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-21 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) · [ADR-005](./ADR-005-control-plane-runtime-v2.md) |
| **Product note** | [GPUVietnam_TinhNang_RenderAnToan.md](../GPUVietnam_TinhNang_RenderAnToan.md) |
| **Code** | `src/lib/cp-runtime/dual-run-policy.js` · `dual-run.js` |

---

## Context

Customers need lower interruption risk for important renders. ComfyUI cannot resume CUDA mid-job across GPUs. Architecture v2.0 already allows **Job → multiple Attempts**.

## Decision

**Dual-run is a Runtime Policy**, not a new layer:

```text
Job (execution_policy = dual_run)
 ├── Attempt A → Runtime A / GPU A
 └── Attempt B → Runtime B / GPU B   (different provider instance)
```

- Same `workflow_snapshot` submitted to both Attempts.  
- **Winner** = first Attempt that reaches durable outputs (Plane B fetch OK).  
- **Loser** is cancelled/destroyed immediately after winner is declared.  
- No CUDA resume; no shared Comfy process.

## Consequences

### Positive

- Fits freeze principles 6–8 and 10.  
- Reuses Runtime Port / Provider / Storage Spec.  
- One GPU death can still yield a result if the sibling Attempt finishes.

### Trade-offs

- Higher GPU cost while both run.  
- Billing must cap customer charge (see policy module; product ≤ ~1.9× single).  
- Requires capacity for **two distinct hosts**; Attempt B excludes host A (+ bad-host TTL). Otherwise fall back to single.
- Customer price multiplier is Admin-editable (`gpu_pricing_config.dualRun.customerMultiplier`, default 1.65; hard cap default 1.9).

### Non-goals

- Transparent mid-job migrate.  
- Changing Control Plane / Adapter layering.  
- Dual-run as a separate “architecture product”.

## Flags

| Flag / field | Meaning |
|--------------|---------|
| `jobs.execution_policy = 'dual_run'` | Job uses dual-run |
| `jobs.dual_run_group_id` | Correlates Attempt A/B |
| `jobs.winner_attempt_id` | Winning Attempt |
| User preference / plan gate | Who may enable (Pro/Studio by default) |

---

## Related

- Roadmap B3 · [B3_DUAL_RUN.md](./B3_DUAL_RUN.md)
