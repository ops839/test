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
  'seif',
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

function parseAttendeeList(attendeesStr) {
  if (!attendeesStr) return [];
  return attendeesStr
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

function getEmailDomain(str) {
  const emailMatch = str.match(/([^\s@]+@([^\s@)]+))/);
  if (emailMatch) return emailMatch[2].toLowerCase();
  return null;
}

function hasExternalBusiness(attendee) {
  const domain = getEmailDomain(attendee);
  if (!domain) return false;
  if (domain === 'blumountain.me') return false;
  if (PERSONAL_DOMAINS.has(domain)) return false;
  return true;
}

function extractExternalDomain(attendee) {
  const domain = getEmailDomain(attendee);
  if (!domain) return null;
  if (domain === 'blumountain.me') return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  return domain;
}

function domainToName(domain) {
  // "acme.com" → "acme", "hall-street.io" → "hall-street"
  return domain.split('.')[0];
}

function isBluMountainFirstName(str) {
  const words = str.toLowerCase().trim().split(/\s+/);
  return words.length > 0 && words.every((w) => BLU_MOUNTAIN_FIRST_NAMES.has(w));
}

function isBluMountainName(str) {
  const lower = str.toLowerCase().trim();
  return BLU_MOUNTAIN_NAMES.some((name) => lower === name || lower.includes(name));
}

/**
 * Check if a title like "Name <> Name" is a person-to-person internal meeting.
 * Returns true if both sides of <> are single-word BM first names.
 */
function isPersonToPersonTitle(title) {
  if (!title) return false;
  const match = title.match(/^(.+?)\s*<>\s*(.+?)(?:\s*[-:].*)?$/);
  if (!match) return false;
  const left = match[1].trim();
  const right = match[2].trim();
  // Both sides should be simple names (1-2 words, all BM first names)
  return isBluMountainFirstName(left) && isBluMountainFirstName(right);
}

/**
 * Priority 1: Check if meeting title contains a known active client name.
 * Handles feeder agency logic: if Infinite Renewals or Liger appears alongside
 * another client, the other client is the customer. If a feeder agency appears
 * alone, treat it as the client (only Infinite Renewals is on the active list).
 */
function matchActiveClient(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();

  // Check feeder agency + other client combo first
  for (const agency of FEEDER_AGENCIES) {
    if (titleLower.includes(agency)) {
      // Look for another active client in the same title
      const otherClient = ACTIVE_CLIENTS.find((c) => {
        const cLower = c.toLowerCase();
        return cLower !== agency && titleLower.includes(cLower);
      });
      if (otherClient) return otherClient;
      // No other client found — if the agency itself is an active client, use it
      // (Infinite Renewals is both feeder agency and client)
    }
  }

  // Match any active client by case-insensitive partial match
  // Sort by length descending so longer names match first (e.g. "Hall Street 3PL" before "Hall")
  const sorted = [...ACTIVE_CLIENTS].sort((a, b) => b.length - a.length);
  for (const client of sorted) {
    if (titleLower.includes(client.toLowerCase())) {
      return client;
    }
  }

  return null;
}

/**
 * Priority 2: Infer customer from external attendee email domains.
 */
function matchByAttendeeDomain(attendees) {
  for (const attendee of attendees) {
    const domain = extractExternalDomain(attendee);
    if (domain) return domainToName(domain);
  }
  return null;
}

/**
 * Fallback: extract client from title patterns (<> or :) when no active client
 * matched and no external domain found.
 */
function extractClientFromTitlePatterns(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();

  // Feeder agency with ampersand pattern
  for (const agency of FEEDER_AGENCIES) {
    if (titleLower.includes(agency)) {
      const ampersandMatch = title.match(/^([^&]+)\s*&\s*([^:]+)/);
      if (ampersandMatch) {
        const left = ampersandMatch[1].trim();
        const right = ampersandMatch[2].trim();
        if (left.toLowerCase().includes(agency)) return right;
        return left;
      }
      return null;
    }
  }

  // "[Client] <> ..."
  const separatorMatch = title.match(/^(.+?)\s*<>\s*/);
  if (separatorMatch) {
    const candidate = separatorMatch[1].trim();
    if (
      candidate.toLowerCase() !== 'blu mountain' &&
      !isBluMountainFirstName(candidate)
    ) {
      return candidate;
    }
  }

  // "[Client]: ..."
  const colonMatch = title.match(/^([^:]+):/);
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    if (
      !isBluMountainFirstName(candidate) &&
      !isBluMountainName(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = parseAttendeeList(meeting.attendees);
  const hasExternal = attendees.some(hasExternalBusiness);

  // PRIMARY SIGNAL: attendee email domains determine internal vs external
  if (!hasExternal) {
    // All attendees are blumountain.me or personal email domains → INTERNAL
    return { type: 'internal', clientName: null };
  }

  // Meeting is EXTERNAL — now determine the customer name
  // Try active client list first (best match)
  const activeClient = matchActiveClient(title);
  if (activeClient) {
    return { type: 'external', clientName: activeClient };
  }

  // Try title patterns (<> or :)
  const titleClient = extractClientFromTitlePatterns(title);
  if (titleClient) {
    return { type: 'external', clientName: titleClient };
  }

  // Fall back to domain name
  const domainClient = matchByAttendeeDomain(attendees);
  if (domainClient) {
    return { type: 'external', clientName: domainClient };
  }

  // External by email but can't determine client name
  return { type: 'external', clientName: 'Unknown Client' };
}
