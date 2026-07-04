🛡️ CORE LOGIC — GPUVietnam
1. LUỒNG TẠO MÁY (Start Machine)
File: start-machine.js, vast-client.js, vast-provider.js

Mô tả: KH bấm "Mở máy" → chọn gói active → tìm GPU qua Vast.ai → tạo instance → lưu DB → trả IP/port.

Nguyên tắc:

Không tạo máy nếu KH chưa có gói hoặc hết giờ.

Ưu tiên gói tặng sắp hết hạn → Combo → Giờ lẻ.

Fallback region khi tạo máy: thử lần lượt Taiwan → Japan → Singapore (`provision-instance.js`). Trong mỗi lần thử, chọn offer theo mục 5 (ưu tiên giá, fallback chỉ mở rộng địa lý).

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

Mô tả: Kiểm tra mỗi 5 phút. Nếu hết giờ → tắt NGAY. Nếu idle 1h → cảnh báo 55 phút → tắt.

Nguyên tắc:

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

5. CHỌN GPU THÔNG MINH (GPU Scoring)
File: vast-client.js (`findBestGPU`, `findRankedGPUOffers`), gpu-config.js

Mô tả: Lọc cứng → chấm điểm (ưu tiên giá) → thuê offer tốt nhất trong giới hạn giá/region.

Nguyên tắc:

**Lọc cứng** (giữ nguyên ở mọi mức fallback):

| Tiêu chí | Ngưỡng |
|:---|:---|
| Verified / rentable | Có |
| VRAM | ≥ 22GB |
| Uptime | ≥ 99.5% |
| Disk | ≥ 20GB |
| Mạng | ≥ 100 Mbps |
| Region | Châu Á (mặc định) |

**Chấm điểm** (hằng số `GPU_SCORE_WEIGHTS` trong gpu-config.js):

| Tiêu chí | Trọng số |
|:---|:---|
| Giá | 60% |
| Region | 15% |
| Mạng | 10% |
| Uptime | 10% |
| DLPerf | 5% |

**Region score** (`GPU_REGION_SCORES`):

| Region | Điểm |
|:---|:---|
| Taiwan | 90 |
| Thailand | 85 |
| Singapore | 80 |
| Hong Kong | 80 |
| Japan | 75 |
| South Korea | 70 |
| Indonesia / Malaysia / India | 65 |
| Khác (Châu Á) | 55 |
| Ngoài Á (global) | 0 |

**Fallback — chỉ mở rộng địa lý** (`GPU_FALLBACK_LEVELS`); không hạ uptime, disk hay mạng:

1. `asia_preferred` — Taiwan, Japan, Singapore, Thailand…
2. `asia_full` — thêm India, Asia, APAC…
3. `global` — toàn thế giới

**Giá trần & giới hạn thuê** khi rent offer:

- `MAX_PRICE_PREMIUM = 1.2` — `priceCap = giá_rẻ_nhất_trong_batch × 1.2`; offer vượt cap → bỏ region hiện tại.
- `MAX_OFFERS_PER_REGION = 3` — tối đa 3 offer/region; hết lượt → chuyển region tiếp theo.

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

Tái tục chủ động (>10h): tặng 5% giờ.

Auto-renew (<10h): tặng 3% giờ.

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