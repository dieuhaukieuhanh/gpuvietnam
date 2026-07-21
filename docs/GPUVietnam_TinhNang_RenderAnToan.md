# GPUVietnam — Hướng dẫn tích hợp tính năng "Render An Toàn"

**Mục tiêu:** giảm rủi ro gián đoạn cho render quan trọng (đặc biệt video dài) bằng cách chạy song song 2 phiên trên 2 host độc lập, tự động lấy kết quả từ phiên thắng, không bắt khách tự quản lý.

**Nguyên tắc nền tảng:** tính năng này KHÔNG cần hạ tầng mới. Tái sử dụng 100% cơ chế On-Demand + Gate (Lớp 1/2/3) đã có trong file chính sách chọn máy. Không dùng Vast Serverless (đã đánh giá không phù hợp). Toàn bộ việc cần làm nằm ở **tầng ứng dụng** (application layer), phía trên logic provisioning hiện tại.

**Bản chất tương tác:** ComfyUI là phiên máy + queue workflow (không phải job API tách biệt). Khách chỉ tương tác với **1 canvas** (phiên chính). Backend tự mirror submit sang phiên dự phòng — xem §2 bước 3.

---

## 1. Điều kiện kích hoạt

- Là tùy chọn (toggle) khách tự bật khi tạo phiên mới, không bật mặc định.
- Đề xuất giới hạn: chỉ cho phép ở gói Pro/Studio (nơi render thường quan trọng/dài hơn), hoặc mở cho mọi gói nhưng tính phụ phí theo đúng gói đó.
- Cảnh báo rõ trước khi khách bật: "Chi phí sẽ cao hơn phiên thường ~50-80%, đổi lại hệ thống tự động chạy dự phòng để giảm rủi ro gián đoạn."
- **Trước khi khách xác nhận bật:** kiểm tra capacity — xác nhận marketplace có đủ ít nhất 2 host khả dụng (sau hard filters + exclude list) cho gói đó. Nếu không đủ máy dự phòng → không cho bật / không trừ phụ phí; báo rõ.

## 2. Luồng kỹ thuật — 5 bước

**Bước 1 — Nhận yêu cầu bật Render An Toàn.**
Ghi nhận đây là 1 phiên "kép" (paired session), tạo 1 `session_group_id` chung để liên kết 2 phiên con (nhánh A = chính hiển thị UI, nhánh B = dự phòng nền).

**Bước 2 — Tạo 2 phiên On-Demand song song, ép khác host.**
Gọi đúng luồng Lớp 1 (chọn máy) hai lần liên tiếp. Lần thứ 2 phải loại trừ **hợp nhất** trong một bộ lọc:

1. host đã chọn ở phiên A (`host_key` / `host_id` đã rent), và
2. toàn bộ bad-host đang trong TTL hiệu lực (cùng store exclusion / reputation đã có),

— không tách hai điều kiện độc lập rồi hy vọng không xung đột. Không để hệ thống chọn cùng 1 host cho cả 2 phiên (mất ý nghĩa độc lập rủi ro).

Cả 2 phiên đều phải qua đầy đủ Lớp 2 (gate) độc lập trước khi được coi là "sẵn sàng".

**Bước 3 — Mirror cùng một workflow submit sang cả 2 phiên đã READY.**

Định nghĩa "job" trong tính năng này: **workflow JSON mà khách submit trên phiên chính** (thường qua Queue trên ComfyUI). Không yêu cầu khách bấm Queue hai lần.

- Khách chỉ thấy / thao tác **1 canvas** (phiên A).
- Khi khách Queue trên A: backend lấy đúng payload `/prompt` (hoặc tương đương), **âm thầm POST** sang phiên B.
- Chỉ bắt đầu mirror sau khi **CẢ 2** phiên pass gate.
- Nếu 1 trong 2 fail gate: fallback chế độ đơn (chỉ phiên còn lại), thông báo khách; **không tính phụ phí An Toàn** (xem §3 — chưa từng trừ phụ phí nếu chưa đủ 2 phiên READY).

**Bước 4 — Theo dõi song song; thắng = output hợp lệ đã lên R2.**

Thứ tự xác nhận thắng (bắt buộc):

1. Workflow báo done trên phiên (WebSocket / history ComfyUI), **và**
2. File output đã ghi xong trên host, **và**
3. Đồng bộ artifact lên R2 **thành công** trong namespace nhánh của phiên đó,

→ chỉ lúc đó mới đánh dấu "phiên thắng" theo timestamp hệ thống ghi nhận bước (3).

Không đánh dấu thắng chỉ vì sự kiện `executing`/history — tránh hủy phiên kia trong khi artifact phiên "done" bị lỗi ghi / mất giữa chừng.

**Bước 5 — Promote artifact phiên thắng, hủy phiên thua.**

- Mỗi nhánh ghi R2 vào **namespace riêng** (bắt buộc — tránh đè file):
  - `users/{user_id}/render-safe/{session_group_id}/branch-a/`
  - `users/{user_id}/render-safe/{session_group_id}/branch-b/`
- Khi có phiên thắng: **promote** (copy/move) artifact nhánh thắng vào thư mục chính thức của user (workspace / outputs chuẩn Auto Backup), rồi hủy/destroy phiên thua ngay (không chờ chạy hết).
- Không để 2 phiên ghi thẳng vào cùng prefix workspace mặc định trong lúc chạy song song.

## 3. Billing — tính tiền thế nào

Tách biệt khỏi core billing (SCB) đang đóng băng — lớp phụ phí phía trên, không sửa logic tính giờ gốc:

- **Phụ phí An Toàn chỉ áp dụng sau khi cả 2 phiên qua gate.** Nếu chỉ 1 phiên pass → chạy đơn, chỉ tính phí 1 phiên thường (không trừ rồi hoàn; đơn giản hơn).
- **Phiên thắng / phiên đơn:** tính tiền theo số giờ/phút đã chạy như phiên thường.
- **Phiên thua:** tính đến đúng thời điểm bị hủy (không tính thêm sau đó). Hủy sớm → thời gian phiên thua thường ngắn hơn phiên thắng.
- **Mức phụ phí đề xuất với khách:** khoảng **1.5–1.8×** giá 1 phiên đơn (dễ hiểu trước khi dùng).
- **Cap cứng đề xuất: tối đa 1.9×** giá phiên đơn tương đương — che edge case video dài, 2 phiên gần như xong cùng lúc (margin mỏng hơn, giữ lời hứa giá).
- Chênh lệch giữa mức thu (≤1.9×) và chi GPU thực (~gần 2× trừ phần hủy sớm phiên thua) là phần platform chủ động bù; đo lại sau vài lượt test thật trước khi chốt số.

## 4. Xử lý các trường hợp biên (edge case)

| Tình huống | Cách xử lý |
|---|---|
| Không đủ 2 host khả dụng trước khi bật | Không cho bật Render An Toàn; không trừ phụ phí; báo hết máy dự phòng |
| Cả 2 phiên đều fail gate (Lớp 2) | Không mirror workflow, báo lỗi, không tính phụ phí An Toàn; thử lại theo offer dự phòng đã có |
| 1 phiên fail gate, 1 phiên pass | Fallback chế độ đơn, báo khách rõ, chỉ tính phí 1 phiên (không phụ phí An Toàn) |
| 2 phiên hoàn thành gần như đồng thời | Thắng = phiên xác nhận R2 thành công TRƯỚC (timestamp hệ thống); hủy phiên còn lại ngay; billing vẫn ≤ cap 1.9× |
| Workflow done nhưng R2 sync fail trên một nhánh | Nhánh đó chưa được coi là thắng; tiếp tục chờ nhánh kia / chính sách bù giờ nếu cả hai thất bại artifact |
| Cả 2 phiên sự cố giữa chừng | Áp dụng chính sách bù giờ + xin lỗi downtime thông thường, không luồng riêng |
| Khách tắt trình duyệt khi đang chạy song song | Cả 2 phiên chạy nền; hủy phiên thua vẫn theo bước 5 khi có phiên thắng + R2 OK |

## 5. Trải nghiệm hiển thị cho khách (UI/UX)

- Không cần lộ chi tiết "2 máy song song" — 1 thanh tiến trình, nhãn "Chế độ An Toàn: đang render với dự phòng tự động".
- Fallback về đơn: "Đã chuyển sang chế độ thường do máy dự phòng không sẵn sàng, tiếp tục render bình thường."
- Sau khi xong: chỉ trả kết quả đã promote; không cần nói phiên nào thắng/thua.

## 6. Việc cần làm trước khi launch tính năng này

1. Lớp 1: tham số exclude host hợp nhất (`host_key` phiên A + bad-host TTL) khi chọn máy lần 2.
2. Capacity pre-check (≥2 host khả dụng) trước khi khách xác nhận bật.
3. Mirror `/prompt` từ phiên A → B sau khi cả hai READY; UI một canvas.
4. R2 namespace theo `session_group_id` + `branch-a|b`; promote artifact phiên thắng; không ghi chung prefix workspace khi chạy kép.
5. Tín hiệu thắng = workflow done + artifact R2 OK; rồi mới destroy phiên thua.
6. Billing: phụ phí chỉ sau 2× gate pass; cap ≤1.9×; đo chi phí thực vs thu sau vài lượt test.
7. Test bắt buộc: cả 2 fail gate; 1 fail 1 pass; race hoàn thành gần đồng thời; R2 sync fail một nhánh; đè file (regression).

## 7. Ghi chú — chưa nên làm ngay nếu chưa go-live

Đây là tính năng **nên có trong roadmap**, không nhất thiết phải có ngay ở bản go-live đầu tiên. Ưu tiên: ra mắt 3 gói cơ bản ổn định trước, xác nhận nhu cầu thật về "video dài cần độ tin cậy cao" (qua vài khách hỏi cụ thể), rồi mới đầu tư công sức xây tính năng này.
