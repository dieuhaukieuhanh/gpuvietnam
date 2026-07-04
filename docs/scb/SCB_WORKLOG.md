# SCB_WORKLOG.md

Version: 1.0

Status: Active

Last Updated: 2026-07-04

---

# Purpose

Tài liệu này ghi lại tiến độ thực tế của dự án SCB.

Đây là tài liệu đầu tiên cần đọc trước khi tiếp tục phát triển.

Nếu nội dung trong Worklog khác với suy đoán của AI hoặc lập trình viên, Worklog được ưu tiên.

---

# Current Project Status

Project

GPUVIETNAM

Architecture

SCB Architecture 2.0

Development Mode

Controlled Rebuild

Current Phase

✅ Phase 1 – Database (Completed)
✅ M2 – Database Rebuild (SCB 3.0 additive) (Completed)

Next Phase

M3 – Session Domain Rewrite

---

# Current Focus

Mục tiêu hiện tại:

Loại bỏ hoàn toàn legacy Session/Billing lifecycle.

Giữ nguyên toàn bộ UI và API contract.

Xây dựng lại orchestration theo SCB.

---

# Progress Overview

| Phase | Name | Status |
|--------|------|--------|
| Phase 0 | Freeze | ✅ Completed |
| Phase 1 | Database (SCB 2.0) | ✅ Completed |
| M1 | Project Cleanup (Audit) | ✅ Completed |
| M2 | Database Rebuild (SCB 3.0 additive) | ✅ Completed |
| M3 | Session Domain Rewrite | ⏳ Next |
| M4 | Billing Domain Rewrite | ⏳ Pending |
| M5 | Provider Verify | ⏳ Pending |
| M6 | Session Start | ⏳ Pending |
| M7 | Session Stop / Destroy Pipeline | ⏳ Pending |
| M8 | API Simplification | ⏳ Pending |
| M9 | Projection | ⏳ Pending |
| M10 | Recovery | ⏳ Pending |
| M11 | Cleanup | ⏳ Pending |
| M12 | Testing | ⏳ Pending |
| M13 | Production Hardening | ⏳ Pending |

---

# Completed Work

## Database

Completed

- started_at nullable
- running requires started_at
- closed requires started_at

Added

- gpu_sessions_running_requires_started_at
- gpu_sessions_closed_requires_started_at

Verified

- migration applied
- nullable verified
- constraints verified

---

# Known Issues

Legacy constraint

gpu_sessions_status_check

Current values

- running
- completed
- interrupted

Missing

- pending
- closing
- closed

Impact

Cannot create pending session.

Priority

Critical

Status

Needs migration.

---

# Current Blocking Issues

Issue

gpu_sessions_status_check rejects pending.

Current Error

new row violates check constraint
gpu_sessions_status_check

Root Cause

Database still follows legacy state model.

Resolution

Create migration to replace status CHECK.

Status

Not Started

Priority

Highest

---

# Active Decisions

Current rebuild strategy

Rebuild from SCB.

Do not patch legacy.

Keep UI.

Keep API contract.

Replace lifecycle only.

---

# Files Currently Allowed To Modify

Database

- supabase/migrations/**

Domain

- session-lifecycle.js

Billing

- billing.js

Provider

- provider-verify.js

Orchestrator

- session-start.js
- destroy-pipeline.js

API

- app/api/**

---

# Files Protected

Do not modify unless required

UI

React components

Tailwind

Customer pages

Authentication

Inventory

Pricing

---

# Current Milestone

Milestone

SCB Core Rebuild

Completion Target

All Session lifecycle rewritten.

---

# Immediate Next Tasks

Priority 1

M3 — Rewrite Session Domain (session-lifecycle.js) to pending -> running -> closed only.

Priority 2

M3 — Narrow gpu_sessions.status CHECK to ('pending','running','closed') after Session/Billing rewrite completes.

Priority 3

M4 — Rewrite Billing Domain (billing.js) to read only gpu_sessions.started_at.

---

# Regression Checklist

Pending session can be created

☐

Running session activates correctly

☐

Destroy works

☐

Browser refresh safe

☐

Server restart safe

☐

Projection rebuild safe

☐

Double-click Start safe

☐

No duplicate session

☐

No duplicate billing

☐

---

# Current Technical Debt

Legacy status constraint

High

Legacy session flow

High

Legacy recovery

Medium

Temporary debug logs

Low

---

# Notes For Cursor

Before modifying code:

Read

1. README.md

2. SCB_ARCHITECTURE.md

3. SCB_IMPLEMENTATION_ROADMAP.md

4. SCB_WORKLOG.md

Follow SCB Architecture.

Do not introduce temporary fixes.

Prefer rebuild over patch.

If unsure,

stop and document the issue instead of creating another workaround.

---

# Definition of Ready

Next phase can begin when

- pending status accepted by database
- database matches SCB
- no schema blockers remain

---

# Definition of Done

Project is complete when

- Legacy lifecycle removed
- Billing unified
- Session lifecycle unified
- Projection disposable
- Recovery simplified
- All regression tests pass
- Production ready