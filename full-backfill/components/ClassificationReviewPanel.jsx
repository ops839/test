import { useEffect, useMemo, useState } from 'react';
import { KNOWN_CLIENTS } from '../../src/lib/classifier.js';
import { computeSybillFingerprint } from '../lib/sybillFingerprint.js';
import { applyClassificationOverrides } from '../lib/classificationOverrides.js';

const CACHE_KEY = 'full-backfill:classification-overrides-v1';

export default function ClassificationReviewPanel({
  autoAssigned,
  reviewAssigned,
  meetings,
  onComplete,
}) {
  const [fingerprint, setFingerprint] = useState(null);
  const [overrides, setOverrides] = useState({});

  // Compute fingerprint and hydrate cached overrides when meetings change.
  useEffect(() => {
    if (!meetings) return;
    let cancelled = false;
    computeSybillFingerprint(meetings).then((fp) => {
      if (cancelled) return;
      setFingerprint(fp);
      try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        setOverrides(cache[fp] ?? {});
      } catch {
        setOverrides({});
      }
    });
    return () => { cancelled = true; };
  }, [meetings]);

  // Persist overrides to localStorage under the current fingerprint.
  useEffect(() => {
    if (!fingerprint) return;
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      cache[fingerprint] = overrides;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // quota: ignore
    }
  }, [overrides, fingerprint]);

  const byClient = useMemo(() => {
    const m = new Map();
    for (const a of [...autoAssigned, ...reviewAssigned]) {
      if (!m.has(a.client)) m.set(a.client, []);
      m.get(a.client).push(a);
    }
    return m;
  }, [autoAssigned, reviewAssigned]);

  const sortedClients = useMemo(() => [...byClient.keys()].sort(), [byClient]);

  const finalCount = useMemo(
    () => applyClassificationOverrides(autoAssigned, reviewAssigned, overrides).length,
    [autoAssigned, reviewAssigned, overrides],
  );

  function setOverrideFor(client, next) {
    setOverrides((prev) => {
      const copy = { ...prev };
      if (!next || next.action === 'KEEP') {
        delete copy[client];
      } else {
        copy[client] = next;
      }
      return copy;
    });
  }

  function handleSelectChange(client, value) {
    if (value === 'KEEP') setOverrideFor(client, null);
    else if (value === 'SKIP') setOverrideFor(client, { action: 'SKIP' });
    else if (value === 'RENAME') {
      const existing = overrides[client]?.action === 'RENAME' ? overrides[client].target : '';
      setOverrideFor(client, { action: 'RENAME', target: existing ?? '' });
    } else if (value.startsWith('SWITCH:')) {
      setOverrideFor(client, { action: 'SWITCH', target: value.slice(7) });
    }
  }

  function handleRenameInput(client, value) {
    setOverrideFor(client, { action: 'RENAME', target: value });
  }

  function handleConfirm() {
    const finalAssignments = applyClassificationOverrides(
      autoAssigned,
      reviewAssigned,
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
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">2c.</span>Review all classifications
      </h2>
      <p className="text-xs text-bm-muted">
        {sortedClients.length} distinct client name{sortedClients.length !== 1 ? 's' : ''}.
        Override misclassifications below — decisions are remembered per export.
      </p>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-bm-border">
        <table className="w-full text-sm">
          <thead className="bg-bm-border/50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-bm-text">Client</th>
              <th className="text-left px-3 py-2 font-medium text-bm-text">Action</th>
              <th className="text-right px-3 py-2 font-medium text-bm-text">Meetings</th>
            </tr>
          </thead>
          <tbody>
            {sortedClients.map((client) => {
              const o = overrides[client];
              const count = byClient.get(client).length;
              const selectValue =
                o?.action === 'SKIP' ? 'SKIP' :
                o?.action === 'SWITCH' ? `SWITCH:${o.target}` :
                o?.action === 'RENAME' ? 'RENAME' :
                'KEEP';
              return (
                <tr key={client} className="border-t border-bm-border align-top">
                  <td className="px-3 py-2 font-mono text-bm-text">{client}</td>
                  <td className="px-3 py-2 space-y-1">
                    <select
                      value={selectValue}
                      onChange={(e) => handleSelectChange(client, e.target.value)}
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
                        onChange={(e) => handleRenameInput(client, e.target.value)}
                        placeholder="New client name"
                        className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-bm-muted">{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-bm-muted">
          {finalCount} meeting{finalCount !== 1 ? 's' : ''} after overrides
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
