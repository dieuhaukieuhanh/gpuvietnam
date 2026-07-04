import {
  buildCheckoutPlansFromConfig,
  getDefaultGpuPricingConfig,
  loadGpuPricingConfig,
} from '@/lib/gpu-pricing-config';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Cấu hình bảng giá GPU (public).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const config = await loadGpuPricingConfig(supabaseAdmin);
    const plans = buildCheckoutPlansFromConfig(config);

    return res.status(200).json({
      config,
      plans,
      billingToggles: config.billingToggles,
      section: config.section,
    });
  } catch (err) {
    const fallback = getDefaultGpuPricingConfig();
    return res.status(200).json({
      config: fallback,
      plans: buildCheckoutPlansFromConfig(fallback),
      billingToggles: fallback.billingToggles,
      section: fallback.section,
    });
  }
}
