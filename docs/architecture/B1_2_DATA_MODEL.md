# B1.2 — Control Plane data model (Job / Attempt / Registry)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.2 |
| **Architecture** | [ARCHITECTURE_V2_FREEZE.md](./ARCHITECTURE_V2_FREEZE.md) |
| **Migration** | `supabase/cp-runtime-v2-foundation.sql` (manifest **0043**) |
| **Branch** | `feat/cp-runtime-b1` |

---

## Purpose

Introduce Control Plane tables so **Session / Project / Workflow / Job / Attempt / Runtime Registry** exist as durable SoT, independent of any single GPU or ComfyUI process.

---

## Entity map

```text
User
  └── cp_sessions          (Architecture Session — NOT gpu_sessions)
        └── projects
              └── workflows
                    └── jobs
                          └── job_attempts ──► runtime_registry ──► machines (optional)
```

| Architecture term | Table | Notes |
|-------------------|-------|--------|
| Session | `cp_sessions` | Work context. Distinct from `gpu_sessions` (SCB billing). |
| Project | `projects` | Survives Runtime replacement. |
| Workflow | `workflows` | Document JSON SoT; Runtime validates a snapshot on Attempt. |
| Job | `jobs` | Unit of work; `execution_policy`: `single` \| `dual_run`. |
| Attempt | `job_attempts` | One execution on one Runtime; unique `(job_id, attempt_number)`. |
| Runtime Registry | `runtime_registry` | Disposable endpoint metadata; `runtime_kind` starts as `comfy`. |

---

## Status enums (summary)

| Table | Statuses |
|-------|----------|
| `cp_sessions` | `active`, `paused`, `closed` |
| `projects` | `active`, `archived`, `deleted` |
| `workflows` | `draft`, `ready`, `archived` |
| `jobs` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `job_attempts` | `pending`, `provisioning`, `submitting`, `running`, `succeeded`, `failed`, `cancelled` |
| `runtime_registry` | `pending`, `provisioning`, `starting`, `ready`, `busy`, `unhealthy`, `stopping`, `destroyed`, `error` |

---

## Invariants (v2.0)

1. Destroying `runtime_registry` / machine **must not** cascade-delete Project, Workflow, or Job history (`ON DELETE SET NULL` where linked).  
2. GPU death ⇒ mark Attempt `failed` ⇒ create new Attempt (no CUDA/queue resume).  
3. `jobs.workflow_snapshot` holds the document used for execution; editor may keep evolving `workflows.document`.  
4. `image_spec_ref` on Runtime/Attempt is a forward reference for **B1.3.5 Runtime Image Spec** (parity).  
5. Control Plane APIs will use **service_role**; RLS policies match existing token tables.

---

## Out of scope for 1.2

- Runtime Port / Comfy Adapter code (1.4–1.5)  
- Persistent object-storage paths detail → [B1_3_STORAGE_SPEC.md](./B1_3_STORAGE_SPEC.md)  
- Full Runtime Image Spec document (1.3.5)  
- Applying migration to production (ops; run `scripts/run-migrations.mjs` when ready)

---

## Apply locally

```bash
node scripts/run-migrations.mjs
# or project’s documented migration command
```

Manifest entry: id **0043**, file `supabase/cp-runtime-v2-foundation.sql`, depends on `0001` (users), `0019` (machines), `0021` (gpu_sessions).
