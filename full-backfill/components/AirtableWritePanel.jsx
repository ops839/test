import { useEffect, useMemo, useState } from 'react';
import {
  getBaseSchema,
  wipeTable,
  insertRecords,
  createTable,
  findMissingTables,
  findMissingColumns,
  REQUIRED_COLUMNS,
} from '../lib/airtable.js';
import { saveCheckpoint, clearCheckpoint } from '../lib/checkpoint.js';
import { AIRTABLE_BASE_ID, AIRTABLE_PAT } from '../lib/secrets.js';

const SECRETS_VALID =
  typeof AIRTABLE_PAT === 'string' && AIRTABLE_PAT.startsWith('pat') &&
  typeof AIRTABLE_BASE_ID === 'string' && AIRTABLE_BASE_ID.startsWith('app');

// Phases:
//   needs-secrets    → secrets.js still holds placeholders
//   preflight        → fetching base schema
//   missing-tables   → schema returned with missing tables; offer auto-create
//   creating-tables  → auto-create in progress
//   cancelled-create → user cancelled auto-create; manual fix + retry
//   halted-cols      → tables exist but required columns missing
//   ready            → preflight passed, awaiting confirmation
//   writing          → wipe + insert in progress
//   done             → all writes succeeded
//   error            → schema fetch or write failed; retry button shown

export default function AirtableWritePanel({ rows, onComplete }) {
  const [phase, setPhase] = useState(SECRETS_VALID ? 'preflight' : 'needs-secrets');
  const [mode, setMode] = useState('full'); // 'full' | 'slack-only'
  const [error, setError] = useState(null);
  const [missingTables, setMissingTables] = useState([]);
  const [columnIssues, setColumnIssues] = useState([]);
  const [progress, setProgress] = useState({});
  const [createProgress, setCreateProgress] = useState({ done: 0, total: 0 });

  // Row-type breakdown over the FULL rows prop (informational; not mode-filtered).
  const allRowsByType = useMemo(() => {
    let meetings = 0;
    let slack = 0;
    let other = 0;
    for (const r of rows) {
      const t = r.fields?.['Type of Engagement'];
      if (t === 'Meeting') meetings++;
      else if (t === 'Slack messages') slack++;
      else other++;
    }
    return { meetings, slack, other };
  }, [rows]);

  // byClient respects current mode: in 'slack-only' we keep only Slack-typed rows.
  const byClient = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!r.targetClient) continue;
      if (mode === 'slack-only' && r.fields?.['Type of Engagement'] !== 'Slack messages') continue;
      if (!m.has(r.targetClient)) m.set(r.targetClient, []);
      m.get(r.targetClient).push(r);
    }
    return m;
  }, [rows, mode]);

  const targetClients = useMemo(() => [...byClient.keys()].sort(), [byClient]);

  useEffect(() => {
    if (phase !== 'preflight') return;
    let cancelled = false;
    (async () => {
      try {
        const schema = await getBaseSchema(AIRTABLE_BASE_ID, AIRTABLE_PAT);
        if (cancelled) return;
        const missing = findMissingTables(schema, targetClients);
        if (missing.length > 0) {
          setMissingTables(missing);
          setPhase('missing-tables');
          return;
        }
        const issues = [];
        for (const t of schema) {
          if (!targetClients.includes(t.name)) continue;
          const missingCols = findMissingColumns(t, REQUIRED_COLUMNS);
          if (missingCols.length > 0) issues.push({ table: t.name, columns: missingCols });
        }
        if (issues.length > 0) {
          setColumnIssues(issues);
          setPhase('halted-cols');
          return;
        }
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e.message || String(e));
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [phase, targetClients]);

  async function createMissingTables() {
    setPhase('creating-tables');
    setError(null);
    setCreateProgress({ done: 0, total: missingTables.length });
    try {
      for (let i = 0; i < missingTables.length; i++) {
        await createTable(AIRTABLE_BASE_ID, missingTables[i], AIRTABLE_PAT);
        setCreateProgress({ done: i + 1, total: missingTables.length });
      }
      // Re-run preflight so the new tables are picked up.
      setMissingTables([]);
      setPhase('preflight');
    } catch (e) {
      setError(e.message || String(e));
      setPhase('error');
    }
  }

  function cancelCreate() {
    setPhase('cancelled-create');
  }

  async function runWrites() {
    const isSlackOnly = mode === 'slack-only';
    setPhase('writing');
    setError(null);
    setProgress({});
    saveCheckpoint({ rows, mode, startedAt: Date.now() });
    try {
      for (const [client, clientRows] of byClient) {
        if (!isSlackOnly) {
          await wipeTable(AIRTABLE_BASE_ID, client, AIRTABLE_PAT, (done, total) => {
            setProgress((p) => ({ ...p, [client]: { ...(p[client] ?? {}), wipe: { done, total } } }));
          });
        }
        const sent = clientRows.length;
        const confirmed = await insertRecords(
          AIRTABLE_BASE_ID,
          client,
          clientRows.map((r) => r.fields),
          AIRTABLE_PAT,
          (done, total) => {
            setProgress((p) => ({
              ...p,
              [client]: { ...(p[client] ?? {}), insert: { done, total } },
            }));
          },
        );
        setProgress((p) => ({
          ...p,
          [client]: { ...(p[client] ?? {}), sent, confirmed },
        }));
      }
      clearCheckpoint();
      setPhase('done');
      onComplete?.();
    } catch (e) {
      setError(e.message || String(e));
      setPhase('error');
    }
  }

  function switchToSlackOnly() {
    setMode('slack-only');
    setPhase('preflight');
    setError(null);
    setMissingTables([]);
    setColumnIssues([]);
    setProgress({});
  }

  function retry() {
    setPhase('preflight');
    setError(null);
    setMissingTables([]);
    setColumnIssues([]);
  }

  const totalRows = [...byClient.values()].reduce((n, arr) => n + arr.length, 0);

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">6.</span>Write to Airtable
      </h2>

      {phase === 'needs-secrets' && (
        <p className="text-sm text-bm-muted">
          Set <code className="text-bm-accent">AIRTABLE_BASE_ID</code> and{' '}
          <code className="text-bm-accent">AIRTABLE_PAT</code> in{' '}
          <code className="text-bm-accent">full-backfill/lib/secrets.js</code> to enable writes.
          See <code>secrets.template.js</code> for the shape.
        </p>
      )}

      {phase === 'preflight' && (
        <p className="text-sm text-bm-muted">Reading Airtable base schema…</p>
      )}

      {phase === 'missing-tables' && (
        <div className="space-y-3">
          <p className="text-sm text-bm-text">
            These {missingTables.length} client table{missingTables.length !== 1 ? 's' : ''} don&apos;t exist yet:
          </p>
          <ul className="text-sm text-bm-text font-mono pl-4 space-y-1 max-h-40 overflow-y-auto">
            {missingTables.map((c) => (<li key={c}>• {c}</li>))}
          </ul>
          <p className="text-xs text-bm-muted">
            They will be created with the v2 schema (Meeting Name, Engagement Date,
            Type of Engagement, Attendees, Summary, Action Items, Slack Message,
            Source). Existing client tables aren&apos;t touched.
          </p>
          <div className="flex gap-3 flex-wrap">
            <button onClick={createMissingTables} className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90">
              Yes, create {missingTables.length} table{missingTables.length !== 1 ? 's' : ''}
            </button>
            <button onClick={cancelCreate} className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'creating-tables' && (
        <div className="space-y-2">
          <p className="text-sm text-bm-text">
            Creating {createProgress.total} table{createProgress.total !== 1 ? 's' : ''}…
          </p>
          <p className="text-xs text-bm-muted font-mono">
            {createProgress.done} / {createProgress.total} created
          </p>
        </div>
      )}

      {phase === 'cancelled-create' && (
        <div className="space-y-2">
          <p className="text-sm text-bm-muted">
            Auto-create cancelled. Create the missing tables in Airtable manually,
            then click retry:
          </p>
          <ul className="text-sm text-bm-text font-mono pl-4 space-y-1 max-h-40 overflow-y-auto">
            {missingTables.map((c) => (<li key={c}>• {c}</li>))}
          </ul>
          <button onClick={retry} className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim">
            Retry preflight
          </button>
        </div>
      )}

      {phase === 'halted-cols' && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">
            Required columns missing from these tables. Add them in Airtable then rerun:
          </p>
          <ul className="text-sm text-bm-text font-mono pl-4 space-y-1">
            {columnIssues.map((iss) => (
              <li key={iss.table}>• {iss.table}: {iss.columns.join(', ')}</li>
            ))}
          </ul>
          <button onClick={retry} className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim">
            Retry preflight
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="space-y-3">
          <p className="text-xs text-bm-muted">
            Row breakdown — Meetings: <span className="text-bm-text">{allRowsByType.meetings}</span>,{' '}
            Slack messages: <span className="text-bm-text">{allRowsByType.slack}</span>
            {allRowsByType.other > 0 && (
              <>, Other: <span className="text-bm-text">{allRowsByType.other}</span></>
            )}
          </p>
          {mode === 'full' ? (
            <>
              <p className="text-sm text-bm-text">
                About to wipe <span className="text-bm-accent font-semibold">{targetClients.length}</span>{' '}
                table{targetClients.length !== 1 ? 's' : ''} and insert{' '}
                <span className="text-bm-accent font-semibold">{totalRows}</span> row{totalRows !== 1 ? 's' : ''}.
              </p>
              <p className="text-xs text-bm-muted">
                All existing rows in target tables will be deleted before insert. Manual edits will be lost.
              </p>
              <button onClick={runWrites} className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90">
                Wipe and write
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-bm-text">
                Slack-only mode: about to insert{' '}
                <span className="text-bm-accent font-semibold">{totalRows}</span>{' '}
                Slack row{totalRows !== 1 ? 's' : ''} across{' '}
                <span className="text-bm-accent font-semibold">{targetClients.length}</span>{' '}
                table{targetClients.length !== 1 ? 's' : ''}. <em>No wipe.</em>{' '}
                Existing Sybill rows are preserved.
              </p>
              <p className="text-xs text-bm-muted">
                If you run this twice you&apos;ll get duplicate Slack rows. Run once.
              </p>
              <button onClick={runWrites} className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90">
                Insert Slack rows only (no wipe)
              </button>
            </>
          )}
        </div>
      )}

      {phase === 'writing' && (
        <div className="space-y-2">
          <p className="text-sm text-bm-text">
            Writing to Airtable{mode === 'slack-only' ? ' (Slack-only, no wipe)' : '…'}
          </p>
          <div className="space-y-1 text-xs font-mono text-bm-muted max-h-64 overflow-y-auto">
            {targetClients.map((c) => {
              const p = progress[c];
              if (!p) return <div key={c}>· {c}: queued</div>;
              const wipe = p.wipe ? `wiped ${p.wipe.done}/${p.wipe.total}` : (mode === 'slack-only' ? '' : 'wipe…');
              const ins = p.insert ? `inserted ${p.insert.done}/${p.insert.total}` : '';
              const mismatch = p.sent != null && p.confirmed != null && p.confirmed !== p.sent
                ? ` ⚠ confirmed ${p.confirmed}/${p.sent}`
                : '';
              return <div key={c}>· {c}: {wipe} {ins && `→ ${ins}`}{mismatch}</div>;
            })}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-3">
          <p className="text-sm text-bm-accent">
            ✓ {mode === 'slack-only' ? 'Inserted' : 'Wrote'} {totalRows} row{totalRows !== 1 ? 's' : ''} across{' '}
            {targetClients.length} table{targetClients.length !== 1 ? 's' : ''}.
            {mode === 'full' && ' Checkpoint cleared.'}
          </p>
          {(() => {
            const mismatches = Object.entries(progress)
              .filter(([, p]) => p.sent != null && p.confirmed != null && p.confirmed !== p.sent);
            if (mismatches.length === 0) return null;
            return (
              <div className="rounded-lg border border-red-400/40 bg-red-400/5 p-3 space-y-1 text-xs">
                <p className="text-red-400 font-medium">
                  ⚠ Airtable confirmed fewer records than sent on {mismatches.length} table{mismatches.length !== 1 ? 's' : ''}:
                </p>
                <ul className="text-bm-muted font-mono pl-4">
                  {mismatches.map(([c, p]) => (
                    <li key={c}>{c}: sent {p.sent}, confirmed {p.confirmed}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {mode === 'full' && allRowsByType.slack > 0 && (
            <div className="border-t border-bm-border/50 pt-3 space-y-2">
              <p className="text-xs text-bm-muted">
                Slack rows missing from a table? Re-run the inserts only — no wipe, Sybill rows preserved.
              </p>
              <button
                onClick={switchToSlackOnly}
                className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim"
              >
                Write Slack rows only (no wipe)
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">Error: {error}</p>
          <p className="text-xs text-bm-muted">
            Checkpoint preserved. Click retry to restart from preflight; tables that finished writing
            this run will be wiped again on retry.
          </p>
          <button onClick={retry} className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim">
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
