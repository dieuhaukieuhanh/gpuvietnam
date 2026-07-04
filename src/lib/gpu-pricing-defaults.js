/** Cấu hình bảng giá GPU mặc định — seed DB & fallback khi chưa có bản ghi. */

export const DEFAULT_GPU_PRICING_CONFIG = {
  version: 1,
  section: {
    title: 'Chọn Gói Phù Hợp Với Bạn',
    subtitle:
      'Tất cả gói đều bao gồm máy chủ GPU riêng, môi trường cài sẵn, luôn có thể tùy chỉnh theo ý bạn',
    footerPaymentNote:
      '✓ Dễ dàng nạp giờ/thanh toán gói đăng ký bằng cách chuyển khoản qua QR ngân hàng',
  },
  billingToggles: [
    { mode: 'hourly', label: 'Theo giờ thực tế' },
    { mode: 'combo1', label: 'Combo1: 100h+10h ▪ 45 ngày' },
    { mode: 'combo2', label: 'Combo2: 200h+30h ▪ 120 ngày' },
  ],
  plans: [
    {
      planKey: 'starter',
      name: 'Starter',
      icon: '✨',
      tagline: 'Khởi đầu hành trình AI Art',
      featured: false,
      badge: null,
      accent: '#4F8EF7',
      gpu: 'RTX 3090',
      vram: '24GB',
      gpuLabel: 'RTX 3090 — 24GB VRAM',
      pricePerHour: 9_900,
      combo1: { hours: 100, bonus: 10, days: 45, price: 990_000 },
      combo2: { hours: 200, bonus: 30, days: 120, price: 1_980_000 },
      bestForAudience: [
        { icon: '🧪', label: 'Sinh viên AI' },
        { icon: '🎨', label: 'Freelancer mới bắt đầu' },
      ],
      bestFor: [
        'Sáng tạo ảnh SDXL chất lượng cao',
        'Test workflow và thử model mới',
        'Tạo avatar, ảnh nghệ thuật cá nhân',
      ],
      notFor: 'Cần tốc độ cao cho video AI hoặc batch ảnh lớn (gói Pro nhanh gấp 2.5 lần)',
      features: [
        { text: 'RTX 3090 — 24GB VRAM', included: true },
        { text: 'ComfyUI + SDXL + Flux cài sẵn', included: true },
        { text: 'Máy chủ ảo riêng — toàn quyền kiểm soát', included: true },
        { text: 'File tự sync Google Drive khi tắt', included: true },
        { text: 'Hỗ trợ Zalo khi gặp lỗi', included: true },
        { text: 'Lưu trữ cố định', included: false },
        { text: 'Tốc độ cao như RTX 4090', included: false },
      ],
      trust: [
        '24GB VRAM — đủ sức chạy SDXL, Flux mượt mà',
        'Không mất file khi tắt máy — tự sync Drive',
      ],
      cta: 'Chọn Starter',
    },
    {
      planKey: 'pro',
      name: 'Pro',
      icon: '🚀',
      tagline: 'Freelancer AI Art vận hành hàng ngày',
      featured: true,
      badge: 'Phổ biến nhất',
      accent: '#4F8EF7',
      gpu: 'RTX 4090',
      vram: '24GB',
      gpuLabel: 'RTX 4090 — 24GB VRAM',
      pricePerHour: 22_000,
      combo1: { hours: 100, bonus: 10, days: 45, price: 2_200_000 },
      combo2: { hours: 200, bonus: 30, days: 120, price: 4_400_000 },
      bestForAudience: [
        { icon: '🎨', label: 'Freelancer AI Art' },
        { icon: '📦', label: 'Người bán ảnh' },
        { icon: '🎬', label: 'Làm video AI' },
      ],
      bestFor: [
        'Flux.1 full-quality, SDXL 1024px+, upscale 4x',
        'Nhất quán nhân vật (IP-Adapter, ControlNet)',
        'AnimateDiff, video ngắn, LoRA inference',
      ],
      notFor: null,
      features: [
        {
          text: 'RTX 4090 — 24GB VRAM, nhanh gấp 2.5 lần — tối ưu cho video & batch ảnh lớn',
          included: true,
        },
        { text: 'Toàn bộ tính năng Starter', included: true },
        { text: 'Lưu trữ mặc định 20GB & tùy chọn mở rộng', included: true },
        { text: 'Đổi phiên không mất model & workflow', included: true },
        { text: 'Upscale 4x, SUPIR, workflow phức tạp', included: true },
        { text: 'Nhất quán nhân vật: IP-Adapter + ControlNet', included: true },
      ],
      trust: [
        'Nhanh hơn RTX 3090 gấp 2.5 lần — tiết kiệm thời gian, nhận nhiều đơn hơn',
        '24GB VRAM — Flux.1, upscale 4K không bao giờ báo hết bộ nhớ',
      ],
      cta: 'Chọn Pro',
    },
    {
      planKey: 'studio',
      name: 'Studio',
      icon: '🏢',
      tagline: 'Cho studio 2–5 người và agency content AI',
      featured: false,
      badge: null,
      accent: '#8B5CF6',
      gpu: '2x RTX 4090',
      vram: '48GB',
      gpuLabel: '2x RTX 4090 — 48GB VRAM (2x24GB riêng biệt)',
      pricePerHour: 40_000,
      combo1: { hours: 100, bonus: 10, days: 45, price: 4_000_000 },
      combo2: { hours: 200, bonus: 30, days: 120, price: 8_000_000 },
      bestForAudience: [
        { icon: '🏢', label: 'Agency/Team' },
        { icon: '📦', label: 'Người bán ảnh số lượng lớn' },
        { icon: '🎬', label: 'Video AI chuyên nghiệp' },
      ],
      bestFor: [
        'Sáng tạo & sản xuất nội dung số lượng lớn',
        'Làm việc nhóm với workspace độc lập',
        'Dự án video AI và batch processing nặng',
      ],
      notFor: null,
      features: [
        { text: '2x RTX 4090 — mỗi người 1 GPU riêng, không chia sẻ', included: true },
        { text: 'Nhiều người dùng cùng lúc (tối đa 5)', included: true },
        { text: 'Workspace riêng biệt cho từng thành viên', included: true },
        { text: 'Lưu trữ mặc định 50GB & tùy chọn mở rộng', included: true },
        { text: 'Video AI & LoRA training sẵn sàng', included: true },
        { text: 'Bảo mật dữ liệu', included: true },
      ],
      trust: [
        'Mỗi người 1 GPU riêng — không đụng VRAM, không chờ đợi',
        'Đa nhiệm và chuyên dụng cho đội nhóm',
      ],
      cta: 'Chọn Studio',
    },
  ],
};

export function getDefaultGpuPricingConfig() {
  return structuredClone(DEFAULT_GPU_PRICING_CONFIG);
}
