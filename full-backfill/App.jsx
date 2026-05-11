import { useCallback, useState } from 'react';
import { DEFAULT_MODEL } from '../slack-backfill/lib/claude.js';
import { buildSybillRows, buildSlackRows } from './lib/mergeRows.js';
import { classifyAllMeetings } from './lib/aiSybillClassifier.js';
import { computeSybillFingerprint } from './lib/sybillFingerprint.js';
import { ANTHROPIC_API_KEY } from './lib/secrets.js';
import SybillSourcePanel from './components/SybillSourcePanel.jsx';
import SlackSourcePanel from './components/SlackSourcePanel.jsx';
import ClassificationReviewPanel from './components/ClassificationReviewPanel.jsx';
import ChannelMatchPanel from './components/ChannelMatchPanel.jsx';
import CostPreview from './components/CostPreview.jsx';
import RunPanel from './components/RunPanel.jsx';
import AirtableWritePanel from './components/AirtableWritePanel.jsx';

const AI_ENABLED =
  typeof ANTHROPIC_API_KEY === 'string' &&
  ANTHROPIC_API_KEY.startsWith('sk-ant-') &&
  !ANTHROPIC_API_KEY.endsWith('...');

const CACHE_KEY_PREFIX = 'full-backfill:ai-classifications-v1';

export default function App() {
  // ── Sybill source / cutoff stats (Phase 2) ──────────────────────────────
  const [cutoffStats, setCutoffStats] = useState(null);

  // ── Sybill AI classification (Phase 3) ──────────────────────────────────
  const [sybillMeetings, setSybillMeetings] = useState(null);
  const [sybillAutoAssigned, setSybillAutoAssigned] = useState(null);
  const [sybillClassifying, setSybillClassifying] = useState(false);
  const [sybillProgress, setSybillProgress] = useState({ done: 0, total: 0 });
  const [sybillError, setSybillError] = useState(null);
  const [sybillRows, setSybillRows] = useState(null);

  // ── Slack source + channel mapping (Phases 2 & 4) ───────────────────────
  const [slackParsed, setSlackParsed] = useState(null);
  const [slackAssignments, setSlackAssignments] = useState(null);

  // ── AI run + merge (Phase 6) ─────────────────────────────────────────────
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [mergedRows, setMergedRows] = useState(null);

  // ── AI classification kickoff ────────────────────────────────────────────
  const runAiClassify = useCallback(async (meetings) => {
    setSybillError(null);
    setSybillClassifying(true);
    setSybillProgress({ done: 0, total: meetings.length });
    try {
      const fp = await computeSybillFingerprint(meetings);
      const cacheKey = `${CACHE_KEY_PREFIX}:${fp}`;
      let clients = null;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length === meetings.length) {
            clients = parsed;
          }
        }
      } catch {
        // corrupt cache: ignore, re-run AI
      }

      let results;
      if (clients) {
        results = meetings.map((m, i) => ({ meeting: m, client: clients[i] ?? 'Unknown' }));
        setSybillProgress({ done: meetings.length, total: meetings.length });
      } else {
        results = await classifyAllMeetings(
          ANTHROPIC_API_KEY,
          meetings,
          (done, total) => setSybillProgress({ done, total }),
        );
        try {
          localStorage.setItem(cacheKey, JSON.stringify(results.map((r) => r.client)));
        } catch {
          // quota: ignore, just won't cache
        }
      }
      setSybillAutoAssigned(results);
    } catch (e) {
      setSybillError(e.message || String(e));
    } finally {
      setSybillClassifying(false);
    }
  }, []);

  // ── Callbacks ────────────────────────────────────────────────────────────
  const handleSybillParsed = useCallback(({ meetings, droppedCount, totalCount }) => {
    setCutoffStats((prev) => ({ ...prev, sybillTotal: totalCount, sybillDropped: droppedCount }));
    setSybillMeetings(meetings);
    setSybillAutoAssigned(null);
    setSybillRows(null);
    setSybillError(null);
    if (!AI_ENABLED) return;
    runAiClassify(meetings);
  }, [runAiClassify]);

  const handleSlackParsed = useCallback(({ parsed, totalBuckets, eligibleBuckets }) => {
    setSlackParsed(parsed);
    setSlackAssignments(null);
    setCutoffStats((prev) => ({ ...prev, slackTotal: totalBuckets, slackEligible: eligibleBuckets }));
  }, []);

  const handleClassificationsConfirmed = useCallback((finalAssignments) => {
    setSybillRows(buildSybillRows(finalAssignments, []));
  }, []);

  const handleChannelMappingComplete = useCallback((assignments) => {
    setSlackAssignments(assignments);
  }, []);

  const handleCostConfirm = useCallback((modelId) => {
    setSelectedModel(modelId);
    setCostConfirmed(true);
  }, []);

  const handleRunComplete = useCallback((summaries) => {
    const sRows = buildSlackRows(slackAssignments ?? [], summaries);
    setMergedRows([...(sybillRows ?? []), ...sRows]);
  }, [slackAssignments, sybillRows]);

  const retryAiClassify = useCallback(() => {
    if (sybillMeetings) runAiClassify(sybillMeetings);
  }, [sybillMeetings, runAiClassify]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const bothReady = sybillRows !== null && slackAssignments !== null;
  const needsClassificationReview = sybillAutoAssigned !== null && sybillRows === null;
  const eligibleAssignments = slackAssignments?.filter((a) => a.eligible) ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-bm-border bg-bm-panel">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-xl font-semibold text-bm-text">Full Backfill</h1>
          <p className="text-sm text-bm-muted">
            Sybill + Slack &rarr; Airtable, in one run.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

          {/* Step 1: upload both sources in parallel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SybillSourcePanel onParsed={handleSybillParsed} />
            <SlackSourcePanel onParsed={handleSlackParsed} />
          </div>

          {/* Step 2a: AI classification progress / error */}
          {sybillMeetings && !AI_ENABLED && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2a.</span>Sybill classification (AI)
              </h2>
              <p className="text-sm text-bm-muted">
                Set <code className="text-bm-accent">ANTHROPIC_API_KEY</code> (or the{' '}
                <code className="text-bm-accent">VITE_ANTHROPIC_API_KEY</code> env var at build
                time) to enable AI classification.
              </p>
            </section>
          )}

          {sybillClassifying && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2a.</span>Classifying Sybill meetings (AI)
              </h2>
              <p className="text-xs text-bm-muted">
                Sonnet 4.6 · concurrency 16. Results cached locally by export fingerprint —
                re-uploading the same file restores without re-spending.
              </p>
              <p className="text-sm font-mono text-bm-text">
                {sybillProgress.done} / {sybillProgress.total} classified
              </p>
            </section>
          )}

          {sybillError && !sybillClassifying && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2a.</span>Sybill classification failed
              </h2>
              <p className="text-sm text-red-400">{sybillError}</p>
              <button
                onClick={retryAiClassify}
                className="px-3 py-1.5 rounded border border-bm-border text-sm text-bm-text hover:border-bm-accent-dim"
              >
                Retry
              </button>
            </section>
          )}

          {/* Step 2b: review all classifications */}
          {needsClassificationReview && (
            <ClassificationReviewPanel
              autoAssigned={sybillAutoAssigned}
              reviewAssigned={[]}
              internal={[]}
              uncertainGroupsCount={0}
              meetings={sybillMeetings}
              onComplete={handleClassificationsConfirmed}
            />
          )}

          {/* Sybill done — summary card */}
          {sybillRows !== null && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-1">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2a.</span>Sybill classification complete
              </h2>
              <p className="text-xs text-bm-muted">
                {sybillRows.length} row{sybillRows.length !== 1 ? 's' : ''} ready
                {sybillAutoAssigned && ` · ${sybillAutoAssigned.length} classified by AI`}
                {cutoffStats?.sybillDropped > 0 && ` · ${cutoffStats.sybillDropped} dropped by cutoff`}
              </p>
            </section>
          )}

          {/* Step 2c: Slack channel mapping (shown once Slack parses, before merge) */}
          {slackParsed && slackAssignments === null && (
            <ChannelMatchPanel
              parsed={slackParsed}
              onComplete={handleChannelMappingComplete}
            />
          )}

          {/* Step 2c complete */}
          {slackAssignments !== null && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-1">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2c.</span>Channel mapping complete
              </h2>
              <p className="text-xs text-bm-muted">
                {slackAssignments.length} bucket{slackAssignments.length !== 1 ? 's' : ''} assigned
                {' · '}
                {eligibleAssignments.length} eligible for summarization
              </p>
            </section>
          )}

          {/* Step 3: both branches done — info */}
          {bothReady && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-1">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">3.</span>Both sources ready
              </h2>
              <p className="text-xs text-bm-muted">
                {sybillRows.length} Sybill row{sybillRows.length !== 1 ? 's' : ''}
                {' · '}
                {eligibleAssignments.length} eligible Slack bucket
                {eligibleAssignments.length !== 1 ? 's' : ''}
              </p>
            </section>
          )}

          {/* Step 4: AI cost preview */}
          {bothReady && !costConfirmed && (
            <CostPreview
              slackAssignments={slackAssignments}
              onConfirm={handleCostConfirm}
            />
          )}

          {/* Step 5: AI run */}
          {costConfirmed && mergedRows === null && (
            <RunPanel
              slackAssignments={slackAssignments}
              model={selectedModel}
              onComplete={handleRunComplete}
            />
          )}

          {/* Step 6: Airtable write */}
          {mergedRows !== null && (
            <AirtableWritePanel rows={mergedRows} />
          )}

        </div>
      </main>

      <footer className="border-t border-bm-border bg-bm-panel">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-bm-muted">
          Blu Mountain RevOps &middot; Browser-only
        </div>
      </footer>
    </div>
  );
}
