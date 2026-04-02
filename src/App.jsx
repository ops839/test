import { useState, useCallback, useRef } from 'react';
import FileDropZone from './components/FileDropZone';
import GoogleAuth from './components/GoogleAuth';
import ProcessingLog from './components/ProcessingLog';
import Stats from './components/Stats';
import Settings, { loadSettings } from './components/Settings';
import ErrorAnalysis from './components/ErrorAnalysis';
import DownloadLog from './components/DownloadLog';
import { parseSybillMessages } from './lib/parser';
import { classifyMeeting } from './lib/classifier';
import { uploadMeeting, resetSheetCache } from './lib/sheets';

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [files, setFiles] = useState([]);
  const [authed, setAuthed] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalMessages: 0,
    external: 0,
    internal: 0,
    errors: 0,
  });
  const abortRef = useRef(false);

  const onFilesLoaded = useCallback((loaded) => {
    setFiles(loaded);
    setStats((s) => ({ ...s, totalFiles: loaded.length }));
  }, []);

  const canStart = files.length > 0 && authed && spreadsheetId && !processing;

  const addLog = (entry) => setLogs((prev) => [...prev, entry]);

  const startProcessing = async () => {
    setProcessing(true);
    setLogs([]);
    abortRef.current = false;
    resetSheetCache();

    const newStats = {
      totalFiles: files.length,
      totalMessages: 0,
      external: 0,
      internal: 0,
      errors: 0,
    };

    // Parse all files
    const allMeetings = [];
    for (const file of files) {
      const meetings = parseSybillMessages(file.messages);
      allMeetings.push(...meetings);
    }
    newStats.totalMessages = allMeetings.length;
    setStats({ ...newStats });

    // Process each meeting
    for (const meeting of allMeetings) {
      if (abortRef.current) break;

      const { type, clientName } = classifyMeeting(meeting);

      if (type === 'internal') {
        newStats.internal++;
        addLog({
          title: meeting.title || '(untitled)',
          client: null,
          status: 'skipped',
          detail: 'internal',
          attendees: meeting.attendees || '',
        });
        setStats({ ...newStats });
        continue;
      }

      // External — upload
      addLog({
        title: meeting.title || '(untitled)',
        client: clientName,
        status: 'processing',
        attendees: meeting.attendees || '',
      });

      try {
        await uploadMeeting(spreadsheetId, clientName, meeting);
        newStats.external++;
        setLogs((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            status: 'uploaded',
          };
          return updated;
        });
      } catch (e) {
        newStats.errors++;
        setLogs((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            status: 'error',
            detail: e.message,
          };
          return updated;
        });
      }

      setStats({ ...newStats });
    }

    setProcessing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-bold text-gray-900">
            Sybill Meeting Processor
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Blu Mountain RevOps — Parse Slack exports, classify meetings, push
            to Google Sheets
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <Settings settings={settings} onChange={setSettings} />

        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-800">
            1. Upload Slack Export Files
          </h2>
          <FileDropZone onFilesLoaded={onFilesLoaded} disabled={processing} />
          {files.length > 0 && (
            <p className="text-sm text-gray-500">
              {files.length} file{files.length !== 1 ? 's' : ''} ready —{' '}
              {files.reduce((n, f) => n + f.messages.length, 0)} total messages
            </p>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            2. Connect Google Sheets
          </h2>
          <GoogleAuth
            apiKey={settings.apiKey}
            clientId={settings.clientId}
            onAuthReady={setAuthed}
            onSpreadsheetSelect={setSpreadsheetId}
            disabled={processing}
          />
        </section>

        <section className="flex items-center gap-4">
          <button
            onClick={startProcessing}
            disabled={!canStart}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-base hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {processing ? 'Processing...' : 'Start Processing'}
          </button>
          {processing && (
            <button
              onClick={() => (abortRef.current = true)}
              className="px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
            >
              Stop
            </button>
          )}
          {!canStart && !processing && (
            <p className="text-sm text-gray-400">
              {files.length === 0 && 'Upload files, '}
              {!authed && 'sign in to Google, '}
              {!spreadsheetId && 'select a spreadsheet'}
            </p>
          )}
        </section>

        <Stats stats={stats} />
        <ProcessingLog logs={logs} />

        {!processing && logs.length > 0 && (
          <section className="flex items-center gap-3">
            <ErrorAnalysis logs={logs} />
            <DownloadLog logs={logs} />
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-6">
        Blu Mountain RevOps — blumountain.me
      </footer>
    </div>
  );
}
