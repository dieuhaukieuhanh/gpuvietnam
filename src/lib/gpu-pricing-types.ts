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
  trust: string[];
  cta: string;
};

export type GpuPricingConfig = {
  version: number;
  section: {
    title: string;
    subtitle: string;
    footerPaymentNote: string;
  };
  billingToggles: { mode: BillingMode; label: string }[];
  plans: GpuPlanConfig[];
};
