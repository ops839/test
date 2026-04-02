/**
 * Classifies meetings as internal/external and extracts client names.
 */

const BLU_MOUNTAIN_NAMES = [
  'johnny sengelmann',
  'abdallah gaballah',
  'ahmed amr',
  'kurt buttress',
  'kareem talaat',
  'salma khaled',
  'hala mostafa',
  'eman refaey',
  'mohamed abuzaid',
  'seif muhammed',
  'tarek',
  'omar',
  'mohamed nashat',
];

const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'live.com',
  'me.com',
  'msn.com',
  'protonmail.com',
  'googlemail.com',
  'ymail.com',
  'aol.com',
]);

const BLU_MOUNTAIN_FIRST_NAMES = new Set([
  'johnny', 'abdallah', 'ahmed', 'kurt', 'kareem', 'salma',
  'hala', 'eman', 'mohamed', 'seif', 'tarek', 'omar', 'nashat', 'abuzaid',
  'edward', 'patrick',
]);

const BLU_MOUNTAIN_COMPANY_NAMES = new Set([
  'blu mountain', 'blue mountain', 'blumountain',
]);

const FEEDER_AGENCIES = ['liger', 'infinite renewals'];

const ACTIVE_CLIENTS = [
  'Infinite Renewals',
  'Accelerated Analytics',
  'Athena',
  'August Health',
  'Blu Sky',
  'Bushel',
  'Custom GPT',
  'Cybernut',
  'Hall Street 3PL',
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
];

// ─── Attendee Parsing ────────────────────────────────────────────────

/**
 * Parse a raw attendee entry and return a structured object:
 * { name, domain, company, signal: 'external'|'internal'|'unknown', skip: bool }
 */
function parseAttendee(raw) {
  const entry = raw.trim();
  if (!entry) return null;

  // a) Skip notetaker bots
  if (/notetaker/i.test(entry)) {
    return { name: entry, domain: null, company: null, signal: 'skip', skip: true };
  }

  const name = entry.replace(/\s*\(.*\)\s*$/, '').trim();

  // b) Check for domain in parentheses: (word.tld) where tld is 2-4 letters, no spaces
  const domainMatch = entry.match(/\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,4})\)$/);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase();
    if (domain === 'blumountain.me') {
      return { name, domain, company: null, signal: 'internal', skip: false };
    }
    if (PERSONAL_DOMAINS.has(domain)) {
      return { name, domain, company: null, signal: 'internal', skip: false };
    }
    return { name, domain, company: null, signal: 'external', skip: false };
  }

  // c) Check for job title with "at Company": (... at Company) or (... at Company (FKA ...))
  const atMatch = entry.match(/\([^)]*\bat\s+(.+?)\s*(?:\(FKA[^)]*\))?\s*\)$/i);
  if (atMatch) {
    let company = atMatch[1].trim();
    // Strip trailing (FKA ...) if still present
    company = company.replace(/\s*\(FKA[^)]*\)\s*$/i, '').trim();
    const companyLower = company.toLowerCase();
    if (BLU_MOUNTAIN_COMPANY_NAMES.has(companyLower)) {
      return { name, domain: null, company, signal: 'internal', skip: false };
    }
    return { name, domain: null, company, signal: 'external', skip: false };
  }

  // d) No parenthetical — check if name matches known BM team member
  if (isBluMountainName(name)) {
    return { name, domain: null, company: null, signal: 'internal', skip: false };
  }

  return { name, domain: null, company: null, signal: 'unknown', skip: false };
}

function splitAttendees(attendeesStr) {
  if (!attendeesStr) return [];
  return attendeesStr
    .split(',')
    .map((a) => parseAttendee(a))
    .filter((a) => a !== null);
}

function isBluMountainName(str) {
  const lower = str.toLowerCase().trim();
  return BLU_MOUNTAIN_NAMES.some((name) => lower === name || lower.includes(name));
}

function isBluMountainFirstName(str) {
  const words = str.toLowerCase().trim().split(/\s+/);
  return words.length > 0 && words.every((w) => BLU_MOUNTAIN_FIRST_NAMES.has(w));
}

// ─── Customer Name Extraction ────────────────────────────────────────

/**
 * Convert a raw domain to a capitalized display name.
 * "numa.com" → "Numa", "learnedmedia.com" → "Learned Media"
 */
function domainToDisplayName(domain) {
  const base = domain.split('.')[0];
  // Insert spaces before capitals in camelCase, then capitalize each word
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract customer name from parsed attendees (who signaled external).
 */
function customerFromAttendees(attendees) {
  for (const a of attendees) {
    if (a.skip || a.signal !== 'external') continue;
    // Priority: company name from "at Company"
    if (a.company) return a.company;
  }
  for (const a of attendees) {
    if (a.skip || a.signal !== 'external') continue;
    // Fallback: domain
    if (a.domain) return domainToDisplayName(a.domain);
  }
  return null;
}

/**
 * Extract customer name from meeting title patterns.
 */
function customerFromTitle(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();

  // Feeder agency + ampersand pattern
  for (const agency of FEEDER_AGENCIES) {
    if (titleLower.includes(agency)) {
      const ampersandMatch = title.match(/^([^&]+)\s*&\s*([^:]+)/);
      if (ampersandMatch) {
        const left = ampersandMatch[1].trim();
        const right = ampersandMatch[2].trim();
        if (left.toLowerCase().includes(agency)) return right;
        return left;
      }
    }
  }

  // "[Client] <> Blu Mountain..." or "[Client] <> Blumountain..."
  const separatorMatch = title.match(/^(.+?)\s*<>\s*/);
  if (separatorMatch) {
    const candidate = separatorMatch[1].trim();
    if (
      !BLU_MOUNTAIN_COMPANY_NAMES.has(candidate.toLowerCase()) &&
      !isBluMountainFirstName(candidate)
    ) {
      return candidate;
    }
  }

  // "[Client] / [Person] - description" or "[Person] / [Client] - description"
  const slashMatch = title.match(/^([^/]+)\s*\/\s*([^-]+)/);
  if (slashMatch) {
    const left = slashMatch[1].trim();
    const right = slashMatch[2].trim();
    if (isBluMountainFirstName(right) || isBluMountainName(right)) return left;
    if (isBluMountainFirstName(left) || isBluMountainName(left)) return right;
  }

  // "[Client]: description"
  const colonMatch = title.match(/^([^:]+):/);
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    if (
      !isBluMountainFirstName(candidate) &&
      !isBluMountainName(candidate) &&
      !BLU_MOUNTAIN_COMPANY_NAMES.has(candidate.toLowerCase())
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Match active client list against meeting title.
 */
function matchActiveClient(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();

  // Check feeder agency + other client combo first
  for (const agency of FEEDER_AGENCIES) {
    if (titleLower.includes(agency)) {
      const otherClient = ACTIVE_CLIENTS.find((c) => {
        const cLower = c.toLowerCase();
        return cLower !== agency && titleLower.includes(cLower);
      });
      if (otherClient) return otherClient;
    }
  }

  // Match by length descending so longer names match first
  const sorted = [...ACTIVE_CLIENTS].sort((a, b) => b.length - a.length);
  for (const client of sorted) {
    if (titleLower.includes(client.toLowerCase())) {
      return client;
    }
  }

  return null;
}

// ─── Main Classification ─────────────────────────────────────────────

export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = splitAttendees(meeting.attendees);
  const nonSkipped = attendees.filter((a) => !a.skip);

  // PRIMARY SIGNAL: attendee parsing determines internal vs external
  const hasExternal = nonSkipped.some((a) => a.signal === 'external');

  if (!hasExternal) {
    return { type: 'internal', clientName: null };
  }

  // Meeting is EXTERNAL — determine customer name
  // 1) From attendee job title ("at Company")
  // 2) From attendee domain
  const attendeeCustomer = customerFromAttendees(nonSkipped);

  // 3) From active client list in title
  const activeClient = matchActiveClient(title);

  // 4) From title patterns (<>, :, /)
  const titleCustomer = customerFromTitle(title);

  // Use best available name: active client list > attendee info > title patterns
  const clientName = activeClient || attendeeCustomer || titleCustomer || 'Unknown Client';

  return { type: 'external', clientName };
}
