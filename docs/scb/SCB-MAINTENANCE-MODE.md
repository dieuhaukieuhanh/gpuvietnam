# SCB Maintenance Mode — Product Development

| | |
|---|---|
| **Status** | **Active — Official** |
| **Effective** | 2026-07-05 |
| **Architecture** | SCB 2.1 complete — [Architecture Freeze v2](./ARCHITECTURE-FREEZE-v2.md) approved |
| **Role** | Product Engineer (not Architecture Engineer) |

---

## Milestone Declaration

**SCB Architecture is officially complete.**

Architecture Freeze v2 is the **permanent foundation** of GPUVietnam. The project enters **Maintenance Mode** for SCB and **Product Development Mode** for all new work.

Architecture reopens **only** when the owner requests a **new ADR**.

---

## Frozen — Do Not Change

Without a new approved ADR or explicit production bug fix in frozen scope:

| Component |
|-----------|
| SCB Core |
| Destroy Pipeline |
| Queue |
| Scheduler |
| Worker |
| Projection (model + read path v2) |
| Billing Lifecycle |
| Provider Abstraction |

**Do not propose architecture refactors.** Do not change frozen components “while we’re here.”

---

## Allowed Without ADR

| Type | Examples |
|------|----------|
| **Production bug fix** | Incorrect behavior in frozen code; minimal diff; same semantics |
| **Product / UI** | Dashboard, workspace, wallet UX, customer features |
| **Provider integration** | New adapter implementing existing `ProviderAdapter` + contract tests |
| **Performance** | Query tuning, caching — no semantic change to frozen layers |
| **Documentation** | Runbooks, product docs |
| **Observability (additive)** | Logs, metrics, admin read APIs |

---

## New Task Workflow

### Step 1 — Architecture impact?

**Does this task touch or change frozen components, invariants, or call graphs?**

| Answer | Action |
|--------|--------|
| **NO** | Implement directly. Ship feature. |
| **YES** | **Stop.** Propose ADR. Wait for approval. Do not refactor on your own. |

### Step 2 — Reuse before invent

Default stack:

1. Queue  
2. Scheduler  
3. Worker  
4. Projection (`resolveProjectionMachineStatus`, verification via `projection_verify`)  
5. Provider Interface / Registry  

**Do not create new abstractions** if the existing layer already solves the problem.

---

## Product Development Priorities

All new tasks prioritize (in order):

1. UI / UX  
2. Dashboard  
3. Workspace  
4. Provisioning Experience  
5. Provider Integration  
6. Billing Experience  
7. Performance  
8. Customer Features  

Not: architecture optimization, structural refactors, or “clean up” without product value.

---

## Coding Defaults

- **Ship fast** — smallest change that works  
- **Minimal diff** — fewest files, fewest lines  
- **Simplest solution** — no extra layers  
- **Least regression** — reuse frozen paths  
- **No cosmetic refactors** — do not “make code prettier” without a product reason  

---

## Feature Flags (production)

| Flag | Purpose |
|------|---------|
| `SCB_READ_PROJECTION_FIRST` unset or `1` | **Projection-first read path (default)** |
| `SCB_READ_PROJECTION_FIRST=0` | Legacy ADR-001 rollback only |
| `SCB21_READ_PATH_DETECT_ONLY=0` | Legacy inline repair on read path |

---

## Approved ADRs (closed set)

| ADR | Title |
|-----|-------|
| [ADR-001](./ADR-001-read-path-detect-only.md) | Read Path Detect Only |
| [ADR-002](./ADR-002-provider-abstraction-layer.md) | Provider Abstraction Layer |
| [ADR-003](./ADR-003-projection-first-read-path.md) | Projection-first Read Path |
| [ADR-004](./ADR-004-scb4-product-exceptions.md) | SCB 4.0 Product-Layer Exceptions |

New architecture → **ADR-005+** only with owner approval.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE-FREEZE-v2.md](./ARCHITECTURE-FREEZE-v2.md) | Frozen components, invariants, call graphs |
| [SCB-ARCHITECTURE.md](./SCB-ARCHITECTURE.md) | Authoritative SCB spec |
| [ARCHITECTURE-FREEZE.md](./ARCHITECTURE-FREEZE.md) | Freeze index |

---

*SCB Maintenance Mode — GPUVietnam official operating mode from 2026-07-05*
