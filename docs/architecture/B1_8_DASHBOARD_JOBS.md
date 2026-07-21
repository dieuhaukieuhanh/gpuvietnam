# B1.8 — Dashboard tối thiểu (Job / Attempt)

| | |
|---|---|
| **Roadmap** | [IMPLEMENTATION_ROADMAP_V2.md](./IMPLEMENTATION_ROADMAP_V2.md) §1.8 |
| **API** | `GET /api/dashboard/jobs` |
| **UI** | `DashboardJobsCard` trên `/dashboard` |
| **Code** | `src/lib/cp-runtime/job-attempt-display.js` · `list-user-jobs.js` |

---

## Purpose

User thấy trạng thái Job/Attempt trên dashboard:

| UI | Nghĩa |
|----|--------|
| **Đang chờ** | `queued` |
| **Đang chạy** | Attempt đang chạy (lần 1) |
| **Đang chạy lại** | Attempt #N (N>1) sau failover |
| **Thất bại** | Job/Attempt failed |
| **Thành công** | Job succeeded |

**Xong khi:** User thấy queued / running / failed / retry.

---

## Data

Đọc Supabase `jobs` + `job_attempts` (migration **0043+**).  
Nếu bảng chưa có → card báo “CP chưa sẵn sàng”, không phá dashboard GPU cũ.

Poll 5s khi còn job active (`queued` / `running` / `retry`).

---

## Files

| File | Role |
|------|------|
| `pages/api/dashboard/jobs.js` | Auth + list |
| `components/dashboard/DashboardJobsCard.tsx` | Card UI |
| `DashboardOverview.tsx` | Gắn cạnh phiên gần đây |

---

## Out of scope

- Nút Submit Job từ dashboard (orchestrator wire riêng)  
- History sản phẩm đầy đủ (B2 §2.4)  
- Dual-run UX (B3)
