import { useMemo, useState } from 'react';
import { KNOWN_CLIENTS } from '../lib/classifier';

const SKIP = '__skip__';
const INTERNAL = '__internal__';

function kindLabel(kind) {
  if (kind === 'domain') return 'Domain';
  if (kind === 'name') return 'Name';
  return 'Singleton';
}

function SampleTitles({ meetings }) {
  const samples = meetings.slice(0, 3).map((m, i) => (
    <div key={i} className="truncate">
      <span className="text-gray-400 mr-1">•</span>
      {m.title || '(untitled)'}{' '}
      <span className="text-gray-400 text-[11px]">{m.date}</span>
    </div>
  ));
  const extra = meetings.length > 3 ? (
    <div className="text-gray-400 text-[11px] mt-0.5">+ {meetings.length - 3} more</div>
  ) : null;
  return <div className="space-y-0.5 text-[13px]">{samples}{extra}</div>;
}

export default function ReviewPanel({ groups, aiSuggestions, onConfirm }) {
  // decisions[groupId] = explicit user choice (client | INTERNAL | SKIP). Undefined means
  // "no user choice yet" — we fall back to AI suggestion at read time so the dropdown
  // reflects the AI default without copying it into state (avoids set-state-in-effect).
  const [decisions, setDecisions] = useState({});
  const [checked, setChecked] = useState({});

  const effective = (id) => {
    if (decisions[id] !== undefined) return decisions[id];
    const ai = aiSuggestions?.get(id);
    if (ai && KNOWN_CLIENTS.includes(ai)) return ai;
    return '';
  };

  const summary = useMemo(() => {
    const s = { assigned: 0, internal: 0, skip: 0, undecided: 0 };
    for (const g of groups) {
      const d = effective(g.id);
      const n = g.meetings.length;
      if (!d) s.undecided += n;
      else if (d === SKIP) s.skip += n;
      else if (d === INTERNAL) s.internal += n;
      else s.assigned += n;
    }
    return s;
    // effective() reads decisions + aiSuggestions, both deps captured below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions, groups, aiSuggestions]);

  const setDecision = (id, v) =>
    setDecisions((prev) => ({ ...prev, [id]: v }));
  const toggleCheck = (id) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const anyChecked = groups.some((g) => checked[g.id]);
  const allChecked = groups.length > 0 && groups.every((g) => checked[g.id]);
  const toggleAll = () => {
    const v = !allChecked;
    const next = {};
    for (const g of groups) next[g.id] = v;
    setChecked(next);
  };

  const skipSelected = () => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const g of groups) if (checked[g.id]) next[g.id] = SKIP;
      return next;
    });
    setChecked({});
  };

  const skipUnmapped = () => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        const d = effective(g.id);
        if (!d || d === INTERNAL || d === SKIP) next[g.id] = SKIP;
      }
      return next;
    });
  };

  const unmappedCount = groups.reduce((n, g) => {
    const d = effective(g.id);
    return n + (!d || d === INTERNAL || d === SKIP ? 1 : 0);
  }, 0);

  const confirm = () => {
    const finalized = [];
    for (const g of groups) {
      const d = effective(g.id);
      const client = !d || d === SKIP || d === INTERNAL ? null : d;
      for (const m of g.meetings) finalized.push({ meeting: m, client });
    }
    onConfirm(finalized);
  };

  if (groups.length === 0) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            Review uncertain meetings ({groups.length} group{groups.length !== 1 ? 's' : ''})
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Each group shares a domain or meeting name — one decision per group applies to every
            meeting in it. Assign a client, mark Internal, or Skip. Anything undecided at Confirm is
            skipped.
          </p>
        </div>
        <div className="text-xs text-gray-500 text-right shrink-0">
          <div>
            <span className="text-green-700 font-semibold">{summary.assigned}</span> meetings
            assigned
          </div>
          <div>
            <span className="text-gray-600">{summary.internal + summary.skip}</span> internal/skip
          </div>
          <div>
            <span className="text-amber-600">{summary.undecided}</span> undecided
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
          Select all
        </label>
        <button
          onClick={skipSelected}
          disabled={!anyChecked}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Skip selected
        </button>
        <button
          onClick={skipUnmapped}
          disabled={unmappedCount === 0}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Mark every unassigned group as Skip; keeps assigned groups intact."
        >
          Skip unmapped only ({unmappedCount})
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="w-10 p-2"></th>
              <th className="text-left p-2">Kind</th>
              <th className="text-left p-2">Key</th>
              <th className="text-left p-2">Count</th>
              <th className="text-left p-2">Sample titles</th>
              <th className="text-left p-2">Attendees (sample)</th>
              <th className="text-left p-2 w-64">Assign to</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const ai = aiSuggestions?.get(g.id);
              const d = effective(g.id);
              const isAiDefault = ai && d === ai && decisions[g.id] === undefined;
              return (
                <tr key={g.id} className="border-t border-gray-100 align-top">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={!!checked[g.id]}
                      onChange={() => toggleCheck(g.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="p-2 text-gray-600">{kindLabel(g.kind)}</td>
                  <td className="p-2 font-mono text-xs text-gray-700">{g.key}</td>
                  <td className="p-2 text-gray-600">{g.meetings.length}</td>
                  <td className="p-2 max-w-sm text-gray-700">
                    <SampleTitles meetings={g.meetings} />
                  </td>
                  <td className="p-2 text-gray-500 text-xs max-w-xs truncate">
                    {g.meetings[0]?.attendees || '—'}
                  </td>
                  <td className="p-2">
                    <select
                      value={d}
                      onChange={(e) => setDecision(g.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
                    >
                      <option value="">— choose —</option>
                      <option value={INTERNAL}>Internal</option>
                      <option value={SKIP}>Skip</option>
                      {ai && (
                        <optgroup label="AI suggestion">
                          <option value={ai}>(AI) {ai}</option>
                        </optgroup>
                      )}
                      <optgroup label="Clients">
                        {KNOWN_CLIENTS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {isAiDefault && (
                      <p className="text-[11px] text-indigo-600 mt-1">AI default — confirm below.</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          onClick={confirm}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
        >
          Confirm all
        </button>
      </div>
    </section>
  );
}
