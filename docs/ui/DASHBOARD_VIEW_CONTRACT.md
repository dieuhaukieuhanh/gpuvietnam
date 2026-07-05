# Dashboard UI View Contract

Status: Active  
Architecture: SCB 2.1 + billing anchor at ComfyUI traffic-ready

---

## Sources of truth (UI)

| Concern | Source | Forbidden |
|---------|--------|-----------|
| Lifecycle phase | `machineSessionView.phase` | `subscription.server_status`, `pollStatus` |
| Start / Stop / Cancel / Comfy actions | `machineSessionView.actions.*` | Client inference |
| Status message | `machineSessionView.message` | Ad-hoc `startMessage` synthesis |
| Remaining hours, timer, flags | `billingView.*` | `remaining`, client subtract, `cardPlan` when session active |
| VRAM, GPU, Comfy URL, idle | Infra metrics poll only | Poll must not set phase or billing |
| Profile, plan metadata | `user`, `subscription` | Not for runtime machine state |

---

## Timer rule

```tsx
showTimer = phase === 'running' && billingView.billingStarted === true
anchor    = billingView.sessionDurationSeconds (+ smooth display hooks)
```

`opening` → timer 0. Billing starts only after server sets `started_at` (Comfy traffic-ready).

---

## Refresh pattern

1. `GET /api/dashboard/me` → `machineSessionView` + `billingView`
2. `GET /api/machines/status` → infra metrics only (when phase is active)
3. POST mutations → patch views from response + silent refresh

---

## Poll must not

- Overwrite `billingView` or `machineSessionView`
- Call destroy API
- Derive lifecycle phase from provider status
