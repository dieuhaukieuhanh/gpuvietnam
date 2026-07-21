🛡️ CORE LOGIC — GPUVietnam
1. LUỒNG TẠO MÁY (Start Machine)
File: start-machine.js, vast-client.js, vast-provider.js

Mô tả: KH bấm "Mở máy" → chọn gói active → tìm GPU qua Vast.ai → tạo instance → lưu DB → trả IP/port.

Nguyên tắc:

Không tạo máy nếu KH chưa có gói hoặc hết giờ.

Ưu tiên gói tặng sắp hết hạn → Combo → Giờ lẻ.

Provider routing khi tạo máy: Clore:Vast = 4:1 với failover (`provider-routing.js` + `provision-instance.js`). Chọn offer theo mục 5 (uptime groups + median ±10%, ping ≤250ms, không lọc region).

Retry 2 lần nếu thất bại.

2. ĐẾM GIỜ & TRỪ TIỀN (Billing)
File: billing.js, auto-stop.js

Mô tả: Khi máy running → startBilling() → mỗi phút trừ giờ từ user_plan_inventory hoặc subscriptions.

Nguyên tắc:

Trừ giờ theo thứ tự: gói tặng (sắp hết hạn) → Combo → Giờ lẻ.

Nếu là gói hourly: trừ tiền Ví, ghi wallet_transactions.

KHÔNG trừ giờ khi máy đang starting/creating.

3. TỰ ĐỘNG TẮT MÁY (Auto-Stop)
File: auto-stop.js, check-idle.js

Mô tả: Kiểm tra mỗi 5 phút. Hết giờ **gói đang dùng** → tắt NGAY (giờ ở gói khác không giữ máy). Còn ≤ 30 phút gói đang dùng → thông báo. Idle 1h → cảnh báo 55 phút → tắt.

Nguyên tắc:

Remaining / out-of-credit chỉ tính giờ của gói máy đang chạy (Starter / Pro / Studio) — mỗi gói GPU và bảng giá khác nhau.

Thông báo trước khoảng 30 phút trước khi tắt vì hết giờ gói đang dùng.

Idle timer CHỈ bắt đầu khi không có job nào đang chạy trong ComfyUI.

Có job → reset idle timer.

Backup dữ liệu trước khi tắt (nếu R2 được cấu hình).

4. BACKUP DỮ LIỆU (Backup)
File: machine-backup.js, r2-client.js

Mô tả: Trước khi tắt máy, nén 3 thư mục → upload lên Cloudflare R2.

Nguyên tắc:

Backup outputs, workflows, models (incremental).

Không chặn việc tắt máy nếu backup thất bại.

Ghi log vào backup_logs.

5. PROVISION WORKSTATION (Provider Routing + Offer Selection)
File: provider-routing.js, offer-selection.js, provision-instance.js,
ast-client.js, clore-client.js, gpu-config.js

Mô tả: Level 1 chọn provider (Clore/Vast) → Level 2 lọc + nhóm uptime + chọn 3 offer
rẻ nhất → thuê tuần tự; failover provider nếu cần. Khi cả hai provider thất bại →
**No Available Workstation**.

### Level 1 – Provider Routing

Providers: **Clore.ai**, **Vast.ai**

Tỷ lệ mặc định **Clore : Vast = 4 : 1** (chuỗi xoay: Clore, Clore, Clore, Clore, Vast).

Failover: nếu provider được chọn không có offer khớp / API lỗi / timeout / tạo máy thất
bại → thử ngay provider còn lại. Cả hai unavailable → No Available Workstation.

### Level 2 – Offer Selection (mỗi gói độc lập)

| Package | GPU | Customer Storage | Min Host Disk |
|:---|:---|---:|---:|
| Starter | RTX3090 | 20 GB | 20 GB |
| Pro | RTX4090 (1x) | 50 GB | 50 GB |
| Studio | RTX5090 (1x) | 100 GB | 100 GB |

Customer storage cố định theo gói; host disk chỉ là điều kiện đủ để offer đủ điều kiện.

**Image (ComfyUI):** Starter/Pro (`rtx3090` / `rtx4090_*`) → tag **v3** (CUDA ~12.0, pool host rộng). Studio (`rtx5090_1x`) → tag **v4** (CUDA 12.8). Resolve: `resolveGpuImage(gpuLine)` trong `gpu-config.js`. Rollback một tag: `GPUVIETNAM_COMFYUI_IMAGE_FORCE`. Projection audit: cột `machines.image` (migration `supabase/machines-image.sql`). Official Node Pack SoT: `docs/COMFYUI_IMAGE.md` + `image/official-nodes.lock` (Image v1.0).

Hậu kiểm SQL (admin / ops — **không** expose `machines.image` ra API khách):
```sql
SELECT id, gpu_line, image, provider, status, created_at
FROM machines
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
-- Kỳ vọng: rtx3090/rtx4090_* → :v3 ; rtx5090_1x → :v4
```

**Step 1 – Filter:** GPU đúng gói · VRAM ≥ 20 GB · Host disk ≥ ngưỡng gói · RAM/CUDA
(khi offer báo) · Ping ≤ 250 ms (đo được thì dùng đo; không thì ước lượng) · yêu cầu kỹ
thuật hiện có. **Không** lọc theo quốc gia/region. Studio soft-floor CUDA ≥ 12.0 khi offer báo.

**Step 2 – Uptime groups:** A ≥99% · B 98.5–99% · C 98.0–98.5%. Bỏ offer < 98%.

**Step 3:** Trong mỗi nhóm, sort giá tăng dần, giữ 3 offer rẻ nhất.

**Step 4 – Preferred group:** Representative = median giá.
- Có A và B: nếu Median(A) ≤ Median(B)×1.10 → dùng A; không thì merge A+B, lấy 3 rẻ nhất.
- Không có A, có B và C: nếu Median(B) ≤ Median(C)×1.10 → dùng B; không thì merge B+C.
- Chỉ một nhóm: lấy tối đa 3 offer rẻ nhất của nhóm đó.

**Step 5 – Create:** thử Offer #1 → #2 → #3. Offer đã thuê / validation fail / API /
timeout → offer tiếp theo. Cả 3 fail → refresh marketplace và chạy lại từ Step 1.

6. MÔI TRƯỜNG LÀM VIỆC (Workstation)
File: setup-workstation.sh, workstation-setup.js

Mô tả: Map tên môi trường (Character & Art, Commerce...) → workflow JSON → copy vào thư mục ComfyUI.

Nguyên tắc:

Áp dụng khi tạo máy mới (qua env) hoặc qua SSH khi máy đã chạy.

KHÔNG ghi đè machines.template của phiên hiện tại khi đổi môi trường.

7. PHÂN QUYỀN (Auth)
File: admin-auth.js, user-role.js

Mô tả: Phân biệt Admin (role=admin) và User.

Nguyên tắc:

Admin: vào /admin, duyệt thanh toán, quản lý giá, tắt máy KH.

User: chỉ xem/sửa dữ liệu của mình.

API admin yêu cầu x-admin-secret hoặc role=admin.

8. GIA HẠN TỰ ĐỘNG (Auto-Renew)
File: auto-renew.js, settings.js

Mô tả: Khi giờ còn ≤ ngưỡng (mặc định **10h**, cấu hình 5/10/15/20 trong Cài đặt) → tự động tái tục gói Combo.

Nguyên tắc:

Chỉ áp dụng cho gói Combo (không hourly).

Tái tục chủ động (KH bấm / CK): không thưởng.

Auto-renew khi còn ≥10h: tặng 3% giờ.

Auto-renew khi còn <10h: không thưởng.

Trừ tiền từ Ví, nếu thiếu → gửi thông báo.

9. TẶNG GIỜ (Manual Hour Grants)
File: hour-grants.js, AdminHourGrantsPanel.tsx

Mô tả: Admin tặng giờ cho KH (KOL, VIP, khuyến mãi).

Nguyên tắc:

Chọn KH, chọn gói (Starter/Pro/Studio), nhập số giờ, hạn.

Có thể thu hồi/điều chỉnh (chỉ giờ chưa dùng).

Ghi log mọi thay đổi.

10. VÍ NẠP TRƯỚC (Wallet)
File: wallet/deposit.js, admin/wallet-deposits/approve.js

Mô tả: KH nạp tiền → Admin duyệt → tiền vào Ví.

Nguyên tắc:

KH tự nhập số tiền, tích chọn xác nhận.

Admin duyệt mới cộng tiền.

Tiền KM cũ đã bỏ (không còn % thưởng khi nạp).