import { useState } from 'react';
import {
  parseSlackdumpZip,
  parseSlackdumpFolder,
} from '../../slack-backfill/lib/slackParser.js';
import { SLACK_CUTOFF_DAYS, cutoffDateStr } from '../lib/cutoffs.js';

export default function SlackSourcePanel({ onParsed }) {
  const [sourceMode, setSourceMode] = useState('zip');
  const [zipFile, setZipFile] = useState(null);
  const [folderFiles, setFolderFiles] = useState(null);
  const [folderLabel, setFolderLabel] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [stats, setStats] = useState(null);

  function handleZipPicked(file) {
    if (!file) return;
    setSourceMode('zip');
    setZipFile(file);
    setFolderFiles(null);
    setFolderLabel('');
    setStats(null);
    setParseError(null);
  }

  function handleFolderPicked(fileList) {
    if (!fileList || fileList.length === 0) return;
    setSourceMode('folder');
    setFolderFiles(fileList);
    const first = fileList[0];
    const top = (first.webkitRelativePath || '').split('/')[0] || 'folder';
    setFolderLabel(`${top} (${fileList.length} files)`);
    setZipFile(null);
    setStats(null);
    setParseError(null);
  }

  const sourceReady =
    (sourceMode === 'zip' && !!zipFile) ||
    (sourceMode === 'folder' && !!folderFiles);

  async function handleParse() {
    if (!sourceReady) return;
    setParsing(true);
    setParseError(null);
    try {
      const result =
        sourceMode === 'zip'
          ? await parseSlackdumpZip(zipFile)
          : await parseSlackdumpFolder(folderFiles);

      const cutoff = cutoffDateStr(SLACK_CUTOFF_DAYS);
      let totalBuckets = 0;
      let eligibleBuckets = 0;
      for (const ch of result.channels) {
        totalBuckets += ch.dayBuckets.length;
        eligibleBuckets += ch.dayBuckets.filter((b) => b.date >= cutoff).length;
      }

      setStats({ channels: result.channels.length, totalBuckets, eligibleBuckets });
      onParsed({ parsed: result, totalBuckets, eligibleBuckets });
    } catch (e) {
      setParseError(e.message || String(e));
    } finally {
      setParsing(false);
    }
  }

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">1b.</span>Slack source
      </h2>
      <p className="text-xs text-bm-muted">
        Provide a slackdump v3+ ZIP or the unzipped export folder.
        Day-buckets older than {SLACK_CUTOFF_DAYS} days are shown but not summarized or written.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label
          className={`flex flex-col gap-2 rounded-lg border p-4 cursor-pointer ${
            sourceMode === 'zip' && zipFile
              ? 'border-bm-accent bg-bm-accent/10'
              : 'border-bm-border hover:border-bm-accent-dim'
          }`}
        >
          <span className="text-sm font-medium text-bm-text">Upload ZIP</span>
          <span className="text-xs text-bm-muted">A slackdump v3+ .zip file</span>
          <input
            type="file"
            accept=".zip"
            onChange={(e) => handleZipPicked(e.target.files?.[0] || null)}
            className="block w-full text-xs text-bm-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-bm-border file:text-bm-text hover:file:bg-bm-accent-dim hover:file:text-bm-bg"
          />
          {sourceMode === 'zip' && zipFile && (
            <span className="text-xs text-bm-accent break-all">
              {zipFile.name} ({(zipFile.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          )}
        </label>

        <label
          className={`flex flex-col gap-2 rounded-lg border p-4 cursor-pointer ${
            sourceMode === 'folder' && folderFiles
              ? 'border-bm-accent bg-bm-accent/10'
              : 'border-bm-border hover:border-bm-accent-dim'
          }`}
        >
          <span className="text-sm font-medium text-bm-text">Select folder</span>
          <span className="text-xs text-bm-muted">An unzipped slackdump export folder</span>
          <input
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => handleFolderPicked(e.target.files)}
            className="block w-full text-xs text-bm-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-bm-border file:text-bm-text hover:file:bg-bm-accent-dim hover:file:text-bm-bg"
          />
          {sourceMode === 'folder' && folderFiles && (
            <span className="text-xs text-bm-accent break-all">{folderLabel}</span>
          )}
        </label>
      </div>

      <button
        disabled={!sourceReady || parsing}
        onClick={handleParse}
        className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90 disabled:opacity-40"
      >
        {parsing ? 'Parsing…' : sourceMode === 'zip' ? 'Parse ZIP' : 'Parse folder'}
      </button>

      {parseError && <p className="text-sm text-red-400">{parseError}</p>}

      {stats && (
        <div className="grid grid-cols-3 gap-4 pt-1">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">Channels</span>
            <span className="text-lg font-medium text-bm-text">{stats.channels}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">Total buckets</span>
            <span className="text-lg font-medium text-bm-text">{stats.totalBuckets}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">
              Eligible (&le;{SLACK_CUTOFF_DAYS}d)
            </span>
            <span className="text-lg font-medium text-bm-accent">{stats.eligibleBuckets}</span>
          </div>
        </div>
      )}
    </section>
  );
}
