export default function Stats({ stats }) {
  const items = [
    { label: 'Files Loaded', value: stats.totalFiles, color: 'text-gray-800' },
    { label: 'Messages Parsed', value: stats.totalMessages, color: 'text-blue-700' },
    { label: 'External Uploaded', value: stats.external, color: 'text-green-700' },
    { label: 'Internal Skipped', value: stats.internal, color: 'text-gray-500' },
    { label: 'Errors', value: stats.errors, color: 'text-red-600' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white border border-gray-200 rounded-xl p-4 text-center"
        >
          <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
          <div className="text-xs text-gray-500 mt-1">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
