export default function ProcessingLog({ logs }) {
  if (logs.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
        <h3 className="font-medium text-sm text-gray-700">Processing Log</h3>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-gray-500 border-b">
              <th className="px-4 py-2 font-medium">Meeting</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-1.5 text-gray-800 truncate max-w-xs">
                  {log.title}
                </td>
                <td className="px-4 py-1.5 text-gray-600">
                  {log.client || '—'}
                </td>
                <td className="px-4 py-1.5">
                  <StatusBadge status={log.status} detail={log.detail} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, detail }) {
  const styles = {
    uploaded: 'bg-green-100 text-green-700',
    skipped: 'bg-gray-100 text-gray-600',
    error: 'bg-red-100 text-red-700',
    processing: 'bg-blue-100 text-blue-700',
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || ''}`}
      title={detail || ''}
    >
      {status === 'uploaded' && 'Uploaded'}
      {status === 'skipped' && `Skipped${detail ? ` (${detail})` : ''}`}
      {status === 'error' && `Error${detail ? `: ${detail}` : ''}`}
      {status === 'processing' && 'Processing...'}
    </span>
  );
}
