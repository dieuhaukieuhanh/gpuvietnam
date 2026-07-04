import {
  buildPlanPricingDisplay,
  getGpuLabel,
  GPU_PLANS,
  PLAN_ORDER,
} from './gpu-pricing';

export type BillingMode = 'hourly' | 'combo1' | 'combo2';

export type PlanPricing = {
  price: string;
  unit: string;
  note: string;
};

export type Plan = {
  name: string;
  icon: string;
  tagline: string;
  bestForAudience: { icon: string; label: string }[];
  bestFor: string[];
  notFor?: string;
  gpuLabel: string;
  pricing: Record<BillingMode, PlanPricing>;
  features: { text: string; included: boolean }[];
  trust: string[];
  cta: string;
  featured: boolean;
  accent: string;
  badge?: string | null;
  planKey?: string;
};

export const BILLING_LABELS: Record<BillingMode, string> = {
  hourly: 'Theo giờ',
  combo1: 'Combo1',
  combo2: 'Combo2',
};

export const BILLING_CONFIRM_LABELS: Record<BillingMode, string> = {
  hourly: 'Theo giờ',
  combo1: 'Combo1 (100h+10h)',
  combo2: 'Combo2 (200h+30h)',
};

export const BILLING_TOGGLES: { mode: BillingMode; label: string }[] = [
  { mode: 'hourly', label: 'Theo giờ thực tế' },
  { mode: 'combo1', label: 'Combo1: 100h+10h ▪ 45 ngày' },
  { mode: 'combo2', label: 'Combo2: 200h+30h ▪ 120 ngày' },
];

type PlanMeta = Omit<Plan, 'pricing' | 'gpuLabel' | 'name'>;

const PLAN_META: Record<(typeof PLAN_ORDER)[number], PlanMeta> = {
  starter: {
    icon: '✨',
    tagline: 'Khởi đầu hành trình AI Art',
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
    featured: false,
    accent: '#4F8EF7',
  },
  pro: {
    icon: '🚀',
    tagline: 'Freelancer AI Art vận hành hàng ngày',
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
    featured: true,
    accent: '#4F8EF7',
  },
  studio: {
    icon: '🏢',
    tagline: 'Cho studio 2–5 người và agency content AI',
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
    featured: false,
    accent: '#8B5CF6',
  },
};

type PlanKey = keyof typeof GPU_PLANS;

export const CHECKOUT_PLANS: Plan[] = (PLAN_ORDER as PlanKey[]).map((planKey) => {
  const meta = PLAN_META[planKey];
  return {
    ...meta,
    name: GPU_PLANS[planKey].name,
    gpuLabel: getGpuLabel(planKey),
    pricing: buildPlanPricingDisplay(planKey) as Record<BillingMode, PlanPricing>,
  };
});

export function resolveCheckoutPlans(plans?: Plan[]): Plan[] {
  return plans?.length ? plans : CHECKOUT_PLANS;
}

export function findCheckoutPlan(planName: string, plans?: Plan[]): Plan {
  const list = resolveCheckoutPlans(plans);
  return list.find((p) => p.name === planName) ?? CHECKOUT_PLANS[1];
}

export function getCheckoutPlanPriceLabel(
  planName: string,
  billing: string,
  plans?: Plan[],
): string {
  const plan = findCheckoutPlan(planName, plans);
  const billingMode = billing as BillingMode;
  return plan.pricing[billingMode]?.price ?? '—';
}
