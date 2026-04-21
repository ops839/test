import { useState, useMemo, useCallback } from 'react';
import FileDropZone from './components/FileDropZone';
import ReviewPanel from './components/ReviewPanel';
import { parseSybillMessages } from './lib/parser';
import { classifyMeeting } from './lib/classifier';
import { exportXlsx } from './lib/xlsx';

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [phase, setPhase] = useState('upload'); // upload | review | done
  const [assigned, setAssigned] = useState({}); // client -> meetings[]
  const [uncertain, setUncertain] = useState([]); // meetings w/ candidateDomain
  const [internalCount, setInternalCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);

  const onFilesLoaded = useCallback((loaded) => {
    setFiles(loaded);
  }, []);

  const assignedStats = useMemo(() => {
    const clients = Object.keys(assigned);
    const count = clients.reduce((n, c) => n + assigned[c].length, 0);
    return { clients: clients.length, count };
  }, [assigned]);

  const classifyAll = () => {
    const byClient = {};
    const pending = [];
    let internal = 0;
    let total = 0;

    for (const file of files) {
      const meetings = parseSybillMessages(file.messages);
      total += meetings.length;

      for (const meeting of meetings) {
        const result = classifyMeeting(meeting);
        if (result.status === 'client') {
          (byClient[result.client] ||= []).push(meeting);
        } else if (result.status === 'uncertain') {
          pending.push({ ...meeting, candidateDomain: result.candidateDomain });
        } else {
          internal++;
        }
      }
    }

    setAssigned(byClient);
    setUncertain(pending);
    setInternalCount(internal);
    setTotalMessages(total);
    setPhase(pending.length > 0 ? 'review' : 'done');
  };

  const onReviewConfirm = (decisions) => {
    const merged = { ...assigned };
    let added = 0;
    let skipped = 0;
    for (const { meeting, client } of decisions) {
      if (client) {
        (merged[client] ||= []).push({
          date: meeting.date,
          title: meeting.title,
          summary: meeting.summary,
          actionItems: meeting.actionItems,
          attendees: meeting.attendees,
        });
        added++;
      } else {
        skipped++;
      }
    }
    setAssigned(merged);
    setUncertain([]);
    setInternalCount((n) => n + skipped);
    setPhase('done');
    return { added, skipped };
  };

  const download = () => {
    exportXlsx(assigned, `sybill-meetings-${todayStamp()}.xlsx`);
  };

  const reset = () => {
    setFiles([]);
    setAssigned({});
    setUncertain([]);
    setInternalCount(0);
    setTotalMessages(0);
    setPhase('upload');
  };

  const totalFileMessages = files.reduce((n, f) => n + f.messages.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-bold text-gray-900">
            Sybill Meeting Classifier
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Drop Slack export JSON files → classify by client → download XLSX.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-800">
            1. Upload Slack export files
          </h2>
          <FileDropZone onFilesLoaded={onFilesLoaded} disabled={phase !== 'upload'} />
          {files.length > 0 && (
            <p className="text-sm text-gray-500">
              {files.length} file{files.length !== 1 ? 's' : ''} loaded — {totalFileMessages} total
              Slack messages.
            </p>
          )}
        </section>

        {phase === 'upload' && (
          <section className="flex items-center gap-4">
            <button
              onClick={classifyAll}
              disabled={files.length === 0}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Classify meetings
            </button>
            {files.length === 0 && (
              <p className="text-sm text-gray-400">Upload at least one file to continue.</p>
            )}
          </section>
        )}

        {phase !== 'upload' && (
          <section className="grid grid-cols-5 gap-3">
            <Stat label="Meetings parsed" value={totalMessages} />
            <Stat label="Auto-assigned" value={assignedStats.count} color="text-green-700" />
            <Stat
              label="Uncertain (needs review)"
              value={uncertain.length}
              color={uncertain.length > 0 ? 'text-amber-600' : 'text-gray-400'}
            />
            <Stat label="Internal / skipped" value={internalCount} color="text-gray-500" />
            <Stat label="Clients" value={assignedStats.clients} color="text-blue-700" />
          </section>
        )}

        {phase === 'review' && (
          <ReviewPanel uncertain={uncertain} onConfirm={onReviewConfirm} />
        )}

        {phase === 'done' && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">2. Download XLSX</h2>
            <p className="text-sm text-gray-600">
              {assignedStats.count} meeting{assignedStats.count !== 1 ? 's' : ''} across{' '}
              {assignedStats.clients} client{assignedStats.clients !== 1 ? 's' : ''} ready to
              export.
            </p>
            {assignedStats.clients > 0 && (
              <div className="text-xs text-gray-500 font-mono flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(assigned)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([client, rows]) => (
                    <span key={client}>
                      {client}: {rows.length}
                    </span>
                  ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={download}
                disabled={assignedStats.count === 0}
                className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download XLSX
              </button>
              <button
                onClick={reset}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Start over
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-6">
        Blu Mountain RevOps — client-side only, no data leaves your browser.
      </footer>
    </div>
  );
}

function Stat({ label, value, color = 'text-gray-800' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
