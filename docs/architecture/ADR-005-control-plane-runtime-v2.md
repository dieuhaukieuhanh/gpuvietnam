# ADR-005 — Control Plane / Runtime Architecture v2.0

| | |
|---|---|
| **Status** | Accepted (Frozen) |
| **Date** | 2026-07-21 |
| **Freeze document** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) |
| **Supersedes** | Informal Architecture Proposal v1.0 (discussion only) |

---

## Problem

GPUVietnam historically couples user work closely to a **single rented GPU running ComfyUI** (open UI / proxy to one upstream). Decentralized marketplace GPUs are unreliable. The product needs:

- User **Session / Project / Workflow** to survive GPU loss.  
- ComfyUI to remain the **execution engine**, not the system of record.  
- Failover and optional dual-run without pretending CUDA/queue can be resumed mid-job.

ComfyUI investigation (#001–#006) showed: HTTP/WS APIs are proxyable; execution, validation, queue, CUDA/VRAM, and filesystem I/O remain inside the Runtime process; history/queue do not survive process death; ephemeral create→execute→destroy is feasible for API-driven jobs (verified on CPU for a core workflow).

---

## Decision

Adopt and **freeze** Architecture v2.0:

1. **Control Plane** = SoT for User, Session, Project, Workflow, Assets (durable), Billing, Runtime Registry, **Job**, **Attempt**.  
2. **ComfyUI** = Runtime Engine only (execute, queue, CUDA, VRAM, model load).  
3. **GPU** = disposable compute.  
4. **Runtime Port** + **Comfy Adapter** = firewall; Control Plane does not call ComfyUI APIs directly.  
5. **Provider Adapter** = infrastructure isolation (Vast/Clore/…).  
6. **Session Restore ≠ Job Resume**; failed Attempt → new Attempt.  
7. **Runtime Policy** (Warm / Standby / Ephemeral / Dual-run) does not change layering.  
8. **Image / node / model parity** required for any Attempt.

Full normative text: [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md).

---

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Keep Session SoT on the ComfyUI machine | Violates marketplace reliability goals; process death loses history/queue (#004/#006) |
| Replace ComfyUI execution with Middleware-only | Blocked: Python graph, validate_prompt, CUDA/VRAM in-process (#005) |
| Transparent mid-job CUDA resume on another GPU | Not supported by ComfyUI process model (#006) |
| Treat dual-run as a separate architecture | Unnecessary; it is Job → two Attempts (policy) |

---

## Consequences

### Positive

- Clear freeze gate for implementation.  
- Aligns product failover / “render an toàn” with technical reality.  
- Upstream Comfy churn is absorbed primarily in the Comfy Adapter.

### Trade-offs / constraints

- In-flight Attempt is lost on GPU death; must re-run or dual-run.  
- Durable storage for inputs/outputs/models must exist outside the GPU disk.  
- Multi-engine Runtimes (Fooocus, vLLM, …) require **new adapters**, not zero-touch Control Plane changes.  
- Provider switches may still need billing/routing configuration (does not violate layering).

### Rollback

- Product code can remain on tag `checkpoint/pre-cp-runtime-split` until B1 lands.  
- Reverting this ADR requires a new ADR with technical evidence; do not silently weaken the freeze.

---

## Implementation note

Post-freeze delivery order (non-normative): B1 Job/Attempt + Comfy Adapter → B2 Session continuity UX → B3 Dual-run policy → hardening.

Related code checkpoint: `checkpoint/pre-cp-runtime-split`.
