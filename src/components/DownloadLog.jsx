function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export default function DownloadLog({ logs }) {
  const handleDownload = () => {
    const headers = ['Meeting Title', 'Customer', 'Status', 'Detail', 'Attendees'];
    const rows = logs.map((log) => [
      escapeCsv(log.title),
      escapeCsv(log.client),
      escapeCsv(log.status),
      escapeCsv(log.detail),
      escapeCsv(log.attendees),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sybill-processing-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      className="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
    >
      Download Log (CSV)
    </button>
  );
}
