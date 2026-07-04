import type { Plan } from '@/lib/checkout-plans';

export const HOME_PLAN_CTA: Record<string, string> = {
  Starter: 'Dùng thử 3 giờ miễn phí',
  Pro: 'Chọn Pro',
  Studio: 'Chọn Studio',
};

export function planButtonClass(plan: Plan): string {
  if (plan.featured) return 'btn btn-primary btn-full plan-cta';
  if (plan.name === 'Studio') return 'btn btn-outline-purple btn-full plan-cta';
  return 'btn btn-secondary btn-full plan-cta';
}
