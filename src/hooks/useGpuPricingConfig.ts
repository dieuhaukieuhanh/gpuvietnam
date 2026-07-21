import { useCallback, useEffect, useState } from 'react';
import {
  applyGpuPricingFromConfig,
  buildCheckoutPlansFromConfig,
  getDefaultGpuPricingConfig,
} from '@/lib/gpu-pricing-config';
import type { GpuPricingConfig } from '@/lib/gpu-pricing-types';
import type { BillingMode, Plan } from '@/lib/checkout-plans';

export type { GpuPricingConfig };

export type GpuCheckoutPlan = Plan;

type GpuPricingResponse = {
  config: GpuPricingConfig;
  plans: GpuCheckoutPlan[];
  billingToggles: GpuPricingConfig['billingToggles'];
  section: GpuPricingConfig['section'];
};

export function useGpuPricingConfig() {
  const [config, setConfig] = useState<GpuPricingConfig | null>(null);
  const [plans, setPlans] = useState<GpuCheckoutPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/gpu-pricing');
      const data = (await res.json()) as GpuPricingResponse & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? 'Không tải được bảng giá.');
      }

      const normalized = applyGpuPricingFromConfig(data.config) as GpuPricingConfig;
      setConfig(normalized);
      setPlans(data.plans ?? buildCheckoutPlansFromConfig(normalized));
    } catch (err) {
      const fallback = applyGpuPricingFromConfig(
        getDefaultGpuPricingConfig(),
      ) as GpuPricingConfig;
      setConfig(fallback);
      setPlans(buildCheckoutPlansFromConfig(fallback));
      setError(err instanceof Error ? err.message : 'Không tải được bảng giá.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const billingToggles =
    (config?.billingToggles as GpuPricingConfig['billingToggles'] | undefined) ??
    (getDefaultGpuPricingConfig() as GpuPricingConfig).billingToggles;
  const section =
    config?.section ?? (getDefaultGpuPricingConfig() as GpuPricingConfig).section;

  return {
    config,
    plans,
    billingToggles,
    section,
    loading,
    error,
    reload: load,
  };
}

export type { BillingMode };
