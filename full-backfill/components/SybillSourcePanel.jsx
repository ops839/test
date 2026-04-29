import { useState, useCallback } from 'react';
import { parseSybillMessages } from '../../src/lib/parser.js';
import { SYBILL_CUTOFF_DAYS, cutoffDateStr } from '../lib/cutoffs.js';

function DropZone({ onFilesLoaded, disabled }) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList).filter((f) => f.name.endsWith('.json'));
      if (files.length === 0) return;
      const results = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (Array.isArray(data)) results.push({ name: file.name, messages: data });
        } catch (e) {
          console.warn(`Failed to parse ${file.name}:`, e);
        }
      }
      onFilesLoaded(results);
    },
    [onFilesLoaded]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-bm-accent bg-bm-accent/10' : 'border-bm-border hover:border-bm-accent-dim'
      } ${disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}
    >
      <input
        id="sybill-file-input"
        type="file"
        multiple
        accept=".json"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <p className="text-sm font-medium text-bm-text">Drop Sybill JSON files here</p>
      <p className="text-xs text-bm-muted mt-1">or click to browse — accepts multiple .json files</p>
    </div>
  );
}

export default function SybillSourcePanel({ onParsed }) {
  const [status, setStatus] = useState(null);

  const handleFilesLoaded = useCallback(
    (fileResults) => {
      const allMessages = fileResults.flatMap((f) => f.messages);
      const allMeetings = parseSybillMessages(allMessages);
      const cutoff = cutoffDateStr(SYBILL_CUTOFF_DAYS);
      const meetings = allMeetings.filter((m) => m.date >= cutoff);
      const droppedCount = allMeetings.length - meetings.length;
      setStatus({ totalFiles: fileResults.length, totalParsed: allMeetings.length, droppedCount });
      onParsed({ meetings, droppedCount, totalCount: allMeetings.length });
    },
    [onParsed]
  );

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">1a.</span>Sybill source
      </h2>
      <p className="text-xs text-bm-muted">
        Upload one or more Sybill notification JSON files from a Slack export.
        Meetings older than {SYBILL_CUTOFF_DAYS} days are dropped silently.
      </p>
      <DropZone onFilesLoaded={handleFilesLoaded} disabled={false} />
      {status && (
        <div className="grid grid-cols-3 gap-4 pt-1">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">Files</span>
            <span className="text-lg font-medium text-bm-text">{status.totalFiles}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">Meetings parsed</span>
            <span className="text-lg font-medium text-bm-text">{status.totalParsed}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-bm-muted">Dropped (old)</span>
            <span className={`text-lg font-medium ${status.droppedCount > 0 ? 'text-bm-muted' : 'text-bm-text'}`}>
              {status.droppedCount}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
