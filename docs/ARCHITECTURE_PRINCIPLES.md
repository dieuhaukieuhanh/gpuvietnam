# GPUVietnam — Architecture Principles

> Bộ nguyên tắc thiết kế chính thức của GPUVietnam.  
> Tài liệu này mô tả **triết lý kiến trúc**, không mô tả implementation hay code.

**Phiên bản:** 1.1  
**Ngày:** 2026-06-28  
**Liên quan:** [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) · [TARGET_ARCHITECTURE_DRAFT.md](./TARGET_ARCHITECTURE_DRAFT.md)

## Changelog

### v1.1

- Bổ sung Architecture Philosophy.
- Bổ sung nguyên tắc Feature-first.
- Bổ sung nguyên tắc Order-first.
- Bổ sung Payment Domain.
- Bổ sung Idempotency.
- Bổ sung Adapter / Provider Pattern.
- Bổ sung Data Ownership.
- Bổ sung Vendor Lock-in.

---

## Mục đích

Các nguyên tắc dưới đây là tiêu chí khi thiết kế tính năng mới, đánh giá thay đổi kiến trúc, và giữ nhất quán sản phẩm trong dài hạn. Mọi quyết định kỹ thuật phải **tuân thủ** hoặc **giải thích rõ** lý do ngoại lệ.

---

## Architecture Philosophy

GPUVietnam được thiết kế với mục tiêu:

> **Kiến trúc phải phục vụ khả năng vận hành của một người.**

Mọi quyết định về tính năng, kiến trúc và hạ tầng đều ưu tiên:

- Đơn giản để vận hành.
- Dễ hiểu và dễ bảo trì.
- Dễ mở rộng khi thực sự cần.
- Tránh tối ưu hóa sớm.
- Giảm thao tác thủ công nhưng không đánh đổi sự ổn định.

Chỉ khi quy mô người dùng và doanh thu thực sự yêu cầu, hệ thống mới nên mở rộng sang các kiến trúc hoặc quy trình phức tạp hơn.

Đây là triết lý thiết kế xuyên suốt của GPUVietnam.

---

## Nguyên tắc

### 1. Một phiên làm việc chỉ có một Workspace

Mỗi lần người dùng mở phiên GPU, hệ thống chỉ cung cấp **một** môi trường làm việc (Workspace) tại một thời điểm. Không thiết kế cho nhiều Workspace chạy song song trên cùng một phiên hoặc cùng một máy ảo.

### 2. Workspace chỉ thay đổi khi bắt đầu phiên mới

Workspace áp dụng theo mô hình **restart-only**: chọn Workspace mới chỉ có hiệu lực sau khi kết thúc phiên hiện tại và bắt đầu phiên mới. Không hot-swap Workspace trong khi phiên đang chạy.

### 3. Phiên làm việc và gói đăng ký là hai khái niệm tách biệt

**Subscription** (quyền sử dụng, số giờ, thời hạn) và **phiên làm việc** (máy GPU đang chạy) là hai lớp độc lập. Trạng thái gói không được nhầm lẫn với trạng thái máy đang online hay offline.

### 4. Machine chỉ đại diện trạng thái phiên làm việc

Thực thể máy (Machine) mô tả **một phiên GPU cụ thể** — từ lúc provision đến lúc destroy — không phải tài sản cố định lâu dài của người dùng. Máy là ephemeral: sinh ra khi bắt đầu phiên, kết thúc khi đóng phiên.

### 5. Một người dùng chỉ có một phiên GPU active tại một thời điểm

Hệ thống không thiết kế cho nhiều instance GPU đồng thời trên một tài khoản. Mọi luồng start/stop phải đảm bảo tính duy nhất của phiên đang chạy.

### 6. GPU Provider phải độc lập

Logic nghiệp vụ (billing, subscription, workspace, backup) **không** phụ thuộc trực tiếp vào một nhà cung cấp GPU cụ thể. GPU Provider là lớp thay thế được; domain core chỉ giao tiếp qua abstraction chung.

### 7. Instance GPU là tạm thời, không phải máy chủ cố định

GPU được thuê theo phiên, không bán/cho thuê máy vật lý riêng. Thiết kế luôn giả định instance có thể bị destroy bất cứ lúc nào (user stop, hết credit, idle, lỗi provider).

### 8. Billing luôn gắn với thời gian sử dụng thực

Tính phí dựa trên **thời gian máy đang chạy và có hiệu lực billing**, tính theo đơn vị thời gian rời rạc (phút). Không thiết kế billing theo gói cố định một lần cho cả phiên đang chạy; giờ/quota bị trừ dần trong khi phiên active.

### 9. Billing không phụ thuộc Payment Provider

Cơ chế trừ giờ, kết thúc phiên, và ghi nhận session **độc lập** với cách người dùng đã nạp tiền hay mua gói (chuyển khoản, ví, gateway tương lai).

### 10. Subscription không phụ thuộc Payment Provider

Quyền sử dụng GPU (subscription, inventory giờ, trial) là domain riêng. Kích hoạt gói có thể qua nhiều kênh thanh toán, nhưng **trạng thái subscription** không được ràng buộc cứng với một gateway hay ngân hàng.

### 11. Payment không phụ thuộc Gateway

Thanh toán ưu tiên mô hình **đa kênh**: chuyển khoản có duyệt, ví nội bộ, và gateway (nếu có) chỉ là **tùy chọn bổ sung** — không phải điều kiện bắt buộc để hệ thống hoạt động. Core payment logic phải hoạt động khi không có gateway.

### 12. Backup phải độc lập

Luồng backup trước khi kết thúc phiên là module tách biệt: có thể thất bại mà vẫn cho phép destroy theo chính sách sản phẩm, nhưng **không** được gộp chung logic với billing hay payment. Backup phục vụ bảo toàn dữ liệu người dùng, không phục vụ tính tiền.

### 13. Destroy phiên phải đi qua một luồng thống nhất

Mọi lý do kết thúc phiên (người dùng tắt, admin tắt, idle, hết credit, lỗi) phải hội tụ về **một quy trình destroy chung**, đảm bảo thứ tự nhất quán: backup (nếu áp dụng) → billing → kết thúc session → hủy instance → cập nhật trạng thái.

### 14. Tự động tắt máy là chính sách sản phẩm, không phải tùy chọn phụ

Hệ thống chủ động kết thúc phiên khi **hết quota/credit** hoặc **idle quá lâu**. Đây là ràng buộc bảo vệ chi phí người dùng và capacity hạ tầng, không được thiết kế lại thành “chỉ tắt khi user bấm”.

### 15. Kiến trúc phải phù hợp với mô hình vận hành một người

Kiến trúc, quy trình và công cụ phải cho phép một người quản trị vận hành toàn bộ hệ thống một cách hiệu quả.

Mọi tính năng mới cần được đánh giá về tác động đến chi phí vận hành và độ phức tạp quản trị.

Không thiết kế sớm cho nhiều cấp vận hành, nhiều nhóm kỹ thuật hay quy trình doanh nghiệp phức tạp khi chưa có nhu cầu thực tế.

### 16. Không thiết kế cho microservice

GPUVietnam là **monolith có cấu trúc module rõ ràng**, triển khai đơn giản. Không tách service chỉ vì lý do scale giả định. Chỉ xem xét tách khi quy mô và nhân sự thực sự đòi hỏi — và vẫn phải cân nhắc nguyên tắc 15.

### 17. Ưu tiên đơn giản hơn tối ưu hóa sớm

Chọn giải pháp **dễ hiểu, dễ vận hành, dễ debug** trước khi tối ưu hiệu năng hoặc scale phức tạp. Tránh abstraction hoặc hạ tầng chỉ phục vụ tương lai xa mà chưa có nhu cầu thực.

### 18. Mọi thay đổi kiến trúc phải triển khai được từng bước

Không big-bang rewrite. Mọi tiến hóa (job layer, audit, gateway, provider thứ hai) phải **additive**, có thể rollback, và không phá vỡ triết lý cốt lõi trong một release.

### 19. Mọi module mới phải có khả năng mở rộng

Module mới phải định nghĩa ranh giới rõ, contract ổn định, và điểm mở rộng (provider, kênh thanh toán, kênh thông báo) mà **không** buộc caller biết chi tiết bên trong.

### 20. Domain logic tách khỏi API và UI

Quy tắc nghiệp vụ nằm ở tầng domain, không nhúng trực tiếp vào handler HTTP hay component giao diện. API và UI chỉ điều phối; không trở thành nơi lưu trữ logic cốt lõi.

### 21. Thông báo là cross-cutting, không phải lõi nghiệp vụ

Thông báo (in-app, email, Zalo, …) phục vụ **truyền đạt sự kiện** từ các domain (payment, billing, backup, idle). Không được thiết kế sao cho nghiệp vụ core phụ thuộc vào việc gửi thông báo thành công.

### 22. Dữ liệu người dùng thuộc về người dùng

Output, workflow, và artifact trên phiên GPU phải có đường **sao lưu hoặc phục hồi** trước/sau khi phiên kết thúc. Kiến trúc không giả định dữ liệu trên instance tồn tại vĩnh viễn sau destroy.

### 23. Admin duyệt thủ công là hợp lệ ở giai đoạn sớn

Chuyển khoản ngân hàng với xác nhận thủ công là **first-class payment path**, không phải workaround tạm. Tự động hóa (gateway, đối soát) chỉ bổ sung khi volume vận hành thực sự cần.

### 24. Observability phục vụ vận hành một người

Log, audit, và dashboard admin phải giúp **một operator** trả lời nhanh: ai đang chạy gì, vì sao máy tắt, billing đã trừ bao nhiêu, backup có thành công không. Không thiết kế observability cho đội SRE lớn trước khi cần.

### 25. Tài liệu kiến trúc là nguồn sự thật cho triết lý sản phẩm

Khi code và tài liệu mâu thuẫn, **nguyên tắc trong tài liệu này** là chuẩn để quyết định sửa code hay cập nhật tài liệu — sau khi thảo luận có chủ đích, không âm thầm lệch triết lý.

### 26. Feature là đơn vị kinh doanh

GPUVietnam được thiết kế xoay quanh các Feature (AI Image, AI Video, AI Audio, LLM, Agent, API, ...).

Workspace chỉ là cách triển khai kỹ thuật của một Feature, không phải đơn vị kinh doanh.

Điều này giúp mở rộng sang các dịch vụ AI mới mà không phải thay đổi kiến trúc cốt lõi.

---

### 27. Mọi giao dịch bắt đầu từ một Order

Mọi hoạt động phát sinh giá trị (mua gói GPU, nạp ví, mua Backup, mua Storage, mua API, mua Workflow...) đều nên bắt đầu từ một Order.

Payment chỉ là quá trình xử lý Order.

Subscription chỉ là kết quả của Order.

Điều này giúp mở rộng nhiều loại sản phẩm và nhiều phương thức thanh toán mà không thay đổi Domain Core.

---

### 28. Payment Domain là trung tâm

Payment Gateway (PayOS, Stripe, VietQR, chuyển khoản...) chỉ là các kênh thanh toán.

Domain Payment phải độc lập với từng Gateway.

Việc thay đổi hoặc bổ sung Gateway không được làm thay đổi nghiệp vụ thanh toán cốt lõi.

---

### 29. Mọi thao tác quan trọng phải Idempotent

Các thao tác như:

- Start Machine
- Stop Machine
- Destroy Machine
- Activate Subscription
- Payment Callback
- Provision GPU

phải có thể được gọi nhiều lần nhưng chỉ tạo ra một kết quả hợp lệ.

Điều này giúp hệ thống ổn định khi retry, timeout hoặc callback trùng lặp.

---

### 30. Mọi tích hợp bên ngoài phải đi qua Provider hoặc Adapter

Core Domain không phụ thuộc trực tiếp vào API của bên thứ ba.

Mọi tích hợp như:

- GPU Provider
- Payment Gateway
- SMS
- Email
- Storage
- Notification

đều nên thông qua một lớp Provider hoặc Adapter.

Điều này giúp thay thế nhà cung cấp mà không ảnh hưởng nghiệp vụ.

---

### 31. Người dùng sở hữu dữ liệu, Provider chỉ cung cấp tài nguyên

GPU Provider chỉ cung cấp tài nguyên tính toán.

Workflow, Output, Prompt, Backup và các dữ liệu khác thuộc quyền sở hữu của người dùng.

Kiến trúc không được giả định dữ liệu còn tồn tại sau khi Instance bị Destroy.

---

### 32. Tránh Vendor Lock-in

Không phụ thuộc không thể thay thế vào bất kỳ nhà cung cấp nào.

Bao gồm nhưng không giới hạn:

- GPU Provider
- Database Platform
- Object Storage
- Payment Gateway
- SMS Gateway
- CDN

Việc thay đổi nhà cung cấp phải chỉ ảnh hưởng đến lớp tích hợp, không làm thay đổi Domain Core.

---

## Phạm vi áp dụng

| Áp dụng | Không áp dụng |
|---|---|
| Tính năng GPU, workspace, billing, payment, backup | Nội dung marketing, copy trang landing |
| Module admin và vận hành | Quy trình kinh doanh ngoài sản phẩm (hợp đồng, kế toán) |
| Tích hợp provider và storage bên thứ ba | Chi tiết UI/UX từng màn hình |

---

## Cập nhật tài liệu

Chỉ sửa nguyên tắc khi **triết lý sản phẩm** thay đổi có chủ đích. Mọi thay đổi phải ghi version và lý do ngắn gọn ở đầu tài liệu.

---

*GPUVietnam Architecture Principles v1.1*
