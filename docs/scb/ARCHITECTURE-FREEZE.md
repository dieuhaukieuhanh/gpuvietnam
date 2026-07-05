# Architecture Freeze — Index

| Version | Status | Document |
|---------|--------|----------|
| **v2** | **Approved — SCB complete** | [ARCHITECTURE-FREEZE-v2.md](./ARCHITECTURE-FREEZE-v2.md) |
| v1 | Superseded | [ARCHITECTURE-FREEZE-v1.md](./ARCHITECTURE-FREEZE-v1.md) |

**Operating mode:** [SCB Maintenance Mode — Product Development](./SCB-MAINTENANCE-MODE.md)

---

## Official foundation

Architecture Freeze v2 is the **permanent architecture baseline** of GPUVietnam.

SCB is in **Maintenance Mode**. New work is **Product Development** unless a new ADR is approved.

---

## Production flags

```bash
# Default production architecture (unset or 1 = Projection-first)
SCB_READ_PROJECTION_FIRST=1

# Rollback to Legacy ADR-001 read path only
SCB_READ_PROJECTION_FIRST=0
```

Migration: `supabase/projection-read-path.sql` (0032)

---

## Approved ADRs

ADR-001 · ADR-002 · ADR-003 — see [SCB-MAINTENANCE-MODE.md](./SCB-MAINTENANCE-MODE.md)
