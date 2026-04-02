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

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'live.com', 'me.com', 'msn.com',
  'protonmail.com', 'googlemail.com', 'optonline.net',
  'ymail.com', 'aol.com', 'comcast.net', 'att.net',
  'verizon.net', 'sbcglobal.net', 'bellsouth.net',
  'cox.net', 'charter.net', 'earthlink.net',
]);

const DOMAIN_TO_CLIENT = {
  'akaselect.com': 'Select Exterminating',
  'poppinspayroll.com': 'Poppins Payroll',
  'poppins.com': 'Poppins Payroll',
  'learnedmedia.com': 'Learned Media',
  'numa.com': 'Numa',
  'shoplift.ai': 'Shoplift',
  'rebeliq.com': 'RebelIQ',
  'productside.com': 'Productside',
  'zeitcaster.com': 'Zeitcaster',
  'jencapgroup.com': 'Jencap',
  'minico.com': 'MiniCo',
  'frblaw.com': 'Falcon Rappaport',
  'xano.io': 'Xano',
  'xano.com': 'Xano',
  'bushelpowered.com': 'Bushel',
  'bushelpower.com': 'Bushel',
  'venturelab.com': 'VentureLab',
  'ventrichealth.com': 'Ventric Health',
  'trnsact.com': 'TRNSACT',
  'maxadesigns.com': 'Maxa Designs',
  'laddergtm.com': 'Ladder GTM',
  'formations.com': 'Formations',
  'polaranalytics.com': 'Polar Analytics',
  'depodirect.com': 'DepoDirect',
  'salesmessage.com': 'SalesMessage',
  'salesmsg.com': 'SalesMessage',
  'poplarstudios.com': 'Poplar Studios',
  'clickup.com': 'ClickUp',
  'hubspot.com': 'HubSpot',
  'supermetrics.com': 'Supermetrics',
  'gong.io': 'Gong',
  'verblio.com': 'Verblio',
  'voyantis.ai': 'Voyantis',
  'auquan.com': 'Auquan',
  'sazmining.com': 'Sazmining',
  'watershed.com': 'Watershed',
  'intersight.com': 'Intersight',
  'storylane.io': 'Storylane',
  'crossbeam.com': 'Crossbeam',
  'immutable.com': 'Immutable',
  'pachama.com': 'Pachama',
  'trelliswork.com': 'Trellis Work',
  'skematic.com': 'Skematic',
  'koalify.com': 'Koalify',
  'supered.io': 'Supered',
  'brevitypitch.com': 'Brevity',
  'makemusic.com': 'MakeMusic',
  'stayfrank.com': 'Stay Frank',
  'firsttouch.com': 'First Touch',
  'gbsgis.com': 'GBS GIS',
  'realtyonegroup.com': 'Realty One Group',
  'insurxglobal.com': 'InsurX Global',
  'akutehealth.com': 'Akute Health',
  'strategysource.com': 'Strategy Source',
  'irisaiempowerment.com': 'Iris AI Empowerment',
  'atompoint.com': 'Atompoint',
  'okapico.com': 'OkapiCo',
  'amplifyops.com': 'Amplify Ops',
  'goligilo.com': 'Goligilo',
  'venturelab.io': 'VentureLab',
  'blumountain.me': null,
};

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
  'Falcon Rappaport',
  'Radicle',
  'Liger',
];

const FEEDER_AGENCIES = new Set(['liger']);

// Pre-sort by length descending so longer names match first
const ACTIVE_CLIENTS_SORTED = [...ACTIVE_CLIENTS].sort((a, b) => b.length - a.length);

export { KNOWN_BM_MEMBERS, ACTIVE_CLIENTS_SORTED };

// ─── Helpers ─────────────────────────────────────────────────────────

function isNotetaker(entry) {
  return /notetaker/i.test(entry);
}

function stripParenthetical(entry) {
  return entry.replace(/\s*\(.*\)\s*$/, '').trim();
}

/**
 * Extract the domain from attendee parenthetical, e.g. (numa.com) → "numa.com"
 */
function extractDomain(entry) {
  const m = entry.match(/\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,4})\)\s*$/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Extract company from "at Company" pattern in parenthetical.
 */
function extractCompanyFromAt(entry) {
  const m = entry.match(/\([^)]*\bat\s+(.+?)(?:\s*\(FKA[^)]*\))?\s*\)\s*$/i);
  return m ? m[1].trim() : null;
}

/**
 * Resolve a domain to a proper display name.
 */
function domainToClientName(domain) {
  if (!domain) return null;
  const lower = domain.toLowerCase();

  // Check explicit map
  if (lower in DOMAIN_TO_CLIENT) return DOMAIN_TO_CLIENT[lower];

  // Personal domain → null (internal)
  if (PERSONAL_DOMAINS.has(lower)) return null;

  // blumountain.me → null (internal)
  if (lower === 'blumountain.me') return null;

  // Unknown business domain → Title Case with camelCase splitting
  const base = lower.split('.')[0];
  // Insert spaces before capitals in camelCase
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPersonalDomain(domain) {
  return domain && PERSONAL_DOMAINS.has(domain.toLowerCase());
}

function isBmMember(name) {
  return KNOWN_BM_MEMBERS.has(name.toLowerCase().trim());
}

// ─── Title Matching ──────────────────────────────────────────────────

function matchClientInTitle(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();
  for (const client of ACTIVE_CLIENTS_SORTED) {
    if (titleLower.includes(client.toLowerCase())) {
      // If it's a feeder agency, check if there's another client too
      if (FEEDER_AGENCIES.has(client.toLowerCase())) {
        const other = ACTIVE_CLIENTS_SORTED.find(
          (c) => !FEEDER_AGENCIES.has(c.toLowerCase()) && titleLower.includes(c.toLowerCase())
        );
        if (other) return other;
        // Liger alone with no other client → skip
        return null;
      }
      return client;
    }
  }
  return null;
}

// ─── Attendee Parsing ────────────────────────────────────────────────

function parseAttendees(attendeesStr) {
  if (!attendeesStr) return [];
  return attendeesStr
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .filter((a) => !isNotetaker(a))
    .map((entry) => {
      const name = stripParenthetical(entry);
      const domain = extractDomain(entry);
      const companyFromAt = extractCompanyFromAt(entry);
      return { raw: entry, name, domain, companyFromAt, isBm: isBmMember(name) };
    });
}

/**
 * Check if an attendee signals EXTERNAL with a business domain.
 * Returns the client name if external, null if internal/personal.
 */
function attendeeExternalClient(a) {
  // "at Company" pattern
  if (a.companyFromAt) {
    const lower = a.companyFromAt.toLowerCase();
    if (lower === 'blu mountain' || lower === 'blue mountain' || lower === 'blumountain') {
      return null;
    }
    return a.companyFromAt;
  }
  // Domain in parenthetical
  if (a.domain) {
    return domainToClientName(a.domain);
  }
  return null;
}

// ─── Customer Name Cleanup ───────────────────────────────────────────

const BM_NAME_PATTERNS = [
  /\bblu\s*mountain\b/gi,
  /\bblumountain\b/gi,
  /\bblue\s*mountain\b/gi,
];

const MEETING_DESCRIPTOR_PATTERNS = [
  /\b(weekly|monthly|daily|bi-?weekly)\s*(call|sync|review|check-?in|standup|meeting|huddle|looker\s+review)?\b/gi,
  /\b(call|sync|kickoff|kick-?off|intro|introduction|onboarding|check-?in|standup|meeting|huddle|review|retro|debrief|wrap-?up)\b/gi,
  /\b(inbound|outbound)\s*\d{4}\s*(products?)?\b/gi,
  /\bpartner\s*group\b/gi,
  /\b\[L\]\b/gi,
];

export function cleanCustomerName(name) {
  if (!name) return null;
  let cleaned = name;

  // Strip BM company names
  for (const pat of BM_NAME_PATTERNS) {
    cleaned = cleaned.replace(pat, '');
  }

  // Strip meeting descriptors
  for (const pat of MEETING_DESCRIPTOR_PATTERNS) {
    cleaned = cleaned.replace(pat, '');
  }

  // Strip separators, parens, leading/trailing punctuation
  cleaned = cleaned.replace(/\s*<>\s*/g, ' ');
  cleaned = cleaned.replace(/\s*[/:&\-–—]\s*/g, ' ');
  cleaned = cleaned.replace(/\(.*?\)/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '').trim();

  // If nothing left or just "and" / prepositions, it's garbage
  if (!cleaned || /^(and|or|the|with|for|to|of|in|at|a|an)$/i.test(cleaned)) {
    return null;
  }

  // If it starts with "and " — broken extraction
  if (/^and\s+/i.test(cleaned)) return null;

  return cleaned;
}

// ─── Main Classification ─────────────────────────────────────────────

export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = parseAttendees(meeting.attendees);

  // Signal 1: title contains a known client name
  const clientFromTitle = matchClientInTitle(title);

  // Signal 2: any attendee has a business email domain (not personal, not BM)
  let clientFromAttendee = null;
  for (const a of attendees) {
    if (a.isBm) continue;
    const client = attendeeExternalClient(a);
    if (client) {
      clientFromAttendee = client;
      break;
    }
  }

  // Signal 3: unknown attendee (not BM, no parenthetical with domain)
  // Only counts as external if we also have a title match or business domain
  const hasUnknownAttendee = attendees.some(
    (a) => !a.isBm && !a.domain && !a.companyFromAt
  );

  // Determine classification
  if (clientFromTitle) {
    // Title matched a known client — always EXTERNAL
    const cleaned = cleanCustomerName(clientFromTitle);
    if (cleaned) return { type: 'external', clientName: cleaned };
  }

  if (clientFromAttendee) {
    // Attendee has a business domain → EXTERNAL
    const cleaned = cleanCustomerName(clientFromAttendee);
    if (cleaned) return { type: 'external', clientName: cleaned };
  }

  // If we only have unknown attendees (no domain info) + title has a client → already handled above
  // If unknown attendees but no title match and no business domain:
  // Check if title matches active client (already done). If not, check if all "external"
  // attendees only have personal email domains → INTERNAL
  if (hasUnknownAttendee && !clientFromTitle && !clientFromAttendee) {
    // Unknown attendees with no business domain info — check if we can identify from title
    // Title cleanup as last resort
    const titleClient = cleanCustomerName(title);
    // Only use title if it looks like a company name (not a person name, not garbage)
    if (titleClient && titleClient.split(/\s+/).length <= 4 && !/interview/i.test(title)) {
      // But check: is this just a person's name? If all words are BM first names, skip
      const allBmNames = titleClient.toLowerCase().split(/\s+/).every(
        (w) => KNOWN_BM_MEMBERS.has(w)
      );
      if (!allBmNames) {
        return { type: 'external', clientName: titleClient };
      }
    }
  }

  // Interview meetings with only personal email attendees → INTERNAL
  // Meetings where all external attendees are personal email only → INTERNAL
  // Default: INTERNAL
  return { type: 'internal', clientName: null };
}
