import { useState } from 'react';
import { KNOWN_BM_MEMBERS, ACTIVE_CLIENTS_SORTED } from '../lib/classifier';

function analyzeLog(logs) {
  const issues = [];

  for (const log of logs) {
    const reasons = [];

    // 1. Upload errors
    if (log.status === 'error') {
      reasons.push(`Upload error: ${log.detail || 'unknown'}`);
    }

    // 2. Customer name is a person's first name (single word, starts with uppercase)
    if (log.client && log.status !== 'skipped') {
      const client = log.client;
      const words = client.trim().split(/\s+/);
      if (words.length === 1 && /^[A-Z][a-z]+$/.test(words[0])) {
        reasons.push(`Customer name "${client}" looks like a person's first name, not a company`);
      }
    }

    // 3. Customer name contains "Notetaker"
    if (log.client && /notetaker/i.test(log.client)) {
      reasons.push(`Customer name "${log.client}" contains "Notetaker" — likely a bot`);
    }

    // 4. Customer name is a BM team member name
    if (log.client && KNOWN_BM_MEMBERS.has(log.client.toLowerCase().trim())) {
      reasons.push(`Customer name "${log.client}" is a known BM team member`);
    }

    // 5. Skipped as internal but title contains a known client name
    if (log.status === 'skipped') {
      const titleLower = (log.title || '').toLowerCase();
      for (const client of ACTIVE_CLIENTS_SORTED) {
        if (titleLower.includes(client.toLowerCase())) {
          reasons.push(`Skipped as internal but title contains active client "${client}"`);
          break;
        }
      }
    }

    if (reasons.length > 0) {
      issues.push({ ...log, reasons });
    }
  }

  return issues;
}

export default function ErrorAnalysis({ logs }) {
  const [showReport, setShowReport] = useState(false);
  const [issues, setIssues] = useState([]);

  const handleAnalyze = () => {
    setIssues(analyzeLog(logs));
    setShowReport(true);
  };

  if (!showReport) {
    return (
      <button
        onClick={handleAnalyze}
        className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
      >
        Analyze Errors
      </button>
    );
  }

  return (
    <div className="border border-amber-200 rounded-xl overflow-hidden">
      <div className="bg-amber-50 px-4 py-3 border-b border-amber-200 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-amber-800">
          Error Analysis — {issues.length} issue{issues.length !== 1 ? 's' : ''} found
        </h3>
        <button
          onClick={() => setShowReport(false)}
          className="text-xs text-amber-600 hover:text-amber-800 underline"
        >
          Hide
        </button>
      </div>
      {issues.length === 0 ? (
        <div className="p-4 text-sm text-green-700">
          No suspicious classifications found. Everything looks good.
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b">
                <th className="px-4 py-2 font-medium">Meeting</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Issue</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-4 py-2 text-gray-800 max-w-48 truncate" title={issue.title}>
                    {issue.title}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {issue.client || '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      issue.status === 'error' ? 'bg-red-100 text-red-700' :
                      issue.status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {issue.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-amber-700 text-xs">
                    {issue.reasons.map((r, j) => (
                      <div key={j}>{r}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
