import { useEffect, useMemo, useState } from 'react';
import {
  getBaseSchema,
  wipeTable,
  insertRecords,
  findMissingTables,
  findMissingColumns,
  REQUIRED_COLUMNS,
} from '../lib/airtable.js';
import { saveCheckpoint, clearCheckpoint } from '../lib/checkpoint.js';
import { AIRTABLE_BASE_ID, AIRTABLE_PAT } from '../lib/secrets.js';

const SECRETS_VALID =
  typeof AIRTABLE_PAT === 'string' &&
  !AIRTABLE_PAT.endsWith('...') &&
  typeof AIRTABLE_BASE_ID === 'string' &&
  !AIRTABLE_BASE_ID.endsWith('...');

// Phases:
//   needs-secrets  → secrets.js still holds placeholders
//   preflight      → fetching base schema
//   halted-tables  → schema returned, but client tables missing
//   halted-cols    → tables exist but required columns missing
//   ready          → preflight passed, awaiting confirmation
//   writing        → wipe + insert in progress
//   done           → all writes succeeded
//   error          → schema fetch or write failed; retry button shown

export default function AirtableWritePanel({ rows, onComplete }) {
  const [phase, setPhase] = useState(SECRETS_VALID ? 'preflight' : 'needs-secrets');
  const [error, setError] = useState(null);
  const [missingTables, setMissingTables] = useState([]);
  const [columnIssues, setColumnIssues] = useState([]);
  const [progress, setProgress] = useState({});

  const byClient = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!r.targetClient) continue;
      if (!m.has(r.targetClient)) m.set(r.targetClient, []);
      m.get(r.targetClient).push(r);
    }
    return m;
  }, [rows]);

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
          setPhase('halted-tables');
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

  async function runWrites() {
    setPhase('writing');
    setError(null);
    saveCheckpoint({ rows, startedAt: Date.now() });
    try {
      for (const [client, clientRows] of byClient) {
        await wipeTable(AIRTABLE_BASE_ID, client, AIRTABLE_PAT, (done, total) => {
          setProgress((p) => ({ ...p, [client]: { ...(p[client] ?? {}), wipe: { done, total } } }));
        });
        await insertRecords(
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
      }
      clearCheckpoint();
      setPhase('done');
      onComplete?.();
    } catch (e) {
      setError(e.message || String(e));
      setPhase('error');
    }
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

      {phase === 'halted-tables' && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">
            These clients have no table in the base. Create them in Airtable then rerun:
          </p>
          <ul className="text-sm text-bm-text font-mono pl-4 space-y-1">
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
        </div>
      )}

      {phase === 'writing' && (
        <div className="space-y-2">
          <p className="text-sm text-bm-text">Writing to Airtable…</p>
          <div className="space-y-1 text-xs font-mono text-bm-muted max-h-64 overflow-y-auto">
            {targetClients.map((c) => {
              const p = progress[c];
              if (!p) return <div key={c}>· {c}: queued</div>;
              const wipe = p.wipe ? `wiped ${p.wipe.done}/${p.wipe.total}` : 'wipe…';
              const ins = p.insert ? `inserted ${p.insert.done}/${p.insert.total}` : '';
              return <div key={c}>· {c}: {wipe} {ins && `→ ${ins}`}</div>;
            })}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <p className="text-sm text-bm-accent">
          ✓ Wrote {totalRows} row{totalRows !== 1 ? 's' : ''} across {targetClients.length} table{targetClients.length !== 1 ? 's' : ''}. Checkpoint cleared.
        </p>
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
