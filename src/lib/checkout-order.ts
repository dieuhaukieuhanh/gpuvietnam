import type { BillingMode } from '@/lib/checkout-plans';

export type CheckoutOrder = {
  plan: string;
  billing: BillingMode;
  env: string;
  icon: string;
  desc: string;
  email?: string;
  phone?: string;
};

export function orderToSearchParams(order: Partial<CheckoutOrder>): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(order).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

export function parseCheckoutOrder(query: Record<string, string | string[] | undefined>): CheckoutOrder | null {
  const plan = typeof query.plan === 'string' ? query.plan : '';
  const billing = typeof query.billing === 'string' ? query.billing : '';
  const env = typeof query.env === 'string' ? query.env : '';

  if (!plan || !billing || !env) return null;

  const validBilling = ['hourly', 'combo1', 'combo2'].includes(billing);

  return {
    plan,
    billing: (validBilling ? billing : 'hourly') as BillingMode,
    env,
    icon: typeof query.icon === 'string' ? query.icon : '👤',
    desc: typeof query.desc === 'string' ? query.desc : '',
    email: typeof query.email === 'string' ? query.email : undefined,
    phone: typeof query.phone === 'string' ? query.phone : undefined,
  };
}
