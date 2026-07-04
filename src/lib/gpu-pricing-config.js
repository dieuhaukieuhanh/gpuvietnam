import { DEFAULT_GPU_PRICING_CONFIG, getDefaultGpuPricingConfig } from '@/lib/gpu-pricing-defaults';
import { applyRuntimeGpuPlans, formatCurrency } from '@/lib/gpu-pricing';

const PLAN_KEYS = ['starter', 'pro', 'studio'];
const BILLING_MODES = ['hourly', 'combo1', 'combo2'];

let cachedConfig = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function asNonEmptyString(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function asPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.round(num);
}

function normalizeCombo(raw, fallback) {
  return {
    hours: asPositiveInt(raw?.hours, fallback.hours),
    bonus: asPositiveInt(raw?.bonus, fallback.bonus),
    days: asPositiveInt(raw?.days, fallback.days),
    price: asPositiveInt(raw?.price, fallback.price),
  };
}

function normalizeAudienceItem(raw, fallback) {
  return {
    icon: asNonEmptyString(raw?.icon, fallback?.icon ?? '•'),
    label: asNonEmptyString(raw?.label, fallback?.label ?? '—'),
  };
}

function normalizeFeatureItem(raw, fallback) {
  return {
    text: asNonEmptyString(raw?.text, fallback?.text ?? '—'),
    included: raw?.included !== undefined ? Boolean(raw.included) : Boolean(fallback?.included),
  };
}

function normalizePlan(raw, fallback) {
  return {
    planKey: fallback.planKey,
    name: asNonEmptyString(raw?.name, fallback.name),
    icon: asNonEmptyString(raw?.icon, fallback.icon),
    tagline: asNonEmptyString(raw?.tagline, fallback.tagline),
    featured: raw?.featured !== undefined ? Boolean(raw.featured) : fallback.featured,
    badge: raw?.badge === null || raw?.badge === '' ? null : asNonEmptyString(raw?.badge, fallback.badge),
    accent: asNonEmptyString(raw?.accent, fallback.accent),
    gpu: asNonEmptyString(raw?.gpu, fallback.gpu),
    vram: asNonEmptyString(raw?.vram, fallback.vram),
    gpuLabel: asNonEmptyString(raw?.gpuLabel, fallback.gpuLabel),
    pricePerHour: asPositiveInt(raw?.pricePerHour, fallback.pricePerHour),
    combo1: normalizeCombo(raw?.combo1, fallback.combo1),
    combo2: normalizeCombo(raw?.combo2, fallback.combo2),
    bestForAudience: (raw?.bestForAudience ?? fallback.bestForAudience).map((item, index) =>
      normalizeAudienceItem(item, fallback.bestForAudience[index]),
    ),
    bestFor: (raw?.bestFor ?? fallback.bestFor).map((item, index) =>
      asNonEmptyString(item, fallback.bestFor[index] ?? '—'),
    ),
    notFor:
      raw?.notFor === null || raw?.notFor === ''
        ? null
        : asNonEmptyString(raw?.notFor, fallback.notFor ?? ''),
    features: (raw?.features ?? fallback.features).map((item, index) =>
      normalizeFeatureItem(item, fallback.features[index]),
    ),
    trust: (raw?.trust ?? fallback.trust).map((item, index) =>
      asNonEmptyString(item, fallback.trust[index] ?? '—'),
    ),
    cta: asNonEmptyString(raw?.cta, fallback.cta),
  };
}

/** Hợp nhất config DB với mặc định, loại bỏ field lạ. */
export function normalizeGpuPricingConfig(raw) {
  const defaults = getDefaultGpuPricingConfig();
  const source = raw && typeof raw === 'object' ? raw : {};

  const billingToggles = BILLING_MODES.map((mode, index) => {
    const fallback = defaults.billingToggles[index];
    const item = (source.billingToggles ?? []).find((t) => t?.mode === mode) ?? source.billingToggles?.[index];
    return {
      mode,
      label: asNonEmptyString(item?.label, fallback.label),
    };
  });

  const plans = PLAN_KEYS.map((planKey, index) => {
    const fallback = defaults.plans[index];
    const item = (source.plans ?? []).find((p) => p?.planKey === planKey) ?? source.plans?.[index];
    return normalizePlan(item ?? {}, fallback);
  });

  return {
    version: 1,
    section: {
      title: asNonEmptyString(source.section?.title, defaults.section.title),
      subtitle: asNonEmptyString(source.section?.subtitle, defaults.section.subtitle),
      footerPaymentNote: asNonEmptyString(
        source.section?.footerPaymentNote,
        defaults.section.footerPaymentNote,
      ),
    },
    billingToggles,
    plans,
  };
}

export function buildGpuPlansObject(config) {
  const normalized = normalizeGpuPricingConfig(config);
  const plans = {};

  for (const plan of normalized.plans) {
    const entry = {
      name: plan.name,
      gpu: plan.gpu,
      vram: plan.vram,
      price_per_hour: plan.pricePerHour,
      combo1: { ...plan.combo1 },
      combo2: { ...plan.combo2 },
    };
    if (plan.badge) entry.badge = plan.badge;
    plans[plan.planKey] = entry;
  }

  return plans;
}

function buildHourlyNote(plan) {
  return `Trả theo giờ thực dùng · ${plan.gpu} ${plan.vram}`;
}

function buildComboNote(combo) {
  return `${combo.hours} giờ + tặng ${combo.bonus} giờ · Hiệu lực ${combo.days} ngày`;
}

export function buildPlanPricingDisplayFromPlan(plan) {
  return {
    hourly: {
      price: formatCurrency(plan.pricePerHour),
      unit: '/giờ',
      note: buildHourlyNote(plan),
    },
    combo1: {
      price: formatCurrency(plan.combo1.price),
      unit: '',
      note: buildComboNote(plan.combo1),
    },
    combo2: {
      price: formatCurrency(plan.combo2.price),
      unit: '',
      note: buildComboNote(plan.combo2),
    },
  };
}

export function buildCheckoutPlansFromConfig(config) {
  const normalized = normalizeGpuPricingConfig(config);

  return normalized.plans.map((plan) => ({
    name: plan.name,
    icon: plan.icon,
    tagline: plan.tagline,
    bestForAudience: plan.bestForAudience,
    bestFor: plan.bestFor,
    notFor: plan.notFor ?? undefined,
    gpuLabel: plan.gpuLabel,
    pricing: buildPlanPricingDisplayFromPlan(plan),
    features: plan.features,
    trust: plan.trust,
    cta: plan.cta,
    featured: plan.featured,
    accent: plan.accent,
    badge: plan.badge,
    planKey: plan.planKey,
  }));
}

export function applyGpuPricingFromConfig(config) {
  const normalized = normalizeGpuPricingConfig(config);
  applyRuntimeGpuPlans(buildGpuPlansObject(normalized));
  cachedConfig = normalized;
  cacheLoadedAt = Date.now();
  return normalized;
}

export function clearGpuPricingCache() {
  cachedConfig = null;
  cacheLoadedAt = 0;
}

export async function loadGpuPricingConfig(supabaseAdmin, { force = false } = {}) {
  if (!force && cachedConfig && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('gpu_pricing_config')
      .select('config, updated_at')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;

    const config = data?.config
      ? normalizeGpuPricingConfig(data.config)
      : getDefaultGpuPricingConfig();

    return applyGpuPricingFromConfig(config);
  } catch {
    return applyGpuPricingFromConfig(getDefaultGpuPricingConfig());
  }
}

export async function saveGpuPricingConfig(supabaseAdmin, config) {
  const normalized = normalizeGpuPricingConfig(config);

  const { data, error } = await supabaseAdmin
    .from('gpu_pricing_config')
    .upsert({ id: 1, config: normalized }, { onConflict: 'id' })
    .select('config, updated_at')
    .single();

  if (error) throw error;

  clearGpuPricingCache();
  applyGpuPricingFromConfig(data.config);
  return { config: normalizeGpuPricingConfig(data.config), updatedAt: data.updated_at };
}

export async function ensureGpuPricingLoaded(supabaseAdmin) {
  return loadGpuPricingConfig(supabaseAdmin);
}

export { DEFAULT_GPU_PRICING_CONFIG, getDefaultGpuPricingConfig, PLAN_KEYS, BILLING_MODES };
