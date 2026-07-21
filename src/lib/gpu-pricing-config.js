import { DEFAULT_GPU_PRICING_CONFIG, DEFAULT_BILLING_VALIDITY, getDefaultGpuPricingConfig } from '@/lib/gpu-pricing-defaults';
import { applyRuntimeBillingValidity, applyRuntimeGpuPlans, formatCurrency } from '@/lib/gpu-pricing';
import { normalizeDualRunBilling } from '@/lib/cp-runtime/dual-run-policy';

const PLAN_KEYS = ['starter', 'pro', 'studio'];
const BILLING_MODES = ['hourly', 'combo1', 'combo2'];

/** Giá trị thời hạn canonical — áp dụng cho mọi DB config (thống nhất 60/120/180). */
const CANONICAL_VALIDITY_DAYS = {
  hourly: DEFAULT_BILLING_VALIDITY.hourlyDays,
  combo1: DEFAULT_BILLING_VALIDITY.combo1Days,
  combo2: DEFAULT_BILLING_VALIDITY.combo2Days,
};

function enforceCanonicalValidity(config) {
  const plans = config.plans.map((plan) => ({
    ...plan,
    combo1: { ...plan.combo1, days: CANONICAL_VALIDITY_DAYS.combo1 },
    combo2: { ...plan.combo2, days: CANONICAL_VALIDITY_DAYS.combo2 },
  }));
  return {
    ...config,
    billingValidity: { hourlyDays: CANONICAL_VALIDITY_DAYS.hourly },
    plans,
  };
}

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

/** Rewrite older pricing-card copy so live DB configs pick up current wording. */
const LEGACY_PRICING_COPY = {
  'File tự sync Google Drive khi tắt':
    'SSD 50GB · Auto Backup 100GB (Outputs mỗi 10 phút • Workflows mỗi 20 phút)',
  'Không mất file khi tắt máy — tự sync Drive':
    'Không mất file — Auto Backup 100GB khi chạy phiên',
  'Không mất file — Auto Backup 10GB khi chạy phiên':
    'Không mất file — Auto Backup 100GB khi chạy phiên',
  'Lưu trữ mặc định 20GB & tùy chọn mở rộng':
    'SSD 80GB · Auto Backup 150GB (Outputs mỗi 3 phút • Workflows mỗi 10 phút)',
  'Lưu trữ mặc định 50GB & tùy chọn mở rộng':
    'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
  'Batch lớn, deadline gắt': 'Batch lớn, deadline gấp',
  'RTX 4090 — 24GB VRAM, nhanh gấp 2.5 lần — tối ưu cho video & batch ảnh lớn':
    'RTX 4090 — 24GB VRAM, nhanh hơn RTX 3090 rõ rệt — tối ưu cho video & batch ảnh lớn',
  'Nhanh hơn RTX 3090 gấp 2.5 lần — tiết kiệm thời gian, nhận nhiều đơn hơn':
    'Nhanh hơn RTX 3090 rõ rệt — tiết kiệm thời gian, nhận nhiều đơn hơn',
  '24GB VRAM — Flux.1, upscale 4K không bao giờ báo hết bộ nhớ':
    '24GB VRAM — Flux.1 và upscale 4K với headroom tốt hơn Starter',
  'Cần tốc độ cao cho video AI hoặc batch ảnh lớn (gói Pro nhanh gấp 2.5 lần)':
    'Cần tốc độ cao cho video AI hoặc batch ảnh lớn — Pro nhanh hơn rõ rệt so với RTX 3090',
  'Toàn bộ tính năng AI Starter': 'Toàn bộ tính năng của Starter',
  'Toàn bộ tính năng của AI Starter': 'Toàn bộ tính năng của Starter',
  'Toàn bộ tính năng của AI Pro': 'Toàn bộ tính năng của Pro',
  'Auto Backup 10GB (Outputs mỗi 15 phút · Workflows mỗi 30 phút)':
    'SSD 50GB · Auto Backup 100GB (Outputs mỗi 10 phút • Workflows mỗi 20 phút)',
  'Auto Backup 10GB · outputs 15′ / workflows 30′':
    'SSD 50GB · Auto Backup 100GB (Outputs mỗi 10 phút • Workflows mỗi 20 phút)',
  'Auto Backup 100GB · Outputs mỗi 3 phút · Workflows mỗi 10 phút':
    'SSD 80GB · Auto Backup 150GB (Outputs mỗi 3 phút • Workflows mỗi 10 phút)',
  'Auto Backup 100GB · outputs 3′ / workflows 10′':
    'SSD 80GB · Auto Backup 150GB (Outputs mỗi 3 phút • Workflows mỗi 10 phút)',
  'Auto Backup 100GB · Outputs mỗi 1 phút · Workflows mỗi 5 phút':
    'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
  'Auto Backup 200GB · Outputs mỗi 1 phút · Workflows mỗi 5 phút':
    'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
  'Auto Backup 200GB • Outputs mỗi 1 phút • Workflows mỗi 5 phút':
    'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
  'Auto Backup 200GB · outputs 1′ / workflows 5′':
    'SSD 120GB · Auto Backup 200GB (Outputs mỗi 1 phút • Workflows mỗi 5 phút)',
};

function rewriteLegacyPricingCopy(text) {
  if (typeof text !== 'string') return text;
  return LEGACY_PRICING_COPY[text] ?? text;
}

/**
 * Starter: drop redundant "Lưu trữ cố định*" — SSD + Auto Backup already cover entitlement.
 * @param {{ text: string; included: boolean }[]} features
 */
function scrubStarterFeatures(features) {
  return features.filter((f) => !/^Lưu trữ cố định/i.test(String(f?.text ?? '')));
}

function scrubSupportFeatures(features) {
  return features.filter((f) => !/^Hỗ trợ kỹ thuật/i.test(String(f?.text ?? '')));
}

function normalizeAudienceItem(raw, fallback) {
  return {
    icon: asNonEmptyString(raw?.icon, fallback?.icon ?? '•'),
    label: rewriteLegacyPricingCopy(asNonEmptyString(raw?.label, fallback?.label ?? '—')),
  };
}

function normalizeFeatureItem(raw, fallback) {
  return {
    text: rewriteLegacyPricingCopy(asNonEmptyString(raw?.text, fallback?.text ?? '—')),
    included: raw?.included !== undefined ? Boolean(raw.included) : Boolean(fallback?.included),
  };
}

function normalizeBillingValidity(raw, fallback) {
  return {
    hourlyDays: asPositiveInt(raw?.hourlyDays, fallback.hourlyDays),
  };
}

export function buildBillingToggleLabels(config) {
  const ref = config.plans.find((plan) => plan.planKey === 'starter') ?? config.plans[0];

  return BILLING_MODES.map((mode) => {
    if (mode === 'hourly') {
      return { mode, label: `Theo giờ thực tế ▪ ${CANONICAL_VALIDITY_DAYS.hourly} ngày` };
    }
    if (mode === 'combo1') {
      return {
        mode,
        label: `Combo1: ${ref.combo1.hours}h+${ref.combo1.bonus}h ▪ ${CANONICAL_VALIDITY_DAYS.combo1} ngày`,
      };
    }
    return {
      mode,
      label: `Combo2: ${ref.combo2.hours}h+${ref.combo2.bonus}h ▪ ${CANONICAL_VALIDITY_DAYS.combo2} ngày`,
    };
  });
}

function looksLikeLegacyStudioTeamCopy(raw) {
  const name = String(raw?.name ?? '');
  if (/^AI\s+Studio$/i.test(name)) return true;
  const blob = JSON.stringify(raw ?? {});
  return /tối đa 5|Workspace riêng biệt|mỗi người 1 GPU|đội nhóm|2–5 người|Agency\/Team|làm việc nhóm với workspace|dual-?gpu|2\s*[×x]\s*RTX\s*4090|48GB VRAM|Dual 4090|Toàn bộ tính năng của AI Pro|Một phiên ComfyUI riêng|Backup dày hơn Pro|RTX 5090 cho production AI nặng|Video AI dài \/ nặng|Train LoRA \/ fine-tune|Auto Backup 100GB · Outputs mỗi 1|Auto Backup 200GB · Outputs mỗi 1|Auto Backup 200GB • Outputs mỗi 1|Chọn AI Studio|Vì sao chọn AI Studio|32GB VRAM liền|Hỗ trợ kỹ thuật ưu tiên(?! qua)/i.test(
    blob,
  );
}

/** Old Starter marketing — refresh copy from defaults (keep Admin prices). */
function looksLikeLegacyStarterCopy(raw) {
  const name = String(raw?.name ?? '');
  if (/^AI\s+Starter$/i.test(name)) return true;
  const blob = JSON.stringify(raw ?? {});
  return /Khởi đầu hành trình AI Art|Freelancer mới bắt đầu|Tốc độ cao như RTX 4090|Lưu trữ cố định|Sáng tạo ảnh SDXL chất lượng cao|Chọn AI Starter|Vì sao chọn AI Starter|Hỗ trợ Zalo khi gặp lỗi|Auto Backup 10GB|Outputs mỗi 15 phút|Workflows mỗi 30 phút/i.test(
    blob,
  );
}

/** Old Pro marketing — refresh copy from defaults (keep Admin prices). */
function looksLikeLegacyProCopy(raw) {
  const name = String(raw?.name ?? '');
  if (/^AI\s+Pro$/i.test(name)) return true;
  const blob = JSON.stringify(raw ?? {});
  return /Dành cho người sáng tạo AI làm việc mỗi ngày|Freelancer AI Art vận hành hàng ngày|Người bán ảnh|Làm video AI|Flux\.1 full-quality|nhanh gấp 2\.5|không bao giờ báo hết|Toàn bộ tính năng của AI Starter|Đổi phiên không mất model|Chọn AI Pro|Vì sao chọn AI Pro|Khi nào nên nâng cấp lên AI Studio|tốc độ xử lý cao hơn RTX 3090|Người muốn hoàn thành nhiều công việc hơn|Nhà sáng tạo nội dung · Người làm AI toàn thời gian|Hỗ trợ kỹ thuật ưu tiên qua Zalo|Auto Backup 100GB · Outputs mỗi 3|Auto Backup 100GB · outputs 3/i.test(
    blob,
  );
}

const PLAN_DISPLAY_NAME_ALIASES = {
  'AI Starter': 'Starter',
  'AI Pro': 'Pro',
  'AI Studio': 'Studio',
};

function normalizePlanDisplayName(raw, fallback) {
  const text = asNonEmptyString(raw, fallback);
  return PLAN_DISPLAY_NAME_ALIASES[text] ?? text;
}

function copyMarketingFieldsFromFallback(plan, fallback) {
  return {
    ...plan,
    name: fallback.name,
    icon: fallback.icon,
    tagline: fallback.tagline,
    gpu: fallback.gpu,
    vram: fallback.vram,
    gpuLabel: fallback.gpuLabel,
    bestForAudience: fallback.bestForAudience.map((a) => ({ ...a })),
    bestFor: [...fallback.bestFor],
    notFor: fallback.notFor,
    features: fallback.features.map((f) => ({ ...f })),
    trustTitle: fallback.trustTitle ?? null,
    trust: [...fallback.trust],
    upgradeTitle: fallback.upgradeTitle ?? null,
    upgradeIntro: fallback.upgradeIntro ?? null,
    upgradeItems: [...(fallback.upgradeItems ?? [])],
    upgradeFooter: fallback.upgradeFooter ?? null,
    cta: fallback.cta,
  };
}

function normalizeNullableString(raw, fallback) {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return fallback ?? null;
}

function normalizeStringList(raw, fallback) {
  const source = Array.isArray(raw) ? raw : fallback;
  if (!Array.isArray(source)) return [];
  return source.map((item, index) =>
    asNonEmptyString(item, Array.isArray(fallback) ? fallback[index] ?? '—' : '—'),
  );
}

function normalizePlan(raw, fallback) {
  const plan = {
    planKey: fallback.planKey,
    name: normalizePlanDisplayName(raw?.name, fallback.name),
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
        : rewriteLegacyPricingCopy(asNonEmptyString(raw?.notFor, fallback.notFor ?? '')),
    features: (raw?.features ?? fallback.features).map((item, index) =>
      normalizeFeatureItem(item, fallback.features[index]),
    ),
    trustTitle: normalizeNullableString(raw?.trustTitle, fallback.trustTitle ?? null),
    trust: (raw?.trust ?? fallback.trust).map((item, index) =>
      rewriteLegacyPricingCopy(asNonEmptyString(item, fallback.trust[index] ?? '—')),
    ),
    // Marketing “Khi nào nên…” removed from all plan cards.
    upgradeTitle: null,
    upgradeIntro: null,
    upgradeItems: [],
    upgradeFooter: null,
    cta: asNonEmptyString(raw?.cta, fallback.cta),
  };

  if (fallback.planKey === 'starter') {
    plan.features = scrubStarterFeatures(plan.features);
  }

  if (fallback.planKey === 'pro' || fallback.planKey === 'studio') {
    plan.features = scrubSupportFeatures(plan.features);
  }

  if (fallback.planKey === 'starter' && looksLikeLegacyStarterCopy(raw)) {
    return copyMarketingFieldsFromFallback(plan, fallback);
  }

  if (fallback.planKey === 'pro' && looksLikeLegacyProCopy(raw)) {
    return copyMarketingFieldsFromFallback(plan, fallback);
  }

  // Studio used to claim multi-seat / dual-4090 — refresh marketing fields from defaults.
  if (fallback.planKey === 'studio' && looksLikeLegacyStudioTeamCopy(raw)) {
    return copyMarketingFieldsFromFallback(plan, fallback);
  }

  return plan;
}

/** Hợp nhất config DB với mặc định, loại bỏ field lạ. */
export function normalizeGpuPricingConfig(raw) {
  const defaults = getDefaultGpuPricingConfig();
  const source = raw && typeof raw === 'object' ? raw : {};

  const billingValidity = normalizeBillingValidity(source.billingValidity, defaults.billingValidity);

  const plans = PLAN_KEYS.map((planKey, index) => {
    const fallback = defaults.plans[index];
    const item = (source.plans ?? []).find((p) => p?.planKey === planKey) ?? source.plans?.[index];
    return normalizePlan(item ?? {}, fallback);
  });

  const billingToggles = buildBillingToggleLabels({ billingValidity, plans });

  return enforceCanonicalValidity({
    version: 1,
    billingValidity,
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
    dualRun: normalizeDualRunBilling(source.dualRun ?? defaults.dualRun),
  });
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

function buildHourlyNote(plan, hourlyDays) {
  return `Trả theo giờ thực dùng · Hiệu lực ${hourlyDays} ngày · ${plan.gpu} ${plan.vram}`;
}

function buildComboNote(combo, billingMode) {
  const days = billingMode === 'combo1' ? CANONICAL_VALIDITY_DAYS.combo1 : CANONICAL_VALIDITY_DAYS.combo2;
  return `${combo.hours} giờ + tặng ${combo.bonus} giờ · Hiệu lực ${days} ngày`;
}

export function buildPlanPricingDisplayFromPlan(plan, hourlyDays = CANONICAL_VALIDITY_DAYS.hourly) {
  return {
    hourly: {
      price: formatCurrency(plan.pricePerHour),
      unit: '/giờ',
      note: buildHourlyNote(plan, hourlyDays),
    },
    combo1: {
      price: formatCurrency(plan.combo1.price),
      unit: '',
      note: buildComboNote(plan.combo1, 'combo1'),
    },
    combo2: {
      price: formatCurrency(plan.combo2.price),
      unit: '',
      note: buildComboNote(plan.combo2, 'combo2'),
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
    pricing: buildPlanPricingDisplayFromPlan(plan, normalized.billingValidity.hourlyDays),
    features: plan.features,
    trustTitle: plan.trustTitle ?? undefined,
    trust: plan.trust,
    upgradeTitle: plan.upgradeTitle ?? undefined,
    upgradeIntro: plan.upgradeIntro ?? undefined,
    upgradeItems: plan.upgradeItems?.length ? plan.upgradeItems : undefined,
    upgradeFooter: plan.upgradeFooter ?? undefined,
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
  applyRuntimeBillingValidity(normalized.billingValidity);
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

export { DEFAULT_GPU_PRICING_CONFIG, getDefaultGpuPricingConfig, PLAN_KEYS, BILLING_MODES, CANONICAL_VALIDITY_DAYS };
