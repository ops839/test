// Apply per-group overrides from the "review all classifications" panel.
//
// overrides shape (nested by override domain):
//   {
//     clients: { [originalClientName]: { action: 'KEEP'|'SKIP'|'SWITCH'|'RENAME', target?: string } },
//     reasons: { [internalReasonCode]:  { action: 'KEEP'|'ASSIGN', target?: string } },
//   }
//
// Client overrides (auto-assigned + uncertain-reviewed buckets):
//   KEEP    → no change (same as missing override)
//   SKIP    → drop every meeting in this group
//   SWITCH  → relabel to target (an existing client name)
//   RENAME  → relabel to target (a typed string)
//
// Reason overrides (internal/skip bucket):
//   KEEP    → stay skipped (default; meeting not written)
//   ASSIGN  → resurrect every meeting in this reason group, assigned to target
//
// SWITCH/RENAME/ASSIGN with empty/missing target falls back safely
// (KEEP for clients, KEEP for reasons) so a half-typed override doesn't
// silently lose or duplicate meetings.

export function applyClassificationOverrides(autoAssigned, reviewAssigned, internal, overrides) {
  const clientOverrides = overrides?.clients ?? {};
  const reasonOverrides = overrides?.reasons ?? {};
  const result = [];

  // Auto-assigned + reviewed → start as assigned to a client.
  for (const a of [...autoAssigned, ...reviewAssigned]) {
    const o = clientOverrides[a.client];
    if (o?.action === 'SKIP') continue;
    const target =
      (o?.action === 'SWITCH' || o?.action === 'RENAME') && o.target
        ? o.target
        : a.client;
    result.push({ meeting: a.meeting, client: target });
  }

  // Internal → drop unless user explicitly resurrects via ASSIGN.
  for (const i of internal) {
    const o = reasonOverrides[i.reason];
    if (o?.action === 'ASSIGN' && o.target) {
      result.push({ meeting: i.meeting, client: o.target });
    }
  }

  return result;
}
