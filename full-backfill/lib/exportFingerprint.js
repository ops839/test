/**
 * Returns a SHA-1 hex string derived from the sorted folder names of a
 * slackdump export. Identical exports (same channels in any order) always
 * produce the same fingerprint; different exports produce a different one.
 * Used to scope the localStorage channel-mapping cache per export.
 */
export async function computeExportFingerprint(channels) {
  const folderNames = channels
    .map((ch) => ch.folderPath.split('/').pop())
    .sort();
  const input = folderNames.join('|');
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
