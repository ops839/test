// Channel slug -> client display-name resolution.
//
// Strategy: lowercase the channel name, replace separators with spaces, then
// substring-match against an alias list using whole-word boundaries. Aliases
// are sorted by length descending so the longest match wins (so "estate
// lawyers" beats "estate" if both were ever listed).

const RAW_ALIASES = {
  // Active clients (canonical names)
  'infinite renewals': 'Infinite Renewals',
  'infinite-renewals': 'Infinite Renewals',
  'ir': 'Infinite Renewals',
  'accelerated analytics': 'Accelerated Analytics',
  'aa': 'Accelerated Analytics',
  'athena': 'Athena',
  'august health': 'August Health',
  'august': 'August Health',
  'blu sky': 'Blu Sky',
  'blusky': 'Blu Sky',
  'bsr': 'Blu Sky',
  'bushel': 'Bushel',
  'custom gpt': 'Custom GPT',
  'customgpt': 'Custom GPT',
  'cybernut': 'Cybernut',
  'hall street': 'Hall Street',
  'hall-street': 'Hall Street',
  'hall st': 'Hall Street',
  'hallst': 'Hall Street',
  'jencap': 'Jencap',
  'minico': 'MiniCo',
  'maxa designs': 'Maxa Designs',
  'maxa': 'Maxa Designs',
  'milrose': 'Milrose',
  'numa': 'Numa',
  'polar analytics': 'Polar Analytics',
  'polar': 'Polar Analytics',
  'poppins payroll': 'Poppins Payroll',
  'poppins': 'Poppins Payroll',
  'productside': 'Productside',
  'razor metrics': 'Razor Metrics',
  'razor': 'Razor Metrics',
  'rebeliq': 'RebelIQ',
  'rebel iq': 'RebelIQ',
  'select exterminating': 'Select Exterminating',
  'select': 'Select Exterminating',
  'shoplift': 'Shoplift',
  'ssa group': 'SSA Group',
  'ssa': 'SSA Group',
  'simpl': 'Simpl',
  'estate lawyers': 'The Estate Lawyers',
  'tel': 'The Estate Lawyers',
  'transcom': 'Transcom',
  'trnsact': 'Trnsact',
  'wisconsin carports': 'Wisconsin Carports',
  'wi carports': 'Wisconsin Carports',
  'zeitcaster': 'Zeitcaster',
  'innovint': 'InnoVint',
  'pestpac': 'Pestpac',
  'learnedmedia': 'Learned Media',
  'learned media': 'Learned Media',
  'falcon rappaport': 'Falcon Rappaport',
  'frb': 'Falcon Rappaport',
  'radicle': 'Radicle',
  'liger': 'Liger',
};

// Sort entries by alias length descending so longer matches take precedence.
const ALIAS_ENTRIES = Object.entries(RAW_ALIASES).sort(
  (a, b) => b[0].length - a[0].length,
);

// Normalize: lowercase, replace - and _ and . with spaces, collapse whitespace.
export function normalizeChannel(name) {
  return name
    .toLowerCase()
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Whole-word boundary check around a substring match.
function hasWholeWordMatch(haystack, needle) {
  // Build a regex with word boundaries. Escape regex special chars in needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
  return pattern.test(haystack);
}

export function matchClient(channelName) {
  const normalized = normalizeChannel(channelName);
  for (const [alias, client] of ALIAS_ENTRIES) {
    if (hasWholeWordMatch(normalized, alias)) {
      return client;
    }
  }
  return null;
}

export const ALIAS_MAP = RAW_ALIASES;
