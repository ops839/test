/**
 * Deterministic meeting classification.
 *
 * Priority (stop at first match):
 *   1. Meeting title contains a known client name (case-insensitive substring).
 *      Exception: "Infinite Renewals" loses to any other client in the same title.
 *   2. Any attendee email domain matches the domain-to-client map.
 *   3. Any attendee has a business email (not BM, not personal) → uncertain.
 *   4. All attendees are BM or personal → internal (skip).
 */

// ─── 32 known clients ────────────────────────────────────────────────
export const KNOWN_CLIENTS = [
  'Accelerated Analytics',
  'Athena',
  'August Health',
  'Blu Sky',
  'Bushel',
  'Cybernut',
  'Falcon Rappaport',
  'Hall Street',
  'Infinite Renewals',
  'InnoVint',
  'Jencap',
  'Learned Media',
  'Maxa Designs',
  'MiniCo',
  'Milrose',
  'Numa',
  'Pestpac',
  'Polar Analytics',
  'Poppins Payroll',
  'Productside',
  'Radicle',
  'Razor Metrics',
  'RebelIQ',
  'Select Exterminating',
  'Shoplift',
  'Simpl',
  'SSA Group',
  'The Estate Lawyers',
  'Transcom',
  'Trnsact',
  'Wisconsin Carports',
  'Zeitcaster',
];

const INFINITE_RENEWALS = 'Infinite Renewals';

// Pre-sort for longest-match-first in title scan (avoids "Simpl" matching "Simpl GPT" etc.)
const CLIENTS_BY_LENGTH = [...KNOWN_CLIENTS].sort((a, b) => b.length - a.length);

// ─── Domain → client map (77 entries) ────────────────────────────────
export const DOMAIN_TO_CLIENT = {
  // 32 active clients
  'acceleratedanalytics.com': 'Accelerated Analytics',
  'athenahq.ai': 'Athena',
  'augusthealth.com': 'August Health',
  'bluskycapital.com': 'Blu Sky',
  'bushelpowered.com': 'Bushel',
  'bushelpower.com': 'Bushel',
  'cybernut.com': 'Cybernut',
  'frblaw.com': 'Falcon Rappaport',
  'hallstreetcapital.com': 'Hall Street',
  'infiniterenewals.com': 'Infinite Renewals',
  'innovint.us': 'InnoVint',
  'jencapgroup.com': 'Jencap',
  'learnedmedia.com': 'Learned Media',
  'maxadesigns.com': 'Maxa Designs',
  'minico.com': 'MiniCo',
  'milrose.com': 'Milrose',
  'numa.com': 'Numa',
  'pestpac.com': 'Pestpac',
  'polaranalytics.com': 'Polar Analytics',
  'poppinspayroll.com': 'Poppins Payroll',
  'poppins.com': 'Poppins Payroll',
  'productside.com': 'Productside',
  'radiclescience.com': 'Radicle',
  'razormetrics.com': 'Razor Metrics',
  'rebeliq.com': 'RebelIQ',
  'akaselect.com': 'Select Exterminating',
  'shoplift.ai': 'Shoplift',
  'simpl.com': 'Simpl',
  'ssa-group.com': 'SSA Group',
  'estatelawyers.com': 'The Estate Lawyers',
  'transcom.com': 'Transcom',
  'trnsact.com': 'Trnsact',
  'wisconsincarports.com': 'Wisconsin Carports',
  'zeitcaster.com': 'Zeitcaster',

  // Other past/secondary client domains
  'xano.io': 'Xano',
  'xano.com': 'Xano',
  'venturelab.com': 'VentureLab',
  'venturelab.io': 'VentureLab',
  'ventrichealth.com': 'Ventric Health',
  'laddergtm.com': 'Ladder GTM',
  'formations.com': 'Formations',
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
};

// ─── Personal email domains ──────────────────────────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'aol.com',
]);

const BM_DOMAIN = 'blumountain.me';

// ─── BM team members (fallback name-only matching) ───────────────────
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

// ─── Attendee parsing ────────────────────────────────────────────────
function isNotetaker(entry) {
  return /notetaker/i.test(entry);
}

function stripParenthetical(entry) {
  return entry.replace(/\s*\(.*\)\s*$/, '').trim();
}

function extractDomain(entry) {
  const m = entry.match(/\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)\s*$/);
  return m ? m[1].toLowerCase() : null;
}

function extractCompanyFromAt(entry) {
  const m = entry.match(/\([^)]*\bat\s+(.+?)(?:\s*\(FKA[^)]*\))?\s*\)\s*$/i);
  return m ? m[1].trim() : null;
}

function isPersonalDomain(domain) {
  return !!domain && PERSONAL_DOMAINS.has(domain.toLowerCase());
}

function isBmDomain(domain) {
  return !!domain && domain.toLowerCase() === BM_DOMAIN;
}

function isBmMemberName(name) {
  return KNOWN_BM_MEMBERS.has(name.toLowerCase().trim());
}

export function parseAttendees(attendeesStr) {
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
      return {
        raw: entry,
        name,
        domain,
        companyFromAt,
        isBm: isBmDomain(domain) || isBmMemberName(name),
        isPersonal: isPersonalDomain(domain),
      };
    });
}

// ─── Title matching ──────────────────────────────────────────────────
function matchClientInTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();

  // Collect every client whose name appears as a case-insensitive substring.
  const hits = [];
  for (const client of CLIENTS_BY_LENGTH) {
    if (lower.includes(client.toLowerCase())) hits.push(client);
  }
  if (hits.length === 0) return null;

  // Infinite Renewals loses to any other match.
  if (hits.length > 1) {
    const other = hits.find((c) => c !== INFINITE_RENEWALS);
    if (other) return other;
  }
  return hits[0];
}

// ─── Main classification ─────────────────────────────────────────────
/**
 * Priority, stop at first match:
 *   1. Title contains a known client name → client
 *   2. Any attendee domain in map → client
 *   3. Any attendee with a *business* email (has domain, not BM, not personal) → uncertain
 *   4. Any attendee that can't be confirmed BM-or-personal → uncertain
 *      (no domain info AND not a known BM member by name, or zero attendees)
 *   5. Every attendee is BM or personal → internal
 *
 * @returns {{status:'client'|'uncertain'|'internal', client?:string, candidateDomain?:string|null, reason?:string}}
 */
export function classifyMeeting(meeting) {
  const title = meeting.title || '';
  const attendees = parseAttendees(meeting.attendees);

  // 1. Title match.
  const titleClient = matchClientInTitle(title);
  if (titleClient) return { status: 'client', client: titleClient };

  // 2. Attendee domain in map.
  for (const a of attendees) {
    if (!a.domain) continue;
    const mapped = DOMAIN_TO_CLIENT[a.domain.toLowerCase()];
    if (mapped) return { status: 'client', client: mapped };
  }

  // 3. Business-email attendee → uncertain (with candidate domain).
  const businessAttendee = attendees.find(
    (a) => a.domain && !isBmDomain(a.domain) && !isPersonalDomain(a.domain)
  );
  if (businessAttendee) {
    return {
      status: 'uncertain',
      candidateDomain: businessAttendee.domain,
      reason: 'business-email',
    };
  }

  // 4. Unknown attendee (no domain info, not a known BM name) → uncertain.
  //    Also: zero attendees + no title hit → can't confirm internal → uncertain.
  if (attendees.length === 0) {
    return { status: 'uncertain', candidateDomain: null, reason: 'no-attendees' };
  }
  const unknownAttendee = attendees.find((a) => !a.isBm && !a.isPersonal);
  if (unknownAttendee) {
    return { status: 'uncertain', candidateDomain: null, reason: 'unknown-attendee' };
  }

  // 5. All BM or personal → internal.
  return { status: 'internal' };
}
