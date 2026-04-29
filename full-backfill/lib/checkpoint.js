// Crash-recovery checkpoint stored in localStorage. Saved before any Airtable
// mutation so a mid-run crash can resume from a known point. Spec section 7
// item 7: 7-day TTL on read so stale checkpoints from old runs don't confuse
// the resume UI.

const KEY = 'full-backfill:checkpoint-v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function saveCheckpoint(state) {
  try {
    const payload = { savedAt: Date.now(), state };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or storage unavailable: silently drop
  }
}

export function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { savedAt, state } = parsed;
    if (typeof savedAt !== 'number' || Date.now() - savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function clearCheckpoint() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
