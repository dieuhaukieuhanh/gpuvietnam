import type { BillingMode } from '@/lib/checkout-plans';

export type GpuComboConfig = {
  hours: number;
  bonus: number;
  days: number;
  price: number;
};

export type GpuPlanConfig = {
  planKey: 'starter' | 'pro' | 'studio';
  name: string;
  icon: string;
  tagline: string;
  featured: boolean;
  badge: string | null;
  accent: string;
  gpu: string;
  vram: string;
  gpuLabel: string;
  pricePerHour: number;
  combo1: GpuComboConfig;
  combo2: GpuComboConfig;
  bestForAudience: { icon: string; label: string }[];
  bestFor: string[];
  notFor: string | null;
  features: { text: string; included: boolean }[];
  trustTitle?: string | null;
  trust: string[];
  upgradeTitle?: string | null;
  upgradeIntro?: string | null;
  upgradeItems?: string[];
  upgradeFooter?: string | null;
  cta: string;
};

export type GpuPricingConfig = {
  version: number;
  billingValidity: {
    hourlyDays: number;
  };
  section: {
    title: string;
    subtitle: string;
    footerPaymentNote: string;
  };
  billingToggles: { mode: BillingMode; label: string }[];
  plans: GpuPlanConfig[];
  /** Render an toàn (dual-run) — hệ số giá so với 1 GPU. */
  dualRun: {
    /** Ví dụ 1.5 hoặc 1.65 — khách trả = giá phiên đơn × hệ số này. */
    customerMultiplier: number;
    /** Trần cứng (mặc định 1.9). */
    hardCapMultiplier: number;
    multiplierMin?: number;
    multiplierMax?: number;
  };
};
