# 06-CURSOR-WORKFLOW.md

Version: 1.0

Status: Mandatory

Applies To:

- Cursor
- Claude Code
- OpenAI Codex
- Any Coding Agent

---

# Purpose

Tài liệu này quy định cách AI Coding Agent phải làm việc trong dự án.

Đây là quy trình bắt buộc.

Không được bỏ qua.

---

# Golden Rule

Không được sửa code để "fix bug".

Phải sửa theo kiến trúc.

Nếu kiến trúc sai

→ Rewrite.

Không Patch.

Không Workaround.

---

# Kiến trúc ưu tiên

Thứ tự ưu tiên tuyệt đối:

1. SCB Architecture
2. Domain Rules
3. Database
4. Runtime
5. API
6. UI

Nếu UI mâu thuẫn với SCB

→ sửa UI.

Không sửa SCB.

---

# Một Task

Một Task chỉ được có:

Một mục tiêu.

Ví dụ:

✓ Rebuild Session Runtime

✓ Rebuild Destroy Pipeline

✓ Rebuild Status API

Không:

✗ Rebuild Billing + UI + API cùng lúc.

---

# Trước khi sửa code

Cursor phải trả lời:

## Objective

Mục tiêu là gì.

## Files

File nào sẽ sửa.

## Risk

Có ảnh hưởng phần nào.

## Why

Vì sao phải sửa.

Chỉ sau đó mới được viết code.

---

# Khi sửa

Không được:

- đoán

- tự thêm logic

- thêm shortcut

- tạo compatibility layer

Nếu không chắc

→ hỏi.

---

# Sau khi sửa

Cursor phải báo:

## Changed Files

Danh sách file.

---

## Removed Files

Danh sách file xóa.

---

## New Files

Danh sách file mới.

---

## Public API Changed

Có hay không.

---

## Database Changed

Có hay không.

Migration nào.

---

## Breaking Change

Có hay không.

---

## Compile

PASS / FAIL

---

## Test

PASS / FAIL

---

## Remaining Work

Milestone tiếp theo.

---

# Coding Rules

Một function

→ Một nhiệm vụ.

Function dài

→ Tách.

Magic Number

→ Không.

Hardcode

→ Không.

Copy Paste

→ Không.

---

# Logging

Chỉ log:

ENTER

EXIT

ERROR

VERIFY

Không log spam.

Không log debug tạm.

Log phải có prefix.

Ví dụ

[SCB]

[Provider]

[Settlement]

---

# Error Handling

Không catch rồi bỏ qua.

Không swallow error.

Không return null để che lỗi.

Error phải:

- rõ nguyên nhân

- có context

- có action

---

# Database Rule

Database là Source of Truth.

Projection luôn có thể rebuild.

Không đọc Projection để tính Billing.

---

# Session Rule

Session chỉ có:

Pending

↓

Running

↓

Closed

Không được thêm state mới.

---

# Machine Rule

Machine không chứa Billing Logic.

Machine chỉ là Projection.

---

# Billing Rule

Billing luôn đọc:

gpu_sessions

Không đọc:

machines

Không đọc:

React State

Không đọc:

Memory Cache

---

# Provider Rule

Provider chỉ Verify.

Không Settlement.

Không Billing.

Không Business Logic.

---

# UI Rule

UI chỉ Render.

Không tính Billing.

Không quyết định State.

---

# Testing Rule

Sau mỗi milestone phải test:

✓ Happy Path

✓ Double Click

✓ Refresh

✓ Reconnect

✓ Network Error

✓ Provider Error

✓ Duplicate Request

✓ Retry

Nếu FAIL

→ Không merge.

---

# Commit Rule

Một milestone

↓

Một commit.

Commit message:

M1:

SCB M1 - Project Cleanup

M2:

SCB M2 - Database

M3:

SCB M3 - Session Domain

...

M20:

SCB M20 - Production Hardening

---

# Không được phép

❌ Quick Fix

❌ Temporary Fix

❌ Legacy Compatibility

❌ TODO để sau

❌ FIXME

❌ Dead Code

❌ Duplicate Logic

❌ Hidden State

❌ Side Effect không rõ

---

# Nếu phát hiện code cũ

Cursor phải báo:

Legacy Detected

File:

...

Reason:

...

Recommendation:

Delete

Rewrite

Keep

Không tự giữ lại code legacy nếu chưa có lý do rõ ràng.

---

# Definition of Done

Một milestone chỉ hoàn thành khi:

✓ Compile PASS

✓ Test PASS

✓ Không TODO

✓ Không FIXME

✓ Không Dead Code

✓ Không Legacy Billing

✓ Không Duplicate State

✓ Không Vi phạm SCB

Nếu còn một điều chưa đạt

→ Milestone chưa hoàn thành.

---

# Final Goal

Codebase phải đạt trạng thái:

- Dễ đọc
- Dễ bảo trì
- Dễ mở rộng
- Một nguồn sự thật (Single Source of Truth)
- Không còn logic legacy
- Không còn workaround
- Tuân thủ tuyệt đối SCB Architecture

SCB không chỉ là cách viết code.

SCB là kiến trúc bắt buộc của toàn bộ hệ thống.