/**
 * Seed / fallback GPU plan prices & marketing copy.
 * Live SoT: Admin Edit giá → `gpu_pricing_config` (web đọc qua `/api/gpu-pricing`).
 * File này chỉ dùng khi DB trống hoặc API lỗi.
 */

export const DEFAULT_BILLING_VALIDITY = {
  hourlyDays: 60,
  combo1Days: 120,
  combo2Days: 180,
};

export const DEFAULT_GPU_PRICING_CONFIG = {
  version: 1,
  billingValidity: {
    hourlyDays: DEFAULT_BILLING_VALIDITY.hourlyDays,
  },
  section: {
    title: 'Chọn Gói Phù Hợp Với Bạn',
    subtitle:
      'Tất cả gói đều bao gồm máy chủ GPU riêng, môi trường cài sẵn, luôn có thể tùy chỉnh theo ý bạn',
    footerPaymentNote:
      '✓ Dễ dàng nạp giờ/thanh toán gói đăng ký bằng cách chuyển khoản qua QR ngân hàng',
  },
  billingToggles: [
    { mode: 'hourly', label: `Theo giờ thực tế ▪ ${DEFAULT_BILLING_VALIDITY.hourlyDays} ngày` },
    {
      mode: 'combo1',
      label: `Combo1: 100h+10h ▪ ${DEFAULT_BILLING_VALIDITY.combo1Days} ngày`,
    },
    {
      mode: 'combo2',
      label: `Combo2: 200h+30h ▪ ${DEFAULT_BILLING_VALIDITY.combo2Days} ngày`,
    },
  ],
  plans: [
    {
      planKey: 'starter',
      name: 'Starter',
      icon: '✨',
      tagline: 'Lựa chọn tối ưu cho hầu hết nhu cầu AI Art',
      featured: false,
      badge: null,
      accent: '#4F8EF7',
      gpu: 'RTX 3090',
      vram: '24GB',
      gpuLabel: 'RTX 3090 — 24GB VRAM',
      pricePerHour: 9_900,
      combo1: { hours: 100, bonus: 10, days: 120, price: 990_000 },
      combo2: { hours: 200, bonus: 30, days: 180, price: 1_980_000 },
      bestForAudience: [
        { icon: '🎨', label: 'Freelancer AI Art' },
        { icon: '🖼️', label: 'Nhà sáng tạo nội dung' },
        { icon: '🧪', label: 'Sinh viên & người học AI' },
        { icon: '💼', label: 'Dự án cá nhân' },
      ],
      bestFor: [
        'Tạo ảnh AI chất lượng cao với SDXL, Flux, Pony và các model phổ biến',
        'Chạy hầu hết workflow ComfyUI: ControlNet, IPAdapter, Inpainting, Upscale...',
        'Batch ảnh vừa và nhỏ cho công việc hằng ngày',
        'Thử nghiệm workflow, model và LoRA mới',
      ],
      notFor:
        'Video AI hoặc workflow rất nặng cần tốc độ cao hơn — Pro sẽ hoàn thành nhanh hơn đáng kể',
      features: [
        { text: 'ComfyUI + SDXL + Flux cài sẵn', included: true },
        { text: 'Máy làm việc riêng — toàn quyền cài model và workflow', included: true },
        {
          text: 'SSD 50GB · Auto Backup 100GB (Outputs mỗi 10 phút • Workflows mỗi 20 phút)',
          included: true,
        },
      ],
      trustTitle: 'Vì sao chọn Starter?',
      trust: [
        'Đáp ứng hầu hết nhu cầu AI Art — RTX 3090 với 24GB VRAM đủ để vận hành mượt mà phần lớn workflow ComfyUI phổ biến hiện nay.',
        'Làm việc trên máy riêng — Toàn quyền cài đặt model, workflow và môi trường theo nhu cầu của bạn.',
        'Bảo vệ dữ liệu tự động — Auto Backup định kỳ giúp giảm rủi ro mất dữ liệu trong quá trình làm việc.',
      ],
      upgradeTitle: null,
      upgradeIntro: null,
      upgradeItems: [],
      upgradeFooter: null,
      cta: 'Chọn Starter',
    },
    {
      planKey: 'pro',
      name: 'Pro',
      icon: '🚀',
      tagline: 'Tăng tốc quy trình sáng tạo và nâng cao năng suất mỗi ngày',
      featured: true,
      badge: 'Phổ biến nhất',
      accent: '#4F8EF7',
      gpu: 'RTX 4090',
      vram: '24GB',
      gpuLabel: 'RTX 4090 — 24GB VRAM',
      pricePerHour: 20_000,
      combo1: { hours: 100, bonus: 10, days: 120, price: 2_000_000 },
      combo2: { hours: 200, bonus: 30, days: 180, price: 4_000_000 },
      bestForAudience: [
        { icon: '🎨', label: 'Freelancer AI Art' },
        { icon: '📦', label: 'Người kinh doanh ảnh AI' },
        { icon: '🎬', label: 'Nhà sáng tạo nội dung' },
        { icon: '🚀', label: 'Người làm AI toàn thời gian' },
      ],
      bestFor: [
        'Render nhanh SDXL, Flux và các workflow ComfyUI phức tạp',
        'Batch ảnh lớn cho công việc hằng ngày',
        'Video AI ngắn và workflow AnimateDiff',
        'Workflow nhiều ControlNet, IP-Adapter, Inpainting, Upscale',
        'Xử lý nhiều đơn hàng hơn trong cùng một khoảng thời gian',
      ],
      notFor: 'Studio sản xuất quy mô lớn hoặc video AI dài — Studio sẽ phù hợp hơn',
      features: [
        { text: 'RTX 4090 — tốc độ xử lý vượt trội so với RTX 3090', included: true },
        { text: 'Toàn bộ tính năng của Starter', included: true },
        {
          text: 'SSD 80GB · Auto Backup 150GB (Outputs mỗi 3 phút • Workflows mỗi 10 phút)',
          included: true,
        },
        { text: 'Phiên làm việc riêng, toàn quyền cài model và workflow', included: true },
        { text: 'Khôi phục nhanh model và workflow khi mở lại phiên', included: true },
      ],
      trustTitle: 'Vì sao chọn Pro?',
      trust: [
        'Tăng năng suất làm việc — RTX 4090 giúp rút ngắn đáng kể thời gian render, đặc biệt với workflow phức tạp, batch ảnh lớn và video AI.',
        'Phù hợp cho người làm AI hằng ngày — Khi AI Art là công việc tạo ra thu nhập, thời gian render nhanh hơn đồng nghĩa với khả năng hoàn thành nhiều công việc hơn mỗi ngày.',
        'Bảo vệ dữ liệu tốt hơn — Auto Backup với tần suất cao hơn giúp giảm tối đa lượng công việc có thể mất khi xảy ra sự cố trong quá trình làm việc.',
      ],
      upgradeTitle: null,
      upgradeIntro: null,
      upgradeItems: [],
      upgradeFooter: null,
      cta: 'Chọn Pro',
    },
    {
      planKey: 'studio',
      name: 'Studio',
      icon: '🏢',
      tagline: 'Hiệu năng tối đa cho sản xuất AI chuyên nghiệp',
      featured: false,
      badge: null,
      accent: '#8B5CF6',
      gpu: 'RTX 5090',
      vram: '32GB',
      gpuLabel: 'RTX 5090 — 32GB VRAM',
      pricePerHour: 35_000,
      combo1: { hours: 100, bonus: 10, days: 120, price: 3_500_000 },
      combo2: { hours: 200, bonus: 30, days: 180, price: 7_000_000 },
      bestForAudience: [
        { icon: '🏢', label: 'Agency AI' },
        { icon: '🎬', label: 'Studio sáng tạo' },
        { icon: '👥', label: 'Team AI Art' },
        { icon: '🎥', label: 'Video AI chuyên nghiệp' },
        { icon: '🚀', label: 'Nhà sáng tạo có khối lượng công việc lớn' },
      ],
      bestFor: [
        'Workflow ComfyUI rất phức tạp với nhiều node và model',
        'Video AI chất lượng cao, thời lượng dài',
        'Batch ảnh lớn cho sản xuất thương mại',
        'Upscale độ phân giải cao và hậu kỳ AI',
        'Chạy nhiều workflow liên tục với tốc độ tối đa',
        'Phù hợp cho nhóm làm việc và dự án thương mại',
      ],
      notFor: null,
      features: [
        { text: 'RTX 5090 — hiệu năng hàng đầu cho AI Art', included: true },
        { text: 'Toàn bộ tính năng của Pro', included: true },
        {
          text: 'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
          included: true,
        },
        { text: 'Khôi phục nhanh model và workflow khi mở lại phiên', included: true },
        { text: 'Tối ưu cho workflow rất lớn và video AI', included: true },
      ],
      trustTitle: 'Vì sao chọn Studio?',
      trust: [
        'Hiệu năng tối đa — RTX 5090 giúp xử lý nhanh các workflow AI phức tạp, video AI và batch ảnh lớn, rút ngắn đáng kể thời gian chờ đợi.',
        'Dành cho sản xuất thương mại — Khi AI là hoạt động kinh doanh, Studio giúp tăng năng suất và đáp ứng khối lượng công việc lớn một cách ổn định.',
        'Bảo vệ dữ liệu toàn diện — Auto Backup với tần suất cao nhất giúp giảm tối đa rủi ro mất dữ liệu trong suốt quá trình làm việc.',
      ],
      upgradeTitle: null,
      upgradeIntro: null,
      upgradeItems: [],
      upgradeFooter: null,
      cta: 'Chọn Studio',
    },
  ],
};

export function getDefaultGpuPricingConfig() {
  return structuredClone(DEFAULT_GPU_PRICING_CONFIG);
}
