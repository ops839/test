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
]);

const FEEDER_AGENCIES = ['liger', 'infinite renewals'];

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

function isBluMountainMember(attendee) {
  const lower = attendee.toLowerCase();
  // Check email domain
  const domain = getEmailDomain(lower);
  if (domain === 'blumountain.me') return true;
  // Check name match
  return BLU_MOUNTAIN_NAMES.some(
    (name) => lower.includes(name)
  );
}

function isPersonalEmail(attendee) {
  const domain = getEmailDomain(attendee);
  return domain ? PERSONAL_DOMAINS.has(domain) : false;
}

function hasExternalBusiness(attendee) {
  const domain = getEmailDomain(attendee);
  if (!domain) return false; // No email — can't confirm external
  if (domain === 'blumountain.me') return false;
  if (PERSONAL_DOMAINS.has(domain)) return false;
  return true;
}

export function classifyMeeting(meeting) {
  const attendees = parseAttendeeList(meeting.attendees);

  const hasBluMountain = attendees.some(isBluMountainMember);
  const hasExternal = attendees.some(hasExternalBusiness);

  // Signal 1: attendee emails confirm external
  if (hasBluMountain && hasExternal) {
    const clientName = extractClientName(meeting.title);
    if (clientName) {
      return { type: 'external', clientName };
    }
  }

  // Signal 2: title contains a non-BM company name via <> or : patterns
  const titleClient = extractClientFromTitle(meeting.title);
  if (titleClient) {
    return { type: 'external', clientName: titleClient };
  }

  return { type: 'internal', clientName: null };
}

function isBluMountainFirstName(str) {
  // Check if every word in the string is a known BM first name
  const words = str.toLowerCase().trim().split(/\s+/);
  return words.length > 0 && words.every((w) => BLU_MOUNTAIN_FIRST_NAMES.has(w));
}

function isFeederAgency(str) {
  const lower = str.toLowerCase().trim();
  return FEEDER_AGENCIES.some((a) => lower.includes(a));
}

function extractClientFromTitle(title) {
  if (!title) return null;

  const titleLower = title.toLowerCase();

  // Apply feeder agency rules first
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

  // Pattern: "[Client] <> ..."
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

  // Pattern: "[Client]: ..."
  const colonMatch = title.match(/^([^:]+):/);
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    if (
      !isBluMountainFirstName(candidate) &&
      !isBluMountainName(candidate) &&
      !isFeederAgency(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function extractClientName(title) {
  if (!title) return null;

  // Apply feeder agency rules first
  const titleLower = title.toLowerCase();

  for (const agency of FEEDER_AGENCIES) {
    if (titleLower.includes(agency)) {
      // Pattern: "Agency & Client: topic" or "Client & Agency: topic"
      // Find the other party
      const ampersandMatch = title.match(/^([^&]+)\s*&\s*([^:]+)/);
      if (ampersandMatch) {
        const left = ampersandMatch[1].trim();
        const right = ampersandMatch[2].trim();
        if (left.toLowerCase().includes(agency)) {
          return right;
        }
        return left;
      }
      // If no ampersand pattern, skip creating a tab for the agency
      return null;
    }
  }

  // Pattern: "[Client] <> Blu Mountain [description]"
  const separatorMatch = title.match(/^(.+?)\s*<>\s*/);
  if (separatorMatch) {
    const client = separatorMatch[1].trim();
    if (client.toLowerCase() !== 'blu mountain') return client;
  }

  // Pattern: "[Client]: [description]"
  const colonMatch = title.match(/^([^:]+):/);
  if (colonMatch) {
    const client = colonMatch[1].trim();
    // Check if it's just a BM member name
    if (isBluMountainName(client)) return null;
    return client;
  }

  // Pattern: "[A] & [B]: [description]" already handled by colon match above

  // Check if title is only BM member names
  if (isBluMountainName(title)) return null;

  return null;
}

function isBluMountainName(str) {
  const lower = str.toLowerCase().trim();
  return BLU_MOUNTAIN_NAMES.some((name) => lower === name || lower.includes(name));
}
