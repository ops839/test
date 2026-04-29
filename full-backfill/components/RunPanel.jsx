import { useState } from 'react';
import {
  callClaude,
  runWithConcurrency,
  SYSTEM_PROMPT,
} from '../../slack-backfill/lib/claude.js';
import { buildPrompt } from '../../slack-backfill/lib/slackParser.js';
import { ANTHROPIC_API_KEY } from '../lib/secrets.js';
import { saveCheckpoint } from '../lib/checkpoint.js';

const CONCURRENCY = 16;
const API_ENABLED =
  typeof ANTHROPIC_API_KEY === 'string' &&
  ANTHROPIC_API_KEY.startsWith('sk-ant-') &&
  !ANTHROPIC_API_KEY.endsWith('...');

export default function RunPanel({ slackAssignments, model, onComplete }) {
  const [summaries, setSummaries] = useState({});
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const eligibleWithIdx = slackAssignments
    .map((a, i) => ({ ...a, originalIdx: i }))
    .filter((a) => a.eligible && a.targetClient);

  const totalEligible = eligibleWithIdx.length;
  const doneCount = Object.keys(summaries).length;
  const failedIdxs = Object.entries(summaries)
    .filter(([, v]) => v.error)
    .map(([k]) => Number(k));
  const successCount = doneCount - failedIdxs.length;
  const allDone = started && !running && doneCount === totalEligible;

  async function runBatch(toRun, initialSummaries) {
    setRunning(true);
    const localSummaries = { ...initialSummaries };

    const tasks = toRun.map((a) => async () => {
      const res = await callClaude({
        apiKey: ANTHROPIC_API_KEY,
        model,
        system: SYSTEM_PROMPT,
        user: buildPrompt(a.bucket),
      });
      return { originalIdx: a.originalIdx, ...res };
    });

    await runWithConcurrency(tasks, CONCURRENCY, (_i, result, error) => {
      if (error) {
        const a = toRun[_i];
        localSummaries[a.originalIdx] = { error: error.message || String(error) };
      } else {
        const { originalIdx, text, inputTokens, outputTokens } = result;
        localSummaries[originalIdx] = { summary: text, inputTokens, outputTokens };
      }
      setSummaries({ ...localSummaries });
    });

    setRunning(false);
    saveCheckpoint({ model, slackSummaries: localSummaries });
    return localSummaries;
  }

  async function handleStart() {
    setStarted(true);
    setSummaries({});
    await runBatch(eligibleWithIdx, {});
  }

  async function handleRetryFailed() {
    const toRetry = eligibleWithIdx.filter((a) => summaries[a.originalIdx]?.error);
    const cleared = { ...summaries };
    for (const a of toRetry) delete cleared[a.originalIdx];
    setSummaries(cleared);
    await runBatch(toRetry, cleared);
  }

  function handleContinue() {
    saveCheckpoint({ model, slackSummaries: summaries });
    onComplete(summaries);
  }

  if (!API_ENABLED) {
    return (
      <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-3">
        <h2 className="text-base font-semibold text-bm-text">
          <span className="text-bm-accent mr-2">5.</span>Summarize Slack messages
        </h2>
        <p className="text-sm text-bm-muted">
          Set <code className="text-bm-accent">ANTHROPIC_API_KEY</code> in{' '}
          <code className="text-bm-accent">full-backfill/lib/secrets.js</code> to enable AI
          summarization.
        </p>
        <button
          onClick={() => onComplete({})}
          className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim"
        >
          Skip AI — continue without Slack summaries
        </button>
      </section>
    );
  }

  if (totalEligible === 0) {
    return (
      <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-3">
        <h2 className="text-base font-semibold text-bm-text">
          <span className="text-bm-accent mr-2">5.</span>Summarize Slack messages
        </h2>
        <p className="text-sm text-bm-muted">No eligible buckets to summarize.</p>
        <button
          onClick={() => onComplete({})}
          className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
        >
          Continue to Airtable write
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">5.</span>Summarize Slack messages
      </h2>

      {!started && (
        <div className="space-y-2">
          <p className="text-sm text-bm-text">
            Ready to summarize{' '}
            <span className="text-bm-accent font-semibold">{totalEligible}</span>{' '}
            eligible bucket{totalEligible !== 1 ? 's' : ''} at concurrency {CONCURRENCY}.
          </p>
          <button
            onClick={handleStart}
            className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
          >
            Start
          </button>
        </div>
      )}

      {started && (
        <div className="space-y-3">
          <p className="text-sm text-bm-text">
            {running ? 'Running…' : 'Complete.'}
            {' '}
            <span className="text-bm-accent">{doneCount}</span>
            {' / '}
            {totalEligible} done
            {failedIdxs.length > 0 && (
              <span className="text-red-400 ml-2">({failedIdxs.length} failed)</span>
            )}
          </p>

          {allDone && failedIdxs.length === 0 && (
            <button
              onClick={handleContinue}
              className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
            >
              Continue to Airtable write
            </button>
          )}

          {allDone && failedIdxs.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleRetryFailed}
                className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim"
              >
                Retry failed ({failedIdxs.length})
              </button>
              <button
                onClick={handleContinue}
                className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim"
              >
                Continue with partial ({successCount} summar{successCount !== 1 ? 'ies' : 'y'})
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
