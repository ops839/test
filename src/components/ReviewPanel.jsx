import { useState, useMemo } from 'react';
import { KNOWN_CLIENTS } from '../lib/classifier';

const SKIP = '__skip__';
const INTERNAL = '__internal__';

export default function ReviewPanel({ uncertain, onConfirm }) {
  // decision[i] = client name | INTERNAL | SKIP | '' (undecided)
  const [decisions, setDecisions] = useState(() => uncertain.map(() => ''));
  const [checked, setChecked] = useState(() => uncertain.map(() => false));

  const summary = useMemo(() => {
    const s = { assigned: 0, internal: 0, skip: 0, undecided: 0 };
    for (const d of decisions) {
      if (d === '' ) s.undecided++;
      else if (d === SKIP) s.skip++;
      else if (d === INTERNAL) s.internal++;
      else s.assigned++;
    }
    return s;
  }, [decisions]);

  const setDecision = (i, value) => {
    setDecisions((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const toggleCheck = (i) => {
    setChecked((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const allChecked = checked.length > 0 && checked.every(Boolean);
  const anyChecked = checked.some(Boolean);

  const toggleAll = () => {
    const next = !allChecked;
    setChecked(uncertain.map(() => next));
  };

  const skipSelected = () => {
    setDecisions((prev) => prev.map((d, i) => (checked[i] ? SKIP : d)));
    setChecked(uncertain.map(() => false));
  };

  const confirm = () => {
    const finalized = uncertain.map((m, i) => {
      const d = decisions[i];
      if (d === '' || d === SKIP || d === INTERNAL) return { meeting: m, client: null };
      return { meeting: m, client: d };
    });
    onConfirm(finalized);
  };

  if (uncertain.length === 0) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            Review uncertain meetings ({uncertain.length})
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            These meetings have a business-email attendee but no matched client. Assign each to a
            client, mark Internal, or Skip. Anything left undecided is skipped.
          </p>
        </div>
        <div className="text-xs text-gray-500 text-right shrink-0">
          <div><span className="text-green-700 font-semibold">{summary.assigned}</span> assigned</div>
          <div><span className="text-gray-600">{summary.internal}</span> internal</div>
          <div><span className="text-gray-600">{summary.skip}</span> skip</div>
          <div><span className="text-amber-600">{summary.undecided}</span> undecided</div>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="h-4 w-4"
          />
          Select all
        </label>
        <button
          onClick={skipSelected}
          disabled={!anyChecked}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Skip selected
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="w-10 p-2"></th>
              <th className="text-left p-2">Meeting</th>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Attendees</th>
              <th className="text-left p-2">Domain</th>
              <th className="text-left p-2">Assign to</th>
            </tr>
          </thead>
          <tbody>
            {uncertain.map((m, i) => (
              <tr key={i} className="border-t border-gray-100 align-top">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={() => toggleCheck(i)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="p-2 font-medium text-gray-800">{m.title || '(untitled)'}</td>
                <td className="p-2 text-gray-600 whitespace-nowrap">{m.date}</td>
                <td className="p-2 text-gray-600 max-w-xs">{m.attendees}</td>
                <td className="p-2 text-gray-700 font-mono text-xs">{m.candidateDomain}</td>
                <td className="p-2">
                  <select
                    value={decisions[i]}
                    onChange={(e) => setDecision(i, e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
                  >
                    <option value="">— choose —</option>
                    <option value={INTERNAL}>Internal</option>
                    <option value={SKIP}>Skip</option>
                    <optgroup label="Clients">
                      {KNOWN_CLIENTS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
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
