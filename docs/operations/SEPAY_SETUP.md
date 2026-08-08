# SePay — Cấu hình vận hành (CK tự động)

> Mục tiêu: tiền về tài khoản → hệ thống tự duyệt nạp ví / mua gói / tái tục.  
> Admin duyệt tay vẫn giữ làm dự phòng.

## 1. Trạng thái code & env

| Hạng mục | Cần có |
|----------|--------|
| Code | `src/lib/sepay.js`, webhook, QR, cron reconcile, UI checkout |
| SQL | `supabase/sepay-transactions.sql` (manifest `0054`) |
| Vercel env | `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_TOKEN`, `SEPAY_ACCOUNT_NUMBER`, `CRON_SECRET` |
| Tuỳ chọn | `SEPAY_BANK_CODE=MBBank`, `SEPAY_ACCOUNT_NAME` |
| Cron | `vercel.json` → `/api/cron/sepay-reconcile` mỗi 5 phút |

Webhook production:

```text
https://gpuvietnam.com/api/payment/sepay-webhook
```

## 2. Cấu hình trên dashboard SePay (my.sepay.vn)

### 2.1 Cấu trúc mã thanh toán

1. **Công ty → Cấu hình chung → Cấu trúc mã thanh toán**
2. Đặt:
   - **Tiền tố:** `GD`
   - **Độ dài phần sau:** `2`
   - **Ký tự:** chữ + số (alphanumeric)
3. Lưu.

> Nội dung CK ví dụ: `Nguyen Van A GDX7` — SePay trích `code = GDX7`.

### 2.2 Tạo webhook

1. **Tích hợp → Webhooks → Tạo mới**
2. **Bước 1 — Cơ bản**
   - Tên: `GPUVietnam Production`
   - Sự kiện: **Có tiền vào**
   - URL: `https://gpuvietnam.com/api/payment/sepay-webhook`
3. **Bước 2 — Tài khoản / bộ lọc**
   - Chọn đúng STK nhận tiền (khớp `SEPAY_ACCOUNT_NUMBER`)
   - Tiền tố mã: `GD`
   - Bật **Chỉ gửi khi có mã thanh toán** (khuyến nghị)
4. **Bước 3 — Bảo mật**
   - Chọn **HMAC-SHA256**
   - Secret Key = **đúng** giá trị `SEPAY_WEBHOOK_SECRET` trên Vercel  
     (copy từ Vercel → Environment Variables, hoặc tạo mới rồi cập nhật cả hai bên)
5. **Bước 4 — Cảnh báo** (tuỳ chọn): email khi webhook lỗi
6. Lưu → bấm **Gửi thử** nếu SePay có nút test.

### 2.3 API Token (cron đối soát)

1. **Công ty → API Access → Tạo token**
2. Gán quyền đọc giao dịch
3. Lưu vào Vercel: `SEPAY_API_TOKEN` (Production + Preview)

## 3. SQL (Supabase Production)

Chạy một lần (SQL Editor hoặc migration runner):

```bash
# Nếu dùng runner repo:
node scripts/run-migrations.mjs
# hoặc chạy thủ công file:
# supabase/sepay-transactions.sql
```

Bảng cần có: `public.sepay_transactions`.

## 4. Deploy

Env đã có trên Vercel **không đủ** — phải deploy bản code có SePay + `vercel.json` cron.

Sau deploy, kiểm tra:

```bash
# Cron thủ công (thay SECRET):
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://gpuvietnam.com/api/cron/sepay-reconcile"
```

Kỳ vọng JSON: `{ success: true, pulled, processed, skipped, ... }`  
Nếu `SEPAY_API_TOKEN` sai → HTTP 502.

## 5. Test giao dịch thật (nhỏ)

1. Đăng nhập production → Nạp ví số nhỏ (vd. 50.000đ)
2. Quét QR / CK **đúng số tiền + đúng nội dung có mã GD**
3. Trong vài phút:
   - Ví cộng số dư
   - Bảng `sepay_transactions` có dòng `status = processed`
   - Chuông thông báo (nếu bật)
4. Nếu không vào sau 5–10 phút: xem cron reconcile + log Vercel `sepay-webhook` / `sepay-reconcile`

## 6. Checklist nhanh

- [ ] SQL `0054` đã chạy trên Supabase prod
- [ ] SePay: cấu trúc mã `GD` + 2 ký tự
- [ ] SePay: webhook URL + HMAC = `SEPAY_WEBHOOK_SECRET`
- [ ] SePay: API token = `SEPAY_API_TOKEN`
- [ ] Vercel: 4 biến env đã set (webhook / token / STK / cron)
- [ ] Code SePay + cron đã **deploy** production
- [ ] Test nạp ví 1 lần thành công

## 7. Lỗi thường gặp

| Hiện tượng | Nguyên nhân hay gặp |
|------------|---------------------|
| Webhook `invalid_signature` | Secret lệch giữa SePay ↔ Vercel; hoặc body bị parse lại |
| `no_match` | Nội dung CK thiếu mã `GD**`; hoặc yêu cầu chưa được tạo trước khi CK |
| `amount_mismatch` | CK thiếu tiền so với số tiền yêu cầu |
| QR không hiện | Mạng chặn `qr.sepay.vn` — vẫn CK tay theo STK + nội dung |
| Cron 403 | Thiếu `CRON_SECRET` / không phải Vercel Cron |
| Cron `*/5` không chạy | Gói Vercel không hỗ trợ cron nhiều lần/ngày — nâng Pro hoặc gọi thủ công / external cron |
