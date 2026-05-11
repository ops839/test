// Pure-AI Sybill meeting classifier — replaces the deterministic cascade
// (title substring → alias → domain → uncertain → internal). Every
// in-window meeting is sent to Sonnet 4.6 with the full Known Clients
// list and the alias map as prompt context. The classifier never decides
// "Internal/Skip" — meetings the model can't place return null and are
// surfaced as an "Unknown" group in the review UI.

import { KNOWN_CLIENTS } from '../../src/lib/classifier.js';
import { TITLE_ALIASES } from '../../src/lib/aliases.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CONCURRENCY = 16;

export function buildSystemPrompt() {
  const clients = KNOWN_CLIENTS.map((c) => `- ${c}`).join('\n');
  const aliases = Object.entries(TITLE_ALIASES)
    .map(([short, canonical]) => `- "${short}" → ${canonical}`)
    .join('\n');
  return `You are classifying meeting records for Blu Mountain, a RevOps consultancy. For each meeting (title + attendees), identify which client from the provided list the meeting belongs to.

Known clients:
${clients}

Title aliases (short form → canonical client). Treat the short form as equivalent to the canonical name:
${aliases}

Notes:
- Blu Mountain's own domain is blumountain.me. A meeting with only @blumountain.me attendees is usually internal, but the title may still name a client (e.g. internal prep for a client call) — pick that client if so.
- Attendee strings often have the format "Name (domain.tld)" or "Name (at Company)". Use both signals.
- Personal-email-only attendees (gmail.com, yahoo.com, outlook.com) don't disqualify a meeting from being client work — fall back to the title.

Output ONLY valid JSON, no other text:
  {"client": "<exact name from the Known clients list>"}
or
  {"client": null}
if no client matches with reasonable confidence. Do not invent client names that are not on the list.`;
}

const SYSTEM_PROMPT_TEXT = buildSystemPrompt();

export function buildUserMessage(meeting) {
  return `Title: ${meeting.title || '(untitled)'}\nAttendees: ${meeting.attendees || '(none)'}`;
}

const KNOWN_CLIENT_SET = new Set(KNOWN_CLIENTS);

export function extractClient(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && 'client' in parsed) {
      const v = parsed.client;
      if (v === null) return null;
      if (typeof v === 'string') {
        const t = v.trim();
        return KNOWN_CLIENT_SET.has(t) ? t : null;
      }
    }
  } catch {
    // fall through to regex
  }
  const m = trimmed.match(/"client"\s*:\s*(null|"([^"]+)")/);
  if (!m) return null;
  if (m[1] === 'null') return null;
  return KNOWN_CLIENT_SET.has(m[2]) ? m[2] : null;
}

let fetchImpl = null;
export function setFetchOverride(fn) {
  fetchImpl = fn;
}
function doFetch(url, opts) {
  return (fetchImpl ?? globalThis.fetch.bind(globalThis))(url, opts);
}

async function classifyOne(apiKey, meeting) {
  const res = await doFetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 100,
      temperature: 0,
      system: [
        { type: 'text', text: SYSTEM_PROMPT_TEXT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: buildUserMessage(meeting) }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  return extractClient(block?.text);
}

// Classify every meeting in parallel up to `concurrency`. Returns
// `[{ meeting, client }]` with `client` either a KNOWN_CLIENTS name or
// "Unknown" (for both null responses and per-meeting failures — those
// are logged and counted toward done so the user always sees progress).
export async function classifyAllMeetings(apiKey, meetings, onProgress, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(meetings.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < meetings.length) {
      const idx = next++;
      let client = null;
      try {
        client = await classifyOne(apiKey, meetings[idx]);
      } catch (e) {
        console.warn(`AI classify failed for meeting ${idx}:`, e.message);
      }
      results[idx] = { meeting: meetings[idx], client: client ?? 'Unknown' };
      done++;
      onProgress?.(done, meetings.length);
    }
  }

  const workerCount = Math.min(concurrency, meetings.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
