import { useCallback, useMemo, useState } from 'react';
import FileDropZone from './components/FileDropZone';
import ReviewPanel from './components/ReviewPanel';
import SettingsPanel from './components/Settings';
import SelectExport from './components/SelectExport';
import { parseSybillMessages } from './lib/parser';
import { classifyMeeting } from './lib/classifier';
import { exportXlsx } from './lib/xlsx';
import { loadSettings } from './lib/settings';
import { classifyGroups } from './lib/ai';
import { groupUncertain } from './lib/grouping';

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [files, setFiles] = useState([]);
  const [phase, setPhase] = useState('upload'); // upload | ai | review | done
  const [assigned, setAssigned] = useState({});
  const [groups, setGroups] = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [aiError, setAiError] = useState('');
  const [internalCount, setInternalCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [exportSelection, setExportSelection] = useState(() => new Set());

  const onFilesLoaded = useCallback((loaded) => setFiles(loaded), []);

  const assignedStats = useMemo(() => {
    const clients = Object.keys(assigned);
    const count = clients.reduce((n, c) => n + assigned[c].length, 0);
    return { clients: clients.length, count };
  }, [assigned]);

  const selectedExportStats = useMemo(() => {
    let clients = 0;
    let count = 0;
    for (const [client, rows] of Object.entries(assigned)) {
      if (!exportSelection.has(client)) continue;
      clients++;
      count += rows.length;
    }
    return { clients, count };
  }, [assigned, exportSelection]);

  const uncertainMeetingCount = useMemo(
    () => groups.reduce((n, g) => n + g.meetings.length, 0),
    [groups]
  );

  const runClassification = async () => {
    const byClient = {};
    const pending = [];
    let internal = 0;
    let total = 0;

    for (const file of files) {
      const meetings = parseSybillMessages(file.messages);
      total += meetings.length;
      for (const meeting of meetings) {
        const r = classifyMeeting(meeting);
        if (r.status === 'client') (byClient[r.client] ||= []).push(meeting);
        else if (r.status === 'uncertain')
          pending.push({ ...meeting, candidateDomain: r.candidateDomain || null });
        else internal++;
      }
    }

    const built = groupUncertain(pending);

    setAssigned(byClient);
    setGroups(built);
    setInternalCount(internal);
    setTotalMessages(total);
    setAiSuggestions(null);
    setAiError('');

    if (built.length === 0) {
      setExportSelection(new Set(Object.keys(byClient)));
      setPhase('done');
      return;
    }

    if (!settings.apiKey) {
      setPhase('review');
      return;
    }

    setPhase('ai');
    setAiProgress({ done: 0, total: built.length });
    try {
      const results = await classifyGroups(
        settings.apiKey,
        built,
        (done, totalGroups) => setAiProgress({ done, total: totalGroups })
      );
      setAiSuggestions(results);
    } catch (e) {
      setAiError(e.message || String(e));
    } finally {
      setPhase('review');
    }
  };

  const onReviewConfirm = (decisions) => {
    const merged = { ...assigned };
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
      } else skipped++;
    }
    setAssigned(merged);
    setGroups([]);
    setAiSuggestions(null);
    setInternalCount((n) => n + skipped);
    setExportSelection(new Set(Object.keys(merged)));
    setPhase('done');
  };

  const download = () => {
    const filtered = {};
    for (const [client, rows] of Object.entries(assigned)) {
      if (exportSelection.has(client)) filtered[client] = rows;
    }
    exportXlsx(filtered, `sybill-meetings-${todayStamp()}.xlsx`);
  };

  const reset = () => {
    setFiles([]);
    setAssigned({});
    setGroups([]);
    setAiSuggestions(null);
    setInternalCount(0);
    setTotalMessages(0);
    setAiProgress({ done: 0, total: 0 });
    setAiError('');
    setExportSelection(new Set());
    setPhase('upload');
  };

  const totalFileMessages = files.reduce((n, f) => n + f.messages.length, 0);
  const busy = phase === 'ai';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-bold text-gray-900">Sybill Meeting Classifier</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Drop Slack export JSON files → classify by client → download XLSX.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <SettingsPanel settings={settings} onChange={setSettings} />

        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-800">1. Upload Slack export files</h2>
          <FileDropZone onFilesLoaded={onFilesLoaded} disabled={phase !== 'upload'} />
          {files.length > 0 && (
            <p className="text-sm text-gray-500">
              {files.length} file{files.length !== 1 ? 's' : ''} loaded — {totalFileMessages}{' '}
              total Slack messages.
            </p>
          )}
        </section>

        {phase === 'upload' && (
          <section className="flex items-center gap-4">
            <button
              onClick={runClassification}
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
              value={uncertainMeetingCount}
              color={uncertainMeetingCount > 0 ? 'text-amber-600' : 'text-gray-400'}
            />
            <Stat label="Internal / skipped" value={internalCount} color="text-gray-500" />
            <Stat label="Clients" value={assignedStats.clients} color="text-blue-700" />
          </section>
        )}

        {phase === 'ai' && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-2">
            <h2 className="text-lg font-semibold text-gray-800">
              Classifying with Claude…
            </h2>
            <p className="text-sm text-gray-500">
              {aiProgress.done} / {aiProgress.total} groups classified. The review panel will load
              when all groups are done.
            </p>
            <div className="h-2 bg-gray-100 rounded">
              <div
                className="h-2 bg-indigo-500 rounded transition-all"
                style={{
                  width: `${
                    aiProgress.total ? (aiProgress.done / aiProgress.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
          </section>
        )}

        {phase === 'review' && !busy && (
          <>
            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                <strong>AI classification failed:</strong> {aiError}. Continuing without AI
                defaults.
              </div>
            )}
            <ReviewPanel
              groups={groups}
              aiSuggestions={aiSuggestions}
              onConfirm={onReviewConfirm}
            />
          </>
        )}

        {phase === 'done' && (
          <>
            <SelectExport
              assigned={assigned}
              selected={exportSelection}
              onChange={setExportSelection}
            />
            <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
              <h2 className="text-lg font-semibold text-gray-800">Download XLSX</h2>
              <p className="text-sm text-gray-600">
                {selectedExportStats.count} meeting{selectedExportStats.count !== 1 ? 's' : ''}{' '}
                across {selectedExportStats.clients} selected client
                {selectedExportStats.clients !== 1 ? 's' : ''} will be written to the file.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={download}
                  disabled={selectedExportStats.count === 0}
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
          </>
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-6">
        Blu Mountain RevOps — client-side only, no data leaves your browser (except AI calls
        directly to Anthropic if you provide a key).
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
