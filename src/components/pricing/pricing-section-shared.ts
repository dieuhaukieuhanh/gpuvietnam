import type { Plan } from '@/lib/checkout-plans';

export const HOME_PLAN_CTA: Record<string, string> = {
  Starter: 'Dùng thử 3 giờ miễn phí',
  'AI Starter': 'Dùng thử 3 giờ miễn phí',
  Pro: 'Chọn Pro',
  'AI Pro': 'Chọn Pro',
  Studio: 'Chọn Studio',
  'AI Studio': 'Chọn Studio',
};

export function isStarterPlan(plan: Pick<Plan, 'name' | 'planKey'> | string): boolean {
  if (typeof plan === 'string') {
    const lower = plan.trim().toLowerCase();
    return lower === 'starter' || lower === 'ai starter';
  }
  return plan.planKey === 'starter' || isStarterPlan(plan.name);
}

export function isProPlan(plan: Pick<Plan, 'name' | 'planKey'> | string): boolean {
  if (typeof plan === 'string') {
    const lower = plan.trim().toLowerCase();
    return lower === 'pro' || lower === 'ai pro';
  }
  return plan.planKey === 'pro' || isProPlan(plan.name);
}

export function isStudioPlan(plan: Pick<Plan, 'name' | 'planKey'>): boolean {
  return plan.planKey === 'studio' || /^ai\s+studio$/i.test(plan.name) || plan.name === 'Studio';
}

export function planButtonClass(plan: Plan): string {
  if (plan.featured) return 'btn btn-primary btn-full plan-cta';
  if (isStudioPlan(plan)) return 'btn btn-outline-purple btn-full plan-cta';
  return 'btn btn-secondary btn-full plan-cta';
}
