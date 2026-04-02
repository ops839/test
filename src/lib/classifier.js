/**
 * Classifies meetings as internal/external and extracts client names.
 */

const KNOWN_BM_MEMBERS = new Set([
  'johnny sengelmann', 'johnny',
  'abdallah gaballah', 'abdallah',
  'ahmed amr', 'ahmed',
  'kurt buttress', 'kurt',
  'kareem talaat', 'kareem',
  'salma khaled', 'salma',
  'hala mostafa', 'hala',
  'eman refaey', 'eman',
  'mohamed abuzaid', 'abuzaid',
  'seif muhammed', 'seif',
  'tarek',
  'omar',
  'mohamed nashat', 'nashat',
]);

const ACTIVE_CLIENTS = [
  'Infinite Renewals',
  'Accelerated Analytics',
  'Athena',
  'August Health',
  'Blu Sky',
  'Bushel',
  'Custom GPT',
  'Cybernut',
  'Hall Street',
  'Jencap',
  'MiniCo',
  'Maxa Designs',
  'Milrose',
  'Numa',
  'Polar Analytics',
  'Poppins Payroll',
  'Productside',
  'Razor Metrics',
  'RebelIQ',
  'Select Exterminating',
  'Shoplift',
  'SSA Group',
  'Simpl',
  'The Estate Lawyers',
  'Transcom',
  'Trnsact',
  'Wisconsin Carports',
  'Zeitcaster',
  'InnoVint',
  'Pestpac',
  'Hall St',
  'Learnedmedia',
  'Learned Media',
];

// Pre-sort by length descending so longer names match first
const ACTIVE_CLIENTS_SORTED = [...ACTIVE_CLIENTS].sort((a, b) => b.length - a.length);

export { KNOWN_BM_MEMBERS, ACTIVE_CLIENTS_SORTED };

function isNotetaker(entry) {
  return /notetaker/i.test(entry);
}

function stripParenthetical(entry) {
  return entry.replace(/\s*\(.*\)\s*$/, '').trim();
}

/**
 * Extract company/employer from the parenthetical portion of an attendee entry.
 * Handles: (company.com), (Job Title at Company), (Job Title at Company (FKA old))
 */
function extractCompanyFromParenthetical(entry) {
  const parenMatch = entry.match(/\((.+)\)\s*$/);
  if (!parenMatch) return null;
  const inside = parenMatch[1].trim();

  // "... at Company" or "... at Company (FKA ...)"
  const atMatch = inside.match(/\bat\s+(.+?)(?:\s*\(FKA[^)]*\))?\s*$/i);
  if (atMatch) {
    return atMatch[1].trim();
  }

  // Domain in parens: (word.tld) — convert to display name
  const domainMatch = inside.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,4})$/);
  if (domainMatch) {
    const base = domainMatch[1].split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  // If it's just a short string (company name directly), return it
  if (inside.length < 40 && !/\s{2,}/.test(inside)) {
    return inside;
  }

  return null;
}

function isBmMember(name) {
  return KNOWN_BM_MEMBERS.has(name.toLowerCase().trim());
}

function matchClientInTitle(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();
  for (const client of ACTIVE_CLIENTS_SORTED) {
    if (titleLower.includes(client.toLowerCase())) {
      return client;
    }
  }
  return null;
}

/**
 * Parse attendees into structured entries, filtering out notetakers.
 */
function parseAttendees(attendeesStr) {
  if (!attendeesStr) return [];
  return attendeesStr
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .filter((a) => !isNotetaker(a))
    .map((entry) => ({
      raw: entry,
      name: stripParenthetical(entry),
      company: extractCompanyFromParenthetical(entry),
      isBm: isBmMember(stripParenthetical(entry)),
    }));
}

/**
 * Clean the meeting title to use as a fallback customer name.
 * Strip BM member names, common separators, and whitespace.
 */
function cleanTitleAsCustomer(title) {
  if (!title) return 'Unknown Client';
  let cleaned = title;
  // Remove known BM member names
  for (const name of KNOWN_BM_MEMBERS) {
    const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, '');
  }
  // Remove separators and trim
  cleaned = cleaned.replace(/\s*<>\s*/g, ' ').replace(/\s*[/:&-]\s*/g, ' ').trim();
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || 'Unknown Client';
}

export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = parseAttendees(meeting.attendees);

  // Signal 1: title contains a known client name
  const clientFromTitle = matchClientInTitle(title);

  // Signal 2: any non-notetaker attendee is not a known BM team member
  const hasExternalAttendee = attendees.some((a) => !a.isBm);

  // EXTERNAL if either signal fires
  if (clientFromTitle || hasExternalAttendee) {
    // Determine customer name
    if (clientFromTitle) {
      return { type: 'external', clientName: clientFromTitle };
    }

    // No client in title — find the external attendee's company
    const external = attendees.find((a) => !a.isBm);
    if (external && external.company) {
      return { type: 'external', clientName: external.company };
    }

    // No company in parenthetical — use cleaned title as fallback
    return { type: 'external', clientName: cleanTitleAsCustomer(title) };
  }

  // INTERNAL: no client in title AND every attendee is BM
  return { type: 'internal', clientName: null };
}
