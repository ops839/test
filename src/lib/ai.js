/**
 * Anthropic API wrapper for uncertain-meeting classification.
 *
 * Browser-direct, no SDK. Uses `anthropic-dangerous-direct-browser-access: true`
 * — tradeoff: the key lives in the user's browser/localStorage. This is only
 * acceptable for personal/single-user tools, which is our scope.
 *
 * Prompt caching: cache_control is set on the static system block. Sonnet 4.6's
 * minimum cacheable prefix is 2048 tokens. Our current system prompt is well
 * under that, so caching will no-op today (no error). If the system prompt
 * grows past 2048 tokens, caching kicks in automatically.
 */
import { KNOWN_CLIENTS } from './classifier.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are classifying meetings for a RevOps consultancy called Blu Mountain. Given a meeting name and attendees, identify which client from the provided list the meeting belongs to. Match on company names, attendee email domains, and attendee employers mentioned in the attendees string. Return only valid JSON: {"client": "<exact client name from list>"} or {"client": null} if no match is confident. Do not invent clients not on the list.

Known clients:
${KNOWN_CLIENTS.map((c) => `- ${c}`).join('\n')}`;

function headers(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

async function callMessages(apiKey, body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text();
    }
    throw new Error(`Anthropic ${res.status}: ${detail}`);
  }
  return res.json();
}

/**
 * Minimal API-key sanity check. Uses max_tokens:1 so the round trip is cheap.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function testApiKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  try {
    await callMessages(apiKey, {
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function extractClientFromText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && 'client' in parsed) {
      const v = parsed.client;
      if (v === null) return null;
      if (typeof v === 'string' && KNOWN_CLIENTS.includes(v)) return v;
      return null;
    }
  } catch {
    // fall through to regex
  }
  const match = trimmed.match(/"client"\s*:\s*(null|"([^"]+)")/);
  if (!match) return null;
  if (match[1] === 'null') return null;
  return KNOWN_CLIENTS.includes(match[2]) ? match[2] : null;
}

function buildUserMessage(group) {
  const sampleTitles = group.meetings
    .slice(0, 3)
    .map((m) => `- ${m.title || '(untitled)'}`)
    .join('\n');
  const sampleAttendees = group.meetings[0]?.attendees || '';
  const lines = [`Meeting count: ${group.meetings.length}`];
  if (group.kind === 'domain') lines.push(`Shared attendee domain: ${group.key}`);
  else if (group.kind === 'name') lines.push(`Shared meeting name: ${group.key}`);
  lines.push(`Sample titles:\n${sampleTitles}`);
  lines.push(`Attendees (sample): ${sampleAttendees}`);
  return lines.join('\n');
}

/**
 * Classify one uncertain group. Returns a client name from KNOWN_CLIENTS or null.
 */
export async function classifyGroup(apiKey, group) {
  const data = await callMessages(apiKey, {
    model: MODEL,
    max_tokens: 100,
    temperature: 0,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(group) }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return extractClientFromText(textBlock?.text);
}

/**
 * Classify all groups with a small concurrency cap. Calls onProgress after each.
 * Returns Map<groupId, suggestedClient|null>.
 */
export async function classifyGroups(apiKey, groups, onProgress, concurrency = 5) {
  const results = new Map();
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < groups.length) {
      const i = next++;
      const group = groups[i];
      try {
        const client = await classifyGroup(apiKey, group);
        results.set(group.id, client);
      } catch (e) {
        results.set(group.id, null);
        console.warn(`AI classify failed for group ${group.id}:`, e.message);
      }
      done++;
      onProgress?.(done, groups.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, groups.length) }, worker);
  await Promise.all(workers);
  return results;
}
