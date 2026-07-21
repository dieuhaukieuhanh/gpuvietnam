import type { CheckoutOrder } from '@/lib/checkout-order';
import { orderToSearchParams } from '@/lib/checkout-order';
import { routes } from '@/lib/routes';
import { WORKSTATIONS } from '@/lib/workstations';

const defaultWorkstation = WORKSTATIONS[0];

export const DEFAULT_CHECKOUT_ENV = {
  name: defaultWorkstation.name,
  icon: defaultWorkstation.icon,
  desc: defaultWorkstation.desc,
};

export function buildLoginRedirectUrl(returnPath: string): string {
  return `${routes.login}?redirect=${encodeURIComponent(returnPath)}`;
}

export function buildCheckoutPlanPaymentUrl(order: Partial<CheckoutOrder>): string {
  const params = orderToSearchParams({
    env: DEFAULT_CHECKOUT_ENV.name,
    icon: DEFAULT_CHECKOUT_ENV.icon,
    desc: DEFAULT_CHECKOUT_ENV.desc,
    ...order,
  });
  return `${routes.checkoutPlan}?${params.toString()}#payment`;
}

export function buildCheckoutEnvUrl(order: Partial<CheckoutOrder>): string {
  const params = orderToSearchParams(order);
  return `${routes.checkout2}?${params.toString()}`;
}

export function buildBangGiaCheckoutUrl(
  plan: string,
  billing: string,
  hours?: number,
  options?: { additional?: boolean },
): string {
  const params = new URLSearchParams({ plan, billing });
  if (billing === 'hourly' && hours != null && hours > 0) {
    params.set('hours', String(Math.floor(hours)));
  }
  if (options?.additional) {
    params.set('additional', '1');
  }
  return `${routes.bangGiaCheckout}?${params.toString()}`;
}
