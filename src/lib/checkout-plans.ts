import { DEFAULT_BILLING_VALIDITY, getDefaultGpuPricingConfig } from './gpu-pricing-defaults';
import { buildCheckoutPlansFromConfig } from './gpu-pricing-config';

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
  trustTitle?: string;
  trust: string[];
  upgradeTitle?: string;
  upgradeIntro?: string;
  upgradeItems?: string[];
  upgradeFooter?: string;
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
  hourly: `Theo giờ · ${DEFAULT_BILLING_VALIDITY.hourlyDays} ngày`,
  combo1: `Combo1 (100h+10h · ${DEFAULT_BILLING_VALIDITY.combo1Days} ngày)`,
  combo2: `Combo2 (200h+30h · ${DEFAULT_BILLING_VALIDITY.combo2Days} ngày)`,
};

export const BILLING_TOGGLES: { mode: BillingMode; label: string }[] =
  getDefaultGpuPricingConfig().billingToggles as { mode: BillingMode; label: string }[];

/** Fallback checkout cards — live pages prefer `/api/gpu-pricing` via useGpuPricingConfig. */
export const CHECKOUT_PLANS: Plan[] = buildCheckoutPlansFromConfig(
  getDefaultGpuPricingConfig(),
) as Plan[];

export function resolveCheckoutPlans(plans?: Plan[]): Plan[] {
  return plans?.length ? plans : CHECKOUT_PLANS;
}

export function findCheckoutPlan(planName: string, plans?: Plan[]): Plan {
  const list = resolveCheckoutPlans(plans);
  const byName = list.find((p) => p.name === planName);
  if (byName) return byName;
  const normalized = String(planName ?? '').toLowerCase().trim();
  const byKey = list.find((p) => (p.planKey ?? '').toLowerCase() === normalized);
  if (byKey) return byKey;
  const byNameInsensitive = list.find((p) => p.name.toLowerCase() === normalized);
  if (byNameInsensitive) return byNameInsensitive;
  // Legacy URL/query: "Starter" → "AI Starter", "Pro" → "AI Pro"
  if (normalized === 'starter' || normalized === 'ai starter') {
    const starter = list.find((p) => p.planKey === 'starter');
    if (starter) return starter;
  }
  if (normalized === 'pro' || normalized === 'ai pro') {
    const pro = list.find((p) => p.planKey === 'pro');
    if (pro) return pro;
  }
  if (normalized === 'studio' || normalized === 'ai studio') {
    const studio = list.find((p) => p.planKey === 'studio');
    if (studio) return studio;
  }
  return CHECKOUT_PLANS[1];
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
