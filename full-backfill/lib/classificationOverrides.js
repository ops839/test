// Apply per-client overrides from the "review all classifications" panel.
//
// overrides shape:
//   { [originalClientName]: { action: 'KEEP' | 'SKIP' | 'SWITCH' | 'RENAME', target?: string } }
//
//   KEEP    → no change (same as missing override)
//   SKIP    → drop every meeting in this group
//   SWITCH  → relabel to target (an existing client name)
//   RENAME  → relabel to target (a typed string)
//
// SWITCH/RENAME with empty/missing target falls back to the original client
// name so a half-typed override doesn't silently lose meetings.

export function applyClassificationOverrides(autoAssigned, reviewAssigned, overrides) {
  const result = [];
  for (const a of [...autoAssigned, ...reviewAssigned]) {
    const o = overrides[a.client];
    if (o?.action === 'SKIP') continue;
    const target =
      (o?.action === 'SWITCH' || o?.action === 'RENAME') && o.target
        ? o.target
        : a.client;
    result.push({ meeting: a.meeting, client: target });
  }
  return result;
}
