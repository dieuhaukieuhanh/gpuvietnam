# GPUVietnam — Next.js 14

Dự án Next.js 14 (Pages Router) chuyển đổi từ các file HTML gốc, giữ nguyên giao diện, màu sắc và font chữ.

## Cấu trúc thư mục

```
src/
├── pages/              # Route Next.js (14 trang)
├── components/
│   ├── layout/         # Header, Footer, Sidebar tái sử dụng
│   └── pages/          # Component nội dung từng trang HTML
├── lib/
│   ├── constants.ts    # Thương hiệu, màu sắc, liên hệ
│   ├── navigation.ts   # Menu, helper điều hướng
│   ├── routes.ts       # Đường dẫn trang
│   └── scripts/        # Logic tương tác từ <script> HTML gốc
└── styles/
    ├── globals.css
    └── pages/          # CSS gốc từng trang (export dạng string)
```

## Chạy dự án

```bash
cd gpuvietnam
npm install
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000)

## Bản đồ trang

| HTML gốc | Route |
|----------|-------|
| Trang chu.html | `/` |
| About us.html | `/about` |
| Dieu khoan dich vu.html | `/dieu-khoan-dich-vu` |
| Chinh sach bao mat.html | `/chinh-sach-bao-mat` |
| Checkout 1.html | `/checkout/1` |
| Checkout 2.html | `/checkout/2` |
| Cap nhat nen tang.html | `/cap-nhat-nen-tang` |
| Dashboard cua KH.html | `/dashboard` |
| Dashboard cua KH Cai dat.html | `/dashboard/cai-dat` |
| Dashboard KH Lich su su dung.html | `/dashboard/lich-su` |
| Admin Panel.html | `/admin` |
| Quan tri KH.html | `/admin/khach-hang` |
| Ha tang GPU.html | `/admin/ha-tang` |
| Tai nguyen.html | `/admin/tai-nguyen` |

## Tái tạo từ HTML

Khi cập nhật file HTML gốc ở thư mục cha:

```bash
npm run convert
```

## Font & màu sắc

- **Font:** Inter (body), Space Grotesk (heading) — Google Fonts
- **Nền:** `#0A0A0F`, accent xanh `#4F8EF7`, tím `#8B5CF6`
