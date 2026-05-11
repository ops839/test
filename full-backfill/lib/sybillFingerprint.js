// SHA-1 fingerprint over a Sybill meetings list. Used to scope
// classification-override caches: re-uploading the same export restores
// the user's prior overrides.

export async function computeSybillFingerprint(meetings) {
  const items = meetings.map((m) => `${m.date}|${m.title}`).sort();
  const input = items.join('\n');
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
