/**
 * Pure metric helpers for Admin Ha tang (uptime / ping buckets).
 * Shared by infrastructure-shared.ts and infrastructure-providers.js.
 */

export const UPTIME_THRESHOLD = 98;
export const PING_THRESHOLD_MS = 250;
export const MIN_VRAM_GB = 20;

/** Estimated RTT from Vietnam (ms). Used when provider APIs omit latency. */
export const ESTIMATED_PING_MS_FROM_VN = {
  // Asia
  Vietnam: 25,
  'Viet Nam': 25,
  Singapore: 45,
  Thailand: 55,
  Malaysia: 60,
  'Hong Kong': 70,
  Taiwan: 75,
  Indonesia: 85,
  Philippines: 90,
  Cambodia: 50,
  Laos: 55,
  Macau: 70,
  Brunei: 80,
  Myanmar: 95,
  'South Korea': 120,
  Korea: 120,
  Japan: 130,
  China: 140,
  India: 160,
  Bangladesh: 170,
  'Sri Lanka': 180,
  Nepal: 190,
  Mongolia: 200,
  Pakistan: 210,
  Kazakhstan: 220,
  Uzbekistan: 230,
  'United Arab Emirates': 180,
  'Saudi Arabia': 200,
  Israel: 240,
  Turkey: 240,
  // Oceania
  Australia: 110,
  'New Zealand': 140,
  // Americas
  'United States': 200,
  'US West': 170,
  'US Central': 200,
  'US East': 230,
  Canada: 210,
  Brazil: 240,
  Argentina: 250,
  Mexico: 220,
  // Europe
  'United Kingdom': 220,
  Germany: 230,
  Netherlands: 230,
  France: 230,
  Spain: 240,
  Italy: 240,
  Sweden: 240,
  Norway: 240,
  Finland: 240,
  Poland: 240,
  Czechia: 240,
  Romania: 240,
  Hungary: 240,
  Bulgaria: 240,
  Iceland: 250,
  Portugal: 240,
  Belgium: 230,
  Switzerland: 230,
  Austria: 240,
  Ireland: 230,
  Denmark: 240,
  Russia: 240,
  Ukraine: 240,
};

/** ISO2 / common aliases -> region label used for ping buckets. */
export const GLOBAL_CC_TO_REGION = {
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  DE: 'Germany',
  NL: 'Netherlands',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  SE: 'Sweden',
  NO: 'Norway',
  FI: 'Finland',
  PL: 'Poland',
  CZ: 'Czechia',
  RO: 'Romania',
  HU: 'Hungary',
  BG: 'Bulgaria',
  IS: 'Iceland',
  PT: 'Portugal',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  IE: 'Ireland',
  DK: 'Denmark',
  RU: 'Russia',
  UA: 'Ukraine',
  AU: 'Australia',
  NZ: 'New Zealand',
  MD: 'Romania',
  BY: 'Russia',
  LV: 'Sweden',
  SI: 'Germany',
  HR: 'Germany',
  DO: 'United States',
};

const US_WEST_STATES = new Set([
  'california', 'ca', 'washington', 'wa', 'oregon', 'or', 'nevada', 'nv',
  'arizona', 'az', 'utah', 'ut', 'colorado', 'co', 'montana', 'mt',
  'idaho', 'id', 'wyoming', 'wy', 'alaska', 'ak', 'hawaii', 'hi',
]);
const US_EAST_STATES = new Set([
  'new york', 'ny', 'virginia', 'va', 'maryland', 'md', 'pennsylvania', 'pa',
  'florida', 'fl', 'georgia', 'ga', 'north carolina', 'nc', 'south carolina', 'sc',
  'massachusetts', 'ma', 'new jersey', 'nj', 'ohio', 'oh', 'michigan', 'mi',
  'indiana', 'in', 'illinois', 'il', 'connecticut', 'ct', 'district of columbia', 'dc',
]);

export function normalizeUptimePercent(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value > 1.5) return value;
  return value * 100;
}

export function resolveUptimeBucket(uptimePercent) {
  if (!Number.isFinite(uptimePercent) || uptimePercent < UPTIME_THRESHOLD) return null;
  if (uptimePercent >= 99) return 'gt99';
  if (uptimePercent >= 98.5) return 'btw_985_99';
  return 'btw_98_985';
}

export function resolvePingBucket(pingMs) {
  if (!Number.isFinite(pingMs) || pingMs < 0 || pingMs > PING_THRESHOLD_MS) return null;
  if (pingMs < 50) return 'lt50';
  if (pingMs < 100) return 'btw_50_100';
  if (pingMs < 200) return 'btw_100_200';
  return 'btw_200_250';
}

export function estimatePingMsFromRegion(region) {
  if (!region) return null;
  const direct = ESTIMATED_PING_MS_FROM_VN[region];
  if (Number.isFinite(direct)) return direct;
  const lower = region.trim().toLowerCase();
  for (const [name, ms] of Object.entries(ESTIMATED_PING_MS_FROM_VN)) {
    if (name.toLowerCase() === lower) return ms;
  }
  if (lower.includes('viet') && lower.includes('nam')) return 25;
  if (lower === 'us' || lower.includes('united states')) return 200;
  return null;
}

/**
 * Resolve a marketplace region label from raw geo / country code.
 * Prefers Asia canonical labels; falls back to global ISO2 mapping.
 * @param {unknown} geo
 * @param {(geo: unknown) => string | null} resolveAsiaLabel
 * @returns {string | null}
 */
export function resolveMarketplaceRegionLabel(geo, resolveAsiaLabel) {
  const asia = typeof resolveAsiaLabel === 'function' ? resolveAsiaLabel(geo) : null;
  if (asia) return asia;

  const raw = String(geo ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // "California, US" / ", US" / "US"
  const ccMatch = raw.match(/(?:^|,\s*)([A-Za-z]{2})$/);
  const cc = ccMatch ? ccMatch[1].toUpperCase() : null;

  if (cc === 'US' || lower === 'us' || lower.endsWith(', us')) {
    const statePart = lower.split(',')[0].trim();
    if (statePart && US_WEST_STATES.has(statePart)) return 'US West';
    if (statePart && US_EAST_STATES.has(statePart)) return 'US East';
    if (statePart) return 'US Central';
    return 'United States';
  }

  if (cc && GLOBAL_CC_TO_REGION[cc]) return GLOBAL_CC_TO_REGION[cc];
  if (cc) return cc;

  // Bare country/region names commonly returned by marketplaces
  for (const name of Object.keys(ESTIMATED_PING_MS_FROM_VN)) {
    if (lower === name.toLowerCase() || lower.includes(name.toLowerCase())) return name;
  }

  return null;
}

export function extractPingMs(source) {
  if (!source || typeof source !== 'object') return null;
  const candidates = [
    source.ping,
    source.latency,
    source.rtt,
    source.network_latency,
    source.ping_ms,
    source.latency_ms,
  ];
  const net = source.net;
  if (net && typeof net === 'object') {
    candidates.push(net.ping, net.latency, net.rtt);
  }
  const specs = source.specs;
  if (specs && typeof specs === 'object') {
    const specsNet = specs.net;
    if (specsNet && typeof specsNet === 'object') {
      candidates.push(specsNet.ping, specsNet.latency, specsNet.rtt);
    }
  }
  for (const raw of candidates) {
    if (raw && typeof raw === 'object') {
      const nestedVal = Number(raw.latency ?? raw.ms ?? raw.value ?? raw.avg);
      if (Number.isFinite(nestedVal) && nestedVal > 0) return nestedVal;
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function resolveEffectivePingMs(source, region) {
  const measured = extractPingMs(source);
  if (measured != null) return measured;
  const estimated = estimatePingMsFromRegion(region);
  if (estimated != null) return estimated;
  // Unknown region but still inventory-eligible: assume mid-range RTT from VN.
  return 220;
}

export const UPTIME_BUCKET_LABELS = {
  gt99: '≥ 99%',
  btw_985_99: '98.5% - 99%',
  btw_98_985: '98% - 98.5%',
};

export const PING_BUCKET_LABELS = {
  lt50: '< 50ms',
  btw_50_100: '50 - 100ms',
  btw_100_200: '100 - 200ms',
  btw_200_250: '200 - 250ms',
};
