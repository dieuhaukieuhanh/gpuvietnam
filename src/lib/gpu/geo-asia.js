/**
 * Unified Asia geolocation detection for Vast.ai GPU offers.
 *
 * The Vast.ai `geolocation` field has no fixed format: it can be a bare
 * country code ("TW"), "City, CC" ("Taipei, TW"), "Country, CC"
 * ("Taiwan, TW"), just a country name ("Hong Kong"), or just a city
 * ("Bangkok"). Matching only a 2-letter suffix misses most of these.
 *
 * Logic: lowercase the whole `geolocation` string and check whether it
 * CONTAINS any known Asia keyword (country code, country/territory name,
 * or major city name) - no assumption about where in the string it sits.
 * This single implementation is the source of truth for every place in the
 * codebase that needs to know "is this offer in Asia?" (customer machine
 * selection, admin infrastructure pricing table, selection logging, ...).
 */

/**
 * Canonical Asia regions with every keyword (country code, country name,
 * major cities) that can identify them inside a raw `geolocation` string.
 * @type {Array<{ region: string; keywords: string[] }>}
 */
const ASIA_REGION_KEYWORD_GROUPS = [
  {
    region: 'Taiwan',
    keywords: ['tw', 'twn', 'taiwan', 'taipei', 'taichung', 'kaohsiung', 'hsinchu'],
  },
  {
    region: 'Japan',
    keywords: ['jp', 'jpn', 'japan', 'tokyo', 'osaka', 'nagoya', 'yokohama', 'fukuoka', 'sapporo'],
  },
  {
    region: 'Singapore',
    keywords: ['sg', 'sgp', 'singapore'],
  },
  {
    region: 'Hong Kong',
    keywords: ['hk', 'hkg', 'hong kong', 'hongkong', 'hong-kong'],
  },
  {
    region: 'South Korea',
    keywords: [
      'kr',
      'kor',
      'rok',
      'south korea',
      'southkorea',
      's. korea',
      's korea',
      'korea',
      'seoul',
      'busan',
      'incheon',
    ],
  },
  {
    region: 'Thailand',
    keywords: ['th', 'tha', 'thailand', 'bangkok', 'chiang mai', 'phuket'],
  },
  {
    region: 'Malaysia',
    keywords: ['my', 'mys', 'malaysia', 'kuala lumpur', 'kl', 'penang', 'johor', 'selangor'],
  },
  {
    region: 'Indonesia',
    keywords: ['id', 'idn', 'indonesia', 'jakarta', 'surabaya', 'bandung', 'bali'],
  },
  {
    region: 'Vietnam',
    keywords: [
      'vn',
      'vnm',
      'vietnam',
      'viet nam',
      'hanoi',
      'ha noi',
      'ho chi minh',
      'hochiminh',
      'saigon',
      'sai gon',
      'danang',
      'da nang',
    ],
  },
  {
    region: 'Philippines',
    keywords: ['ph', 'phl', 'philippines', 'manila', 'cebu', 'quezon'],
  },
  {
    region: 'China',
    keywords: [
      'cn',
      'chn',
      'prc',
      'china',
      'shanghai',
      'beijing',
      'shenzhen',
      'guangzhou',
      'hangzhou',
      'chengdu',
      'wuhan',
      'nanjing',
      'suzhou',
      'tianjin',
      'chongqing',
    ],
  },
  {
    region: 'India',
    keywords: [
      'in',
      'ind',
      'india',
      'mumbai',
      'delhi',
      'new delhi',
      'bangalore',
      'bengaluru',
      'hyderabad',
      'chennai',
      'pune',
      'kolkata',
      'gurgaon',
      'noida',
    ],
  },
  {
    region: 'Macau',
    keywords: ['mo', 'mac', 'macau', 'macao'],
  },
  {
    region: 'Cambodia',
    keywords: ['kh', 'khm', 'cambodia', 'phnom penh'],
  },
  {
    region: 'Laos',
    keywords: ['la', 'lao', 'laos', 'vientiane'],
  },
  {
    region: 'Myanmar',
    keywords: ['mm', 'mmr', 'myanmar', 'burma', 'yangon', 'rangoon'],
  },
  {
    region: 'Bangladesh',
    keywords: ['bd', 'bgd', 'bangladesh', 'dhaka'],
  },
  {
    region: 'Pakistan',
    keywords: ['pk', 'pak', 'pakistan', 'karachi', 'lahore', 'islamabad'],
  },
  {
    region: 'Sri Lanka',
    keywords: ['lk', 'lka', 'sri lanka', 'srilanka', 'colombo'],
  },
  {
    region: 'Nepal',
    keywords: ['np', 'npl', 'nepal', 'kathmandu'],
  },
  {
    region: 'Mongolia',
    keywords: ['mn', 'mng', 'mongolia', 'ulaanbaatar'],
  },
  {
    region: 'Brunei',
    keywords: ['bn', 'brn', 'brunei'],
  },
  {
    region: 'Kazakhstan',
    keywords: ['kz', 'kaz', 'kazakhstan', 'almaty', 'astana'],
  },
  {
    region: 'Uzbekistan',
    keywords: ['uz', 'uzb', 'uzbekistan', 'tashkent'],
  },
  {
    region: 'United Arab Emirates',
    keywords: ['ae', 'are', 'uae', 'united arab emirates', 'dubai', 'abu dhabi', 'abudhabi'],
  },
  {
    region: 'Saudi Arabia',
    keywords: ['sa', 'sau', 'saudi', 'saudi arabia', 'riyadh', 'jeddah'],
  },
  {
    region: 'Israel',
    keywords: ['il', 'isr', 'israel', 'tel aviv', 'telaviv', 'jerusalem'],
  },
  {
    region: 'Turkey',
    keywords: ['tr', 'tur', 'turkey', 'turkiye', 'istanbul', 'ankara'],
  },
];

/** Flat set of every recognised Asia keyword (country codes + names + cities). */
export const ASIA_GEO_KEYWORDS = new Set(
  ASIA_REGION_KEYWORD_GROUPS.flatMap((group) => group.keywords),
);

/** "Nearby priority" regions used for the first ("asia_preferred") fallback level. */
const PREFERRED_ASIA_REGIONS = new Set(['Taiwan', 'Japan', 'Singapore', 'Hong Kong', 'Thailand']);

/** Keyword subset for the preferred-region fallback level. */
export const PREFERRED_ASIA_GEO_KEYWORDS = new Set(
  ASIA_REGION_KEYWORD_GROUPS.filter((group) => PREFERRED_ASIA_REGIONS.has(group.region)).flatMap(
    (group) => group.keywords,
  ),
);

/** Precompiled word-boundary regexes for the full Asia keyword set. */
const ASIA_GEO_REGEXES = [...ASIA_GEO_KEYWORDS].map((keyword) => toKeywordRegex(keyword));

/** Precompiled word-boundary regexes for the preferred-region keyword subset. */
const PREFERRED_ASIA_GEO_REGEXES = [...PREFERRED_ASIA_GEO_KEYWORDS].map((keyword) =>
  toKeywordRegex(keyword),
);

/**
 * Escapes a keyword for use inside a RegExp (defensive; current keywords are
 * plain letters/spaces only, but this keeps the module safe if extended).
 * @param {string} keyword
 */
function escapeRegExp(keyword) {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a whole-word/whole-phrase matcher for a keyword: matches the
 * keyword ANYWHERE in the string (start, middle, or end - no positional
 * assumption) but only as a standalone token, not embedded inside a larger
 * word. This keeps the "contains" semantics required for offer geolocation
 * strings (e.g. "Taipei, Taiwan, TW") while preventing short 2-letter codes
 * like "th" or "in" from accidentally matching inside unrelated words
 * (e.g. "th" inside "Netherlands", "in" inside "Finland"/"Argentina").
 * @param {string} keyword
 */
function toKeywordRegex(keyword) {
  return new RegExp(`(?:^|[^a-z])${escapeRegExp(keyword)}(?:$|[^a-z])`);
}

/**
 * Keyword → region lookup sorted longest-keyword-first (secondary safety
 * net on top of word-boundary matching, so full names win ties first).
 */
const SORTED_REGION_LOOKUP = ASIA_REGION_KEYWORD_GROUPS.flatMap((group) =>
  group.keywords.map((keyword) => ({ keyword, region: group.region, regex: toKeywordRegex(keyword) })),
).sort((a, b) => b.keyword.length - a.keyword.length);

/** Region score table - GPUVietnam scoring spec (Region = 15% weight). */
export const ASIA_REGION_SCORES = {
  Taiwan: 90,
  Thailand: 85,
  Singapore: 80,
  'Hong Kong': 80,
  Japan: 75,
  'South Korea': 70,
  Indonesia: 65,
  Malaysia: 65,
  India: 65,
};

/** Score applied to Asia regions with no explicit entry above (Vietnam, Philippines, China, Macau, ...). */
export const OTHER_ASIA_REGION_SCORE = 55;

/**
 * @param {unknown} geo
 * @returns {string}
 */
export function normalizeGeo(geo) {
  return String(geo ?? '').trim().toLowerCase();
}

/**
 * @param {string} normalized
 * @param {RegExp[]} regexes
 */
function matchesAnyRegex(normalized, regexes) {
  for (const regex of regexes) {
    if (regex.test(normalized)) return true;
  }
  return false;
}

/**
 * Contains-based Asia detection. Lowercases the geolocation string and
 * checks whether it CONTAINS any recognised Asia keyword as a standalone
 * token - independent of where in the string it sits (start, middle, end).
 * @param {unknown} geo
 * @param {RegExp[]} [regexes] Defaults to the full Asia keyword set.
 * @returns {boolean}
 */
export function isAsianGeolocation(geo, regexes = ASIA_GEO_REGEXES) {
  const normalized = normalizeGeo(geo);
  if (!normalized) return false;
  return matchesAnyRegex(normalized, regexes);
}

/**
 * Nearby-priority Asia detection (Taiwan/Japan/Singapore/Hong Kong/Thailand).
 * @param {unknown} geo
 * @returns {boolean}
 */
export function isPreferredAsianGeolocation(geo) {
  return isAsianGeolocation(geo, PREFERRED_ASIA_GEO_REGEXES);
}

/**
 * Resolves a canonical region label (e.g. "Taiwan") from a raw geolocation
 * string. Matches the longest/most-specific keywords first to avoid short
 * codes accidentally matching inside unrelated names.
 * @param {unknown} geo
 * @returns {string | null}
 */
export function resolveAsiaRegionLabel(geo) {
  const normalized = normalizeGeo(geo);
  if (!normalized) return null;
  for (const { region, regex } of SORTED_REGION_LOOKUP) {
    if (regex.test(normalized)) return region;
  }
  return null;
}

/**
 * Region score used by the GPU offer scoring formula.
 * @param {unknown} geo
 * @returns {number} 0 when the geolocation is not recognised as Asia.
 */
export function getAsiaRegionScore(geo) {
  const region = resolveAsiaRegionLabel(geo);
  if (!region) return 0;
  return ASIA_REGION_SCORES[region] ?? OTHER_ASIA_REGION_SCORE;
}
