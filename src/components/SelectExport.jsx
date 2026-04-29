export default function SelectExport({ assigned, selected, onChange }) {
  const clients = Object.keys(assigned).sort((a, b) => a.localeCompare(b));
  const totalMeetings = clients.reduce(
    (n, c) => n + (selected.has(c) ? assigned[c].length : 0),
    0
  );
  const selectedCount = clients.filter((c) => selected.has(c)).length;

  const selectAll = () => onChange(new Set(clients));
  const deselectAll = () => onChange(new Set());
  const toggle = (c) => {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onChange(next);
  };

  if (clients.length === 0) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-500">
          No meetings were assigned to any client. Nothing to export.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">Select clients to export</h2>
        <p className="text-sm text-gray-500 mt-1">
          Every client with at least one assigned meeting is listed below. Uncheck a client to
          exclude it from the XLSX entirely. Unchecked clients get no sheet.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={selectAll}
          className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          type="button"
        >
          Select all
        </button>
        <button
          onClick={deselectAll}
          className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          type="button"
        >
          Deselect all
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto divide-y divide-gray-100">
        {clients.map((c) => {
          const count = assigned[c].length;
          const isChecked = selected.has(c);
          return (
            <label
              key={c}
              className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(c)}
                className="h-4 w-4"
              />
              <span className={`flex-1 ${isChecked ? 'text-gray-800' : 'text-gray-400'}`}>{c}</span>
              <span
                className={`text-xs tabular-nums ${
                  isChecked ? 'text-gray-500' : 'text-gray-300'
                }`}
              >
                {count} meeting{count !== 1 ? 's' : ''}
              </span>
            </label>
          );
        })}
      </div>

      <div className="text-sm text-gray-700">
        <strong>{selectedCount}</strong> of {clients.length} client
        {clients.length !== 1 ? 's' : ''} selected,{' '}
        <strong>{totalMeetings}</strong> meeting{totalMeetings !== 1 ? 's' : ''} will export.
      </div>
    </section>
  );
}
