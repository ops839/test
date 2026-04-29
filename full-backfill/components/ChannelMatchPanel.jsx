import { useEffect, useMemo, useState } from 'react';
import { KNOWN_CLIENTS } from '../../src/lib/classifier.js';
import { computeExportFingerprint } from '../lib/exportFingerprint.js';
import { SLACK_CUTOFF_DAYS, cutoffDateStr } from '../lib/cutoffs.js';

const CACHE_KEY = 'full-backfill:channel-cache-v1';
const PICK_UNSET = '';
const PICK_UNMATCHED = '__UNMATCHED__';
const PICK_NEW = '__NEW__';

export default function ChannelMatchPanel({ parsed, onComplete }) {
  const [exportId, setExportId] = useState(null);
  const [choices, setChoices] = useState({});

  // Compute fingerprint and hydrate cached choices when the export changes.
  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    computeExportFingerprint(parsed.channels).then((id) => {
      if (cancelled) return;
      setExportId(id);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        const cache = raw ? JSON.parse(raw) : {};
        setChoices(cache[id] ?? {});
      } catch {
        setChoices({});
      }
    });
    return () => { cancelled = true; };
  }, [parsed]);

  // Persist choices to localStorage under the current fingerprint.
  useEffect(() => {
    if (!exportId) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [exportId]: choices }));
    } catch {
      // quota: ignore
    }
  }, [choices, exportId]);

  const allChannelsSet = useMemo(() => {
    if (!parsed) return false;
    return parsed.channels.every((ch) => {
      const folderKey = ch.folderPath.split('/').pop();
      return (choices[folderKey] ?? PICK_UNSET) !== PICK_UNSET;
    });
  }, [parsed, choices]);

  function handleChoiceChange(folderKey, value) {
    setChoices((prev) => ({ ...prev, [folderKey]: value }));
  }

  function handleContinue() {
    const cutoff = cutoffDateStr(SLACK_CUTOFF_DAYS);
    const assignments = [];
    for (const ch of parsed.channels) {
      const folderKey = ch.folderPath.split('/').pop();
      const choice = choices[folderKey] ?? PICK_UNSET;
      const targetClient =
        choice === PICK_UNMATCHED ? null :
        choice === PICK_NEW ? folderKey :
        choice;
      for (const bucket of ch.dayBuckets) {
        assignments.push({
          targetClient,
          channelName: ch.name,
          date: bucket.date,
          eligible: bucket.date >= cutoff,
          bucket,
        });
      }
    }
    onComplete(assignments);
  }

  if (!parsed) return null;

  const cutoff = cutoffDateStr(SLACK_CUTOFF_DAYS);

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">2b.</span>Map Slack channels to clients
      </h2>
      <p className="text-xs text-bm-muted">
        Assign each channel to an Airtable client table. Buckets older than{' '}
        {SLACK_CUTOFF_DAYS} days (before {cutoff}) are shown but won&apos;t be
        summarized or written. Mappings are cached per export — re-uploading the
        same export restores them.
      </p>

      {!exportId && (
        <p className="text-xs text-bm-muted">Computing export fingerprint…</p>
      )}

      {exportId && (
        <>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-bm-border">
            <table className="w-full text-sm">
              <thead className="bg-bm-border/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Channel</th>
                  <th className="text-left px-3 py-2 font-medium text-bm-text">Client table</th>
                  <th className="text-right px-3 py-2 font-medium text-bm-text">Buckets</th>
                  <th className="text-right px-3 py-2 font-medium text-bm-text">
                    &le;{SLACK_CUTOFF_DAYS}d
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsed.channels.map((ch) => {
                  const folderKey = ch.folderPath.split('/').pop();
                  const choice = choices[folderKey] ?? PICK_UNSET;
                  const eligible = ch.dayBuckets.filter((b) => b.date >= cutoff).length;
                  return (
                    <tr key={ch.folderPath} className="border-t border-bm-border">
                      <td className="px-3 py-2 font-mono text-bm-text align-top">
                        #{ch.name}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={choice}
                          onChange={(e) => handleChoiceChange(folderKey, e.target.value)}
                          className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm text-bm-text focus:outline-none focus:border-bm-accent"
                        >
                          <option value={PICK_UNSET} disabled>Pick one…</option>
                          <option value={PICK_UNMATCHED}>Unmatched</option>
                          <optgroup label="Clients">
                            {KNOWN_CLIENTS.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </optgroup>
                          <option value={PICK_NEW}>Create new sheet: {folderKey}</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right text-bm-muted align-top">
                        {ch.dayBuckets.length}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <span className={eligible > 0 ? 'text-bm-accent' : 'text-bm-muted'}>
                          {eligible}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              disabled={!allChannelsSet}
              onClick={handleContinue}
              className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              Continue
            </button>
            {!allChannelsSet && (
              <p className="text-xs text-bm-muted">
                Assign every channel to continue.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
