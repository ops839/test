// Cache Slack AI summaries by an assignments-derived fingerprint so refreshing
// or retrying the run doesn't re-spend. The signature is over the set of
// (channelName, date) pairs — stable across re-uploads of the same Slack
// export and robust to reordering.

const CACHE_KEY_PREFIX = 'full-backfill:slack-summaries-v1';

export async function computeSlackAssignmentsFingerprint(slackAssignments) {
  const items = slackAssignments
    .map((a) => `${a.channelName}|${a.date}`)
    .sort();
  const input = items.join('\n');
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Cache shape: { [`${channelName}|${date}`]: {summary, inputTokens, outputTokens} }
// Keyed by message identity (not array index) so it survives index shifts.
export function loadSlackSummaries(fingerprint) {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}:${fingerprint}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSlackSummaries(fingerprint, byKey) {
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}:${fingerprint}`, JSON.stringify(byKey));
  } catch {
    // quota: ignore
  }
}

// Convert summaries keyed by `originalIdx` (RunPanel internal) into the
// cache shape keyed by `channelName|date`.
export function summariesToCacheShape(slackAssignments, summariesByIdx) {
  const out = {};
  for (let i = 0; i < slackAssignments.length; i++) {
    const s = summariesByIdx[i];
    if (!s?.summary) continue;
    const a = slackAssignments[i];
    out[`${a.channelName}|${a.date}`] = s;
  }
  return out;
}

// Convert cache (keyed by `channelName|date`) into `originalIdx`-keyed summaries
// for the current slackAssignments. Unmatched keys are dropped; matching ones
// restored. Returns { [originalIdx]: summary }.
export function cacheToSummariesShape(slackAssignments, cache) {
  if (!cache) return {};
  const out = {};
  for (let i = 0; i < slackAssignments.length; i++) {
    const a = slackAssignments[i];
    const hit = cache[`${a.channelName}|${a.date}`];
    if (hit) out[i] = hit;
  }
  return out;
}
