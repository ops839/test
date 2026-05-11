import { useEffect, useMemo, useState } from 'react';
import { KNOWN_CLIENTS } from '../../src/lib/classifier.js';
import { computeSybillFingerprint } from '../lib/sybillFingerprint.js';
import { applyClassificationOverrides } from '../lib/classificationOverrides.js';

// One localStorage entry per export fingerprint:
//   full-backfill:classification-overrides-v1:<sybillFingerprint>
const CACHE_KEY_PREFIX = 'full-backfill:classification-overrides-v1';

// Human-readable labels for internal classification reasons.
const REASON_LABELS = {
  'all-bm': 'All attendees @blumountain.me',
  'all-personal': 'All attendees on personal domains (gmail, yahoo, etc.)',
  'mixed-bm-personal': 'Mix of @blumountain.me and personal-domain attendees',
};

const SAMPLE_LIMIT = 3;

function sampleTitles(group) {
  const titles = group.map((g) => g.meeting?.title || '(untitled)');
  const head = titles.slice(0, SAMPLE_LIMIT).join(', ');
  return titles.length > SAMPLE_LIMIT
    ? `${head} + ${titles.length - SAMPLE_LIMIT} more`
    : head;
}

// Detect and normalise the cached overrides shape. Older (Commit A/D) caches
// stored a flat client-overrides map; treat that as { clients }.
function normalizeOverrides(raw) {
  if (!raw || typeof raw !== 'object') return { clients: {}, reasons: {} };
  if (raw.clients !== undefined || raw.reasons !== undefined) {
    return { clients: raw.clients ?? {}, reasons: raw.reasons ?? {} };
  }
  return { clients: raw, reasons: {} };
}

export default function ClassificationReviewPanel({
  autoAssigned,
  reviewAssigned,
  internal,
  uncertainGroupsCount,
  meetings,
  onComplete,
}) {
  const [fingerprint, setFingerprint] = useState(null);
  const [overrides, setOverrides] = useState({ clients: {}, reasons: {} });

  // Compute fingerprint and hydrate cached overrides when meetings change.
  useEffect(() => {
    if (!meetings) return;
    let cancelled = false;
    computeSybillFingerprint(meetings).then((fp) => {
      if (cancelled) return;
      setFingerprint(fp);
      try {
        const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}:${fp}`);
        setOverrides(normalizeOverrides(raw ? JSON.parse(raw) : null));
      } catch {
        setOverrides({ clients: {}, reasons: {} });
      }
    });
    return () => { cancelled = true; };
  }, [meetings]);

  // Persist overrides to a per-fingerprint localStorage key.
  useEffect(() => {
    if (!fingerprint) return;
    try {
      localStorage.setItem(`${CACHE_KEY_PREFIX}:${fingerprint}`, JSON.stringify(overrides));
    } catch {
      // quota: ignore
    }
  }, [overrides, fingerprint]);

  // Group auto-assigned + reviewed by client name.
  const byClient = useMemo(() => {
    const m = new Map();
    for (const a of [...autoAssigned, ...reviewAssigned]) {
      if (!m.has(a.client)) m.set(a.client, []);
      m.get(a.client).push(a);
    }
    return m;
  }, [autoAssigned, reviewAssigned]);

  // Group internal by reason.
  const byReason = useMemo(() => {
    const m = new Map();
    for (const i of internal) {
      const key = i.reason || 'unknown';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(i);
    }
    return m;
  }, [internal]);

  const sortedClients = useMemo(() => [...byClient.keys()].sort(), [byClient]);
  const sortedReasons = useMemo(() => [...byReason.keys()].sort(), [byReason]);

  // Final preview count (after overrides applied).
  const finalCount = useMemo(
    () => applyClassificationOverrides(autoAssigned, reviewAssigned, internal, overrides).length,
    [autoAssigned, reviewAssigned, internal, overrides],
  );

  // Math summary numbers.
  const assignedTotal = autoAssigned.length + reviewAssigned.length;
  const internalTotal = internal.length;
  const reviewedTotal = reviewAssigned.length;
  const grandTotal = assignedTotal + internalTotal;

  function setClientOverride(client, next) {
    setOverrides((prev) => {
      const copy = { ...prev, clients: { ...(prev.clients ?? {}) } };
      if (!next || next.action === 'KEEP') {
        delete copy.clients[client];
      } else {
        copy.clients[client] = next;
      }
      return copy;
    });
  }

  function setReasonOverride(reason, next) {
    setOverrides((prev) => {
      const copy = { ...prev, reasons: { ...(prev.reasons ?? {}) } };
      if (!next || next.action === 'KEEP') {
        delete copy.reasons[reason];
      } else {
        copy.reasons[reason] = next;
      }
      return copy;
    });
  }

  function handleClientSelectChange(client, value) {
    if (value === 'KEEP') setClientOverride(client, null);
    else if (value === 'SKIP') setClientOverride(client, { action: 'SKIP' });
    else if (value === 'RENAME') {
      const existing = overrides.clients?.[client]?.action === 'RENAME'
        ? overrides.clients[client].target
        : '';
      setClientOverride(client, { action: 'RENAME', target: existing ?? '' });
    } else if (value.startsWith('SWITCH:')) {
      setClientOverride(client, { action: 'SWITCH', target: value.slice(7) });
    }
  }

  function handleClientRenameInput(client, value) {
    setClientOverride(client, { action: 'RENAME', target: value });
  }

  function handleReasonSelectChange(reason, value) {
    if (value === 'KEEP') setReasonOverride(reason, null);
    else if (value === 'ASSIGN_NEW') {
      const existing = overrides.reasons?.[reason]?.target;
      setReasonOverride(reason, { action: 'ASSIGN', target: existing ?? '' });
    } else if (value.startsWith('ASSIGN:')) {
      setReasonOverride(reason, { action: 'ASSIGN', target: value.slice(7) });
    }
  }

  function handleReasonNewNameInput(reason, value) {
    setReasonOverride(reason, { action: 'ASSIGN', target: value });
  }

  function handleConfirm() {
    const finalAssignments = applyClassificationOverrides(
      autoAssigned,
      reviewAssigned,
      internal,
      overrides,
    );
    onComplete(finalAssignments);
  }

  if (!fingerprint) {
    return (
      <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
        <h2 className="text-base font-semibold text-bm-text">
          <span className="text-bm-accent mr-2">2c.</span>Review all classifications
        </h2>
        <p className="text-xs text-bm-muted">Computing export fingerprint…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-6">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">2c.</span>Review all classifications
      </h2>

      {/* Math summary */}
      <div className="rounded-lg border border-bm-border bg-bm-bg/40 p-4 space-y-1 text-sm">
        <div className="text-bm-text">
          <span className="font-medium text-bm-accent">{assignedTotal}</span>{' '}
          meeting{assignedTotal !== 1 ? 's' : ''} assigned to clients{' '}
          <span className="text-bm-muted">({byClient.size} group{byClient.size !== 1 ? 's' : ''})</span>
        </div>
        <div className="text-bm-text">
          <span className="font-medium text-bm-accent">{internalTotal}</span>{' '}
          meeting{internalTotal !== 1 ? 's' : ''} flagged Internal/Skip{' '}
          <span className="text-bm-muted">({byReason.size} group{byReason.size !== 1 ? 's' : ''})</span>
        </div>
        <div className="text-bm-muted">
          <span className="font-medium">{reviewedTotal}</span> reviewed from{' '}
          <span className="font-medium">{uncertainGroupsCount}</span> uncertain group{uncertainGroupsCount !== 1 ? 's' : ''}
          {' '}(now resolved)
        </div>
        <div className="text-bm-text pt-1 border-t border-bm-border/50 mt-2">
          Total in window: <span className="font-medium text-bm-accent">{grandTotal}</span>
        </div>
      </div>

      {/* Auto-assigned section */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-bm-text">
          Auto-assigned to clients ({byClient.size})
        </h3>
        <p className="text-xs text-bm-muted">
          Every distinct client name the classifier produced. Override any
          misclassification below — decisions are remembered per export.
        </p>
        {sortedClients.length === 0 ? (
          <p className="text-xs text-bm-muted italic">No auto-assigned meetings.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-bm-border">
            <table className="w-full text-sm">
              <thead className="bg-bm-border/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Client</th>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Action</th>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Sample titles</th>
                  <th className="text-right px-3 py-2 font-medium text-bm-text">Count</th>
                </tr>
              </thead>
              <tbody>
                {sortedClients.map((client) => {
                  const group = byClient.get(client);
                  const o = overrides.clients?.[client];
                  const selectValue =
                    o?.action === 'SKIP' ? 'SKIP' :
                    o?.action === 'SWITCH' ? `SWITCH:${o.target}` :
                    o?.action === 'RENAME' ? 'RENAME' :
                    'KEEP';
                  return (
                    <tr key={client} className="border-t border-bm-border align-top">
                      <td className="px-3 py-2 font-mono text-bm-text">{client}</td>
                      <td className="px-3 py-2 space-y-1 min-w-[14rem]">
                        <select
                          value={selectValue}
                          onChange={(e) => handleClientSelectChange(client, e.target.value)}
                          className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                        >
                          <option value="KEEP">Keep &quot;{client}&quot;</option>
                          <option value="SKIP">Skip / Internal (drop)</option>
                          <optgroup label="Switch to existing client">
                            {KNOWN_CLIENTS.filter((c) => c !== client).map((c) => (
                              <option key={c} value={`SWITCH:${c}`}>{c}</option>
                            ))}
                          </optgroup>
                          <option value="RENAME">Rename to new name…</option>
                        </select>
                        {o?.action === 'RENAME' && (
                          <input
                            type="text"
                            value={o.target ?? ''}
                            onChange={(e) => handleClientRenameInput(client, e.target.value)}
                            placeholder="New client name"
                            className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-bm-muted">{sampleTitles(group)}</td>
                      <td className="px-3 py-2 text-right text-bm-muted">{group.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Internal/Skip section */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-bm-text">
          Flagged as Internal/Skip ({byReason.size})
        </h3>
        <p className="text-xs text-bm-muted">
          Meetings the classifier dropped because every attendee was BM or
          personal. If any group looks like a real client, resurrect it via
          the dropdown.
        </p>
        {sortedReasons.length === 0 ? (
          <p className="text-xs text-bm-muted italic">No Internal/Skip meetings.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-bm-border">
            <table className="w-full text-sm">
              <thead className="bg-bm-border/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Reason</th>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Action</th>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Sample titles</th>
                  <th className="text-right px-3 py-2 font-medium text-bm-text">Count</th>
                </tr>
              </thead>
              <tbody>
                {sortedReasons.map((reason) => {
                  const group = byReason.get(reason);
                  const o = overrides.reasons?.[reason];
                  const selectValue =
                    o?.action === 'ASSIGN' && o.target && !KNOWN_CLIENTS.includes(o.target)
                      ? 'ASSIGN_NEW'
                      : o?.action === 'ASSIGN'
                        ? `ASSIGN:${o.target}`
                        : 'KEEP';
                  return (
                    <tr key={reason} className="border-t border-bm-border align-top">
                      <td className="px-3 py-2 text-bm-text">
                        {REASON_LABELS[reason] ?? reason}
                      </td>
                      <td className="px-3 py-2 space-y-1 min-w-[14rem]">
                        <select
                          value={selectValue}
                          onChange={(e) => handleReasonSelectChange(reason, e.target.value)}
                          className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                        >
                          <option value="KEEP">Keep as Internal/Skip (drop)</option>
                          <optgroup label="Resurrect — assign all to existing client">
                            {KNOWN_CLIENTS.map((c) => (
                              <option key={c} value={`ASSIGN:${c}`}>{c}</option>
                            ))}
                          </optgroup>
                          <option value="ASSIGN_NEW">Resurrect — new client name…</option>
                        </select>
                        {selectValue === 'ASSIGN_NEW' && (
                          <input
                            type="text"
                            value={o?.target ?? ''}
                            onChange={(e) => handleReasonNewNameInput(reason, e.target.value)}
                            placeholder="New client name"
                            className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-bm-muted">{sampleTitles(group)}</td>
                      <td className="px-3 py-2 text-right text-bm-muted">{group.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-bm-muted">
          {finalCount} meeting{finalCount !== 1 ? 's' : ''} will be written after overrides
        </p>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
        >
          Confirm classifications
        </button>
      </div>
    </section>
  );
}
