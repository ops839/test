import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSlackdumpZip,
  parseSlackdumpFolder,
  formatThreadBlock,
  buildPrompt,
} from './lib/slackParser';
import {
  MODELS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  callClaude,
  validateApiKey,
  runWithConcurrency,
  estimateTokens,
  estimateCost,
} from './lib/claude';
import {
  loadWorkbook,
  appendAssignments,
  downloadWorkbook,
  readSheetNames,
} from './lib/xlsxBuilder';

const RESUME_KEY = 'slack-backfill:resume-v1';
const RESUME_INTERVAL = 50;

// Only day-buckets within this many days of "now" are sent to Claude.
// Older buckets show in the channel-matches table but aren't summarized
// or written to the output XLSX.
const CUTOFF_DAYS = 21;

function cutoffDateStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - CUTOFF_DAYS);
  return d.toISOString().slice(0, 10);
}

// Dropdown sentinels. Empty string means "user has not picked anything yet".
const PICK_UNSET = '';
const PICK_UNMATCHED = '__UNMATCHED__';
const PICK_NEW = '__NEW__';

// Translate a dropdown choice into the sheetName field used by the XLSX
// builder. null routes to the Unmatched Slack sheet.
function resolveChoice(choice, channelFolder) {
  if (choice === PICK_UNMATCHED) return null;
  if (choice === PICK_NEW) return channelFolder;
  return choice; // existing sheet name
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Panel({ title, children, step }) {
  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        {step != null && <span className="text-bm-accent mr-2">{step}.</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-bm-muted">{label}</span>
      <span className="text-lg font-medium text-bm-text">{value}</span>
    </div>
  );
}

export default function App() {
  // Step state machine
  // sourceMode: 'zip' | 'folder'. Tracks which input the user picked last.
  const [sourceMode, setSourceMode] = useState('zip');
  const [zipFile, setZipFile] = useState(null);
  const [folderFiles, setFolderFiles] = useState(null); // FileList from <input webkitdirectory>
  const [folderLabel, setFolderLabel] = useState('');
  const [xlsxFile, setXlsxFile] = useState(null);
  const [xlsxSheets, setXlsxSheets] = useState([]); // sheet names sorted alphabetically
  const [xlsxError, setXlsxError] = useState(null);
  const [parsed, setParsed] = useState(null); // { channels, totalMessages, userMap }
  const [parseError, setParseError] = useState(null);
  const [parsing, setParsing] = useState(false);

  // Channel matches: per-folder dropdown choice. Stored as folderName -> sentinel.
  const [channelChoices, setChannelChoices] = useState({});

  // After parse: assignments
  const [assignments, setAssignments] = useState([]); // [{ bucket, clientName }]

  // Cost preview
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [confirmed, setConfirmed] = useState(false);

  // API key
  const [apiKey, setApiKey] = useState('');
  const [keyValidating, setKeyValidating] = useState(false);
  const [keyValid, setKeyValid] = useState(false);
  const [keyError, setKeyError] = useState(null);

  // Run state
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({}); // idx -> { summary, error, inputTokens, outputTokens }
  const [doneCount, setDoneCount] = useState(0);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  const [retrying, setRetrying] = useState(false);
  const [finalDownload, setFinalDownload] = useState(null);
  const abortRef = useRef(false);

  // Resume prompt
  const [resumeAvailable, setResumeAvailable] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (raw) setResumeAvailable(true);
    } catch {
      // ignore
    }
  }, []);

  async function handleXlsxPicked(file) {
    setXlsxError(null);
    setXlsxSheets([]);
    setXlsxFile(file || null);
    if (!file) return;
    try {
      const names = await readSheetNames(file);
      setXlsxSheets([...names].sort((a, b) => a.localeCompare(b)));
    } catch (e) {
      setXlsxError(e.message || String(e));
    }
  }

  function handleZipPicked(file) {
    if (!file) return;
    setSourceMode('zip');
    setZipFile(file);
    setFolderFiles(null);
    setFolderLabel('');
    setParsed(null);
    setParseError(null);
  }

  function handleFolderPicked(fileList) {
    if (!fileList || fileList.length === 0) return;
    setSourceMode('folder');
    setFolderFiles(fileList);
    // Top folder name is the first segment of webkitRelativePath of any file
    const first = fileList[0];
    const top = (first.webkitRelativePath || '').split('/')[0] || 'folder';
    setFolderLabel(`${top} (${fileList.length} files)`);
    setZipFile(null);
    setParsed(null);
    setParseError(null);
  }

  const sourceReady =
    (sourceMode === 'zip' && !!zipFile) ||
    (sourceMode === 'folder' && !!folderFiles);

  // ─── Parse ──────────────────────────────────────────────────────────
  async function handleParse() {
    if (!sourceReady) return;
    setParsing(true);
    setParseError(null);
    try {
      const result =
        sourceMode === 'zip'
          ? await parseSlackdumpZip(zipFile)
          : await parseSlackdumpFolder(folderFiles);
      setParsed(result);

      // Build assignments. Channel-to-sheet mapping is set by the user in
      // the channel matches step; nothing is auto-matched here.
      const list = [];
      for (const ch of result.channels) {
        for (const bucket of ch.dayBuckets) {
          list.push({
            channelName: ch.name,
            channelFolder: ch.folderPath.split('/').pop(),
            clientName: null,
            date: bucket.date,
            bucket,
          });
        }
      }
      setAssignments(list);
    } catch (e) {
      setParseError(e.message || String(e));
    } finally {
      setParsing(false);
    }
  }

  // Indices into `assignments` whose date is within the summarization
  // cutoff. Only these get Claude calls and only their summaries land in
  // the output XLSX. Older buckets are visible upstream but skipped here.
  const eligibleIndices = useMemo(() => {
    const cutoff = cutoffDateStr();
    const out = [];
    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i].date >= cutoff) out.push(i);
    }
    return out;
  }, [assignments]);

  // ─── Cost preview numbers ──────────────────────────────────────────
  const costStats = useMemo(() => {
    if (!parsed) return null;
    const channelCount = parsed.channels.length;
    const totalBuckets = assignments.length;
    const toSummarize = eligibleIndices.length;

    // Estimate input tokens by summing prompt sizes for eligible buckets only.
    let inputTokens = 0;
    for (const idx of eligibleIndices) {
      const promptStr = buildPrompt(assignments[idx].bucket);
      inputTokens += estimateTokens(promptStr) + estimateTokens(SYSTEM_PROMPT);
    }
    // Assume ~120 output tokens per call.
    const outputTokens = toSummarize * 120;

    const costs = {};
    for (const id of Object.keys(MODELS)) {
      costs[id] = estimateCost(inputTokens, outputTokens, id);
    }
    return {
      channelCount,
      totalBuckets,
      toSummarize,
      messageCount: parsed.totalMessages,
      inputTokens,
      outputTokens,
      costs,
      cutoffDate: cutoffDateStr(),
    };
  }, [parsed, assignments, eligibleIndices]);

  // ─── API key validation ────────────────────────────────────────────
  async function handleValidateKey() {
    if (!apiKey) return;
    setKeyValidating(true);
    setKeyError(null);
    try {
      await validateApiKey(apiKey);
      setKeyValid(true);
    } catch (e) {
      setKeyValid(false);
      setKeyError(e.message || String(e));
    } finally {
      setKeyValidating(false);
    }
  }

  // ─── Run ────────────────────────────────────────────────────────────
  async function runSummaries(indicesToRun) {
    setRunning(true);
    abortRef.current = false;

    let runDone = 0;
    const localResults = { ...results };
    const localUsage = { ...usage };
    let lastSaved = 0;

    const tasks = indicesToRun.map((idx) => async () => {
      if (abortRef.current) throw new Error('aborted');
      const a = assignments[idx];
      const userPrompt = buildPrompt(a.bucket);
      const res = await callClaude({
        apiKey,
        model,
        system: SYSTEM_PROMPT,
        user: userPrompt,
      });
      return { idx, ...res };
    });

    await runWithConcurrency(tasks, 8, (_i, result, error) => {
      if (error) {
        const idx = indicesToRun[_i];
        localResults[idx] = { error: error.message || String(error) };
      } else {
        const { idx, text, inputTokens, outputTokens } = result;
        localResults[idx] = {
          summary: text,
          inputTokens,
          outputTokens,
        };
        localUsage.inputTokens += inputTokens;
        localUsage.outputTokens += outputTokens;
      }
      runDone += 1;
      setDoneCount((c) => c + 1);
      setResults({ ...localResults });
      setUsage({ ...localUsage });

      if (runDone - lastSaved >= RESUME_INTERVAL) {
        lastSaved = runDone;
        try {
          localStorage.setItem(
            RESUME_KEY,
            JSON.stringify({
              ts: Date.now(),
              model,
              results: localResults,
              usage: localUsage,
              assignmentsKey: assignments.map((a) => `${a.channelName}|${a.date}`).join(';'),
            }),
          );
        } catch {
          // quota: ignore
        }
      }
    });

    setRunning(false);
  }

  async function handleStart() {
    if (!confirmed || !keyValid) return;
    setResults({});
    setDoneCount(0);
    setUsage({ inputTokens: 0, outputTokens: 0 });
    await runSummaries(eligibleIndices);
  }

  async function handleRetryFailed() {
    const failedIdxs = Object.entries(results)
      .filter(([, v]) => v.error)
      .map(([k]) => Number(k));
    if (!failedIdxs.length) return;
    setRetrying(true);
    // Clear failed entries before retrying
    const cleared = { ...results };
    for (const i of failedIdxs) delete cleared[i];
    setResults(cleared);
    setDoneCount((c) => c - failedIdxs.length);
    await runSummaries(failedIdxs);
    setRetrying(false);
  }

  // ─── Build XLSX ─────────────────────────────────────────────────────
  async function handleBuildXlsx() {
    if (!xlsxFile) return;
    const wb = await loadWorkbook(xlsxFile);
    const items = [];
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      const r = results[i];
      if (!r || r.error) continue;
      const choice = channelChoices[a.channelFolder] ?? PICK_UNSET;
      const sheetName = resolveChoice(choice, a.channelFolder);
      items.push({
        sheetName,
        channelName: a.channelName,
        date: a.date,
        summary: r.summary,
        threadText: formatThreadBlock(a.bucket),
      });
    }
    appendAssignments(wb, items);
    const filename = `client-engagement-log-${todayStr()}-with-slack.xlsx`;
    downloadWorkbook(wb, filename);
    setFinalDownload(filename);
    try {
      localStorage.removeItem(RESUME_KEY);
    } catch {
      // ignore
    }
  }

  function handleResume() {
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const parsedState = JSON.parse(raw);
      setResults(parsedState.results || {});
      setUsage(parsedState.usage || { inputTokens: 0, outputTokens: 0 });
      setDoneCount(Object.keys(parsedState.results || {}).length);
      setModel(parsedState.model || DEFAULT_MODEL);
      setResumeAvailable(false);
    } catch {
      setResumeAvailable(false);
    }
  }

  function handleDiscardResume() {
    try {
      localStorage.removeItem(RESUME_KEY);
    } catch {
      // ignore
    }
    setResumeAvailable(false);
  }

  // ─── Per-channel progress ──────────────────────────────────────────
  const channelProgress = useMemo(() => {
    if (!parsed) return [];
    const eligibleSet = new Set(eligibleIndices);
    const map = new Map();
    for (let i = 0; i < assignments.length; i++) {
      if (!eligibleSet.has(i)) continue;
      const a = assignments[i];
      if (!map.has(a.channelName)) {
        const choice = channelChoices[a.channelFolder] ?? PICK_UNSET;
        const target = resolveChoice(choice, a.channelFolder);
        map.set(a.channelName, {
          channelName: a.channelName,
          targetSheet: target,
          unmatched: choice === PICK_UNMATCHED,
          total: 0,
          done: 0,
          failed: 0,
        });
      }
      const c = map.get(a.channelName);
      c.total += 1;
      const r = results[i];
      if (r) {
        if (r.error) c.failed += 1;
        else c.done += 1;
      }
    }
    return [...map.values()];
  }, [parsed, assignments, results, channelChoices, eligibleIndices]);

  const failedCount = useMemo(
    () => Object.values(results).filter((r) => r.error).length,
    [results],
  );

  const liveCost = useMemo(
    () => estimateCost(usage.inputTokens, usage.outputTokens, model),
    [usage, model],
  );

  const allDone =
    parsed &&
    eligibleIndices.length > 0 &&
    doneCount >= eligibleIndices.length &&
    !running;

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bm-bg text-bm-text">
      <header className="border-b border-bm-border">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-semibold">Slack Backfill</h1>
          <p className="text-sm text-bm-muted mt-1">
            Blu Mountain RevOps. Summarize Slack channel activity and append to the engagement log.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {resumeAvailable && (
          <section className="rounded-xl border border-bm-accent bg-bm-panel p-4 flex items-center justify-between">
            <div className="text-sm">
              A previous run was interrupted. Resume from where it left off?
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResume}
                className="px-3 py-1.5 text-sm rounded-lg bg-bm-accent text-bm-bg font-medium hover:opacity-90"
              >
                Resume
              </button>
              <button
                onClick={handleDiscardResume}
                className="px-3 py-1.5 text-sm rounded-lg border border-bm-border text-bm-muted hover:text-bm-text"
              >
                Discard
              </button>
            </div>
          </section>
        )}

        <Panel step={1} title="Upload slackdump source">
          <p className="text-xs text-bm-muted">
            Provide either the slackdump ZIP archive, or the slackdump export
            folder directly. Loose JSON files are not supported because the
            channel name is encoded in the parent folder name.
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
            {parsing ? 'Parsing...' : sourceMode === 'zip' ? 'Parse ZIP' : 'Parse folder'}
          </button>
          {parseError && (
            <p className="text-sm text-red-400">{parseError}</p>
          )}
          {parsed && (
            <div className="grid grid-cols-3 gap-4 pt-2">
              <Stat label="Channels" value={parsed.channels.length} />
              <Stat label="Day buckets" value={assignments.length} />
              <Stat label="Messages" value={parsed.totalMessages} />
            </div>
          )}
        </Panel>

        <Panel step={2} title="Upload existing engagement log XLSX">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => handleXlsxPicked(e.target.files?.[0] || null)}
            className="block w-full text-sm text-bm-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-bm-border file:text-bm-text hover:file:bg-bm-accent-dim hover:file:text-bm-bg"
          />
          {xlsxFile && (
            <p className="text-sm text-bm-muted">
              {xlsxFile.name} ({xlsxSheets.length} sheet{xlsxSheets.length !== 1 ? 's' : ''})
            </p>
          )}
          {xlsxError && <p className="text-sm text-red-400">{xlsxError}</p>}
        </Panel>

        {parsed && (
          <Panel step={3} title="Channel matches">
            {!xlsxFile && (
              <p className="text-sm text-bm-muted">
                Upload the engagement log XLSX above to populate the sheet
                dropdown for each channel.
              </p>
            )}
            {xlsxFile && (
              <p className="text-xs text-bm-muted">
                Pick a target sheet for each channel. No auto-matching. Choose
                Unmatched to send activity to the Unmatched Slack sheet, or
                create a new sheet using the channel name.
              </p>
            )}
            <div className="max-h-96 overflow-y-auto rounded-lg border border-bm-border">
              <table className="w-full text-sm">
                <thead className="bg-bm-border/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Channel</th>
                    <th className="text-left px-3 py-2 font-medium">Target sheet</th>
                    <th className="text-right px-3 py-2 font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.channels.map((ch) => {
                    const folderKey = ch.folderPath.split('/').pop();
                    const choice = channelChoices[folderKey] ?? PICK_UNSET;
                    return (
                      <tr key={ch.folderPath} className="border-t border-bm-border">
                        <td className="px-3 py-2 font-mono text-bm-text align-top">
                          #{ch.name}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={choice}
                            disabled={!xlsxFile}
                            onChange={(e) =>
                              setChannelChoices((prev) => ({
                                ...prev,
                                [folderKey]: e.target.value,
                              }))
                            }
                            className="w-full rounded border border-bm-border bg-bm-bg px-2 py-1 text-sm focus:outline-none focus:border-bm-accent disabled:opacity-50"
                          >
                            <option value={PICK_UNSET} disabled>
                              Pick one...
                            </option>
                            <option value={PICK_UNMATCHED}>Unmatched</option>
                            {xlsxSheets.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                            <option value={PICK_NEW}>
                              Create new sheet: {folderKey}
                            </option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right text-bm-muted align-top">
                          {ch.dayBuckets.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {parsed && costStats && (
          <Panel step={4} title="Cost preview">
            <p className="text-xs text-bm-muted">
              Summarization is capped to the last {CUTOFF_DAYS} days
              (since {costStats.cutoffDate}). Older day-buckets are loaded
              into the channel matches view but not summarized or written
              to the output.
            </p>
            <div className="grid grid-cols-4 gap-4">
              <Stat label="Channels" value={costStats.channelCount} />
              <Stat label="Total day buckets" value={costStats.totalBuckets.toLocaleString()} />
              <Stat label="To summarize" value={costStats.toSummarize.toLocaleString()} />
              <Stat label="Est. input tokens" value={costStats.inputTokens.toLocaleString()} />
            </div>
            <div className="space-y-2 pt-2">
              {Object.values(MODELS).map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer ${
                    model === m.id ? 'border-bm-accent bg-bm-accent/10' : 'border-bm-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={model === m.id}
                      onChange={() => {
                        setModel(m.id);
                        setConfirmed(false);
                      }}
                      className="accent-bm-accent"
                    />
                    <div>
                      <div className="font-medium text-bm-text">{m.label}</div>
                      <div className="text-xs text-bm-muted">
                        ${m.inputPerM.toFixed(2)}/M input · ${m.outputPerM.toFixed(2)}/M output
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-medium text-bm-text">
                      ${costStats.costs[m.id].toFixed(2)}
                    </div>
                    <div className="text-xs text-bm-muted">estimated</div>
                  </div>
                </label>
              ))}
            </div>
            {!confirmed ? (
              <button
                onClick={() => setConfirmed(true)}
                className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
              >
                Confirm and continue
              </button>
            ) : (
              <p className="text-sm text-bm-accent">Confirmed: {MODELS[model].label}</p>
            )}
          </Panel>
        )}

        {confirmed && (
          <Panel step={5} title="Anthropic API key">
            <p className="text-xs text-bm-muted">
              Held in memory for this session only. Never stored to localStorage or logged.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyValid(false);
                  setKeyError(null);
                }}
                className="flex-1 rounded-lg border border-bm-border bg-bm-bg px-3 py-2 text-sm focus:outline-none focus:border-bm-accent"
              />
              <button
                onClick={handleValidateKey}
                disabled={!apiKey || keyValidating}
                className="px-4 py-2 rounded-lg bg-bm-border text-bm-text text-sm hover:bg-bm-accent-dim disabled:opacity-40"
              >
                {keyValidating ? 'Validating...' : 'Validate'}
              </button>
            </div>
            {keyValid && (
              <p className="text-sm text-bm-accent">Key validated.</p>
            )}
            {keyError && (
              <p className="text-sm text-red-400">{keyError}</p>
            )}
          </Panel>
        )}

        {confirmed && keyValid && (
          <Panel step={6} title="Generate summaries">
            <div className="flex items-center gap-3">
              <button
                disabled={running || allDone}
                onClick={handleStart}
                className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {running ? 'Running...' : allDone ? 'Done' : 'Start'}
              </button>
              {running && (
                <button
                  onClick={() => (abortRef.current = true)}
                  className="px-3 py-2 text-sm rounded-lg border border-red-500/50 text-red-300 hover:bg-red-500/10"
                >
                  Stop
                </button>
              )}
              {!running && failedCount > 0 && (
                <button
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="px-3 py-2 text-sm rounded-lg border border-bm-border hover:bg-bm-border"
                >
                  {retrying ? 'Retrying...' : `Retry failed (${failedCount})`}
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-4">
              <Stat
                label="Progress"
                value={`${doneCount} / ${eligibleIndices.length}`}
              />
              <Stat
                label="Overall"
                value={
                  eligibleIndices.length === 0
                    ? '0%'
                    : `${Math.round((doneCount / eligibleIndices.length) * 100)}%`
                }
              />
              <Stat label="Failed" value={failedCount} />
              <Stat label="Spent" value={`$${liveCost.toFixed(2)}`} />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
              {channelProgress.map((c) => {
                const pct = c.total === 0 ? 0 : ((c.done + c.failed) / c.total) * 100;
                return (
                  <div key={c.channelName} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono">
                        #{c.channelName}
                        {c.unmatched && (
                          <span className="text-bm-muted"> -&gt; Unmatched Slack</span>
                        )}
                        {c.targetSheet && (
                          <span className="text-bm-muted"> -&gt; {c.targetSheet}</span>
                        )}
                      </span>
                      <span className="text-bm-muted">
                        {c.done + c.failed} / {c.total}
                        {c.failed > 0 && (
                          <span className="text-red-400"> ({c.failed} failed)</span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 rounded bg-bm-border overflow-hidden">
                      <div
                        className="h-full bg-bm-accent transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {allDone && xlsxFile && (
          <Panel step={7} title="Build output XLSX">
            <p className="text-sm text-bm-muted">
              {Object.values(results).filter((r) => r.summary).length} summaries
              ready to write into {xlsxFile.name}.
            </p>
            <button
              onClick={handleBuildXlsx}
              className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
            >
              Build and download
            </button>
            {finalDownload && (
              <p className="text-sm text-bm-accent">Downloaded {finalDownload}</p>
            )}
          </Panel>
        )}
      </main>

      <footer className="text-center text-xs text-bm-muted py-6">
        Blu Mountain RevOps | blumountain.me
      </footer>
    </div>
  );
}
