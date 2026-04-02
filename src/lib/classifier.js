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
  "hala's notetaker",
  "eman's notetaker",
  "johnny's notetaker",
  "salma's notetaker",
  "kareem's notetaker",
  "abdallah's notetaker",
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

function stripParenthetical(name) {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
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

function firstExternalAttendee(attendeesStr) {
  if (!attendeesStr) return null;
  const entries = attendeesStr.split(',').map((a) => a.trim()).filter(Boolean);
  for (const entry of entries) {
    const name = stripParenthetical(entry);
    if (name && !isBmMember(name)) {
      return name;
    }
  }
  return null;
}

function allAttendeesBm(attendeesStr) {
  if (!attendeesStr) return true;
  const entries = attendeesStr.split(',').map((a) => a.trim()).filter(Boolean);
  return entries.every((entry) => isBmMember(stripParenthetical(entry)));
}

export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = meeting.attendees || '';

  // Signal 1: title contains a known client name
  const clientFromTitle = matchClientInTitle(title);

  // Signal 2: any attendee is not a known BM team member
  const externalAttendee = firstExternalAttendee(attendees);

  // EXTERNAL if either signal fires
  if (clientFromTitle || externalAttendee) {
    const clientName = clientFromTitle || externalAttendee;
    return { type: 'external', clientName };
  }

  // INTERNAL: no client in title AND every attendee is BM
  return { type: 'internal', clientName: null };
}
