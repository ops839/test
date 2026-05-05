import { useCallback, useState } from 'react';
import { DEFAULT_MODEL } from '../slack-backfill/lib/claude.js';
import { classifyMeeting } from '../src/lib/classifier.js';
import { groupUncertain } from '../src/lib/grouping.js';
import { buildSybillRows, buildSlackRows } from './lib/mergeRows.js';
import SybillSourcePanel from './components/SybillSourcePanel.jsx';
import SlackSourcePanel from './components/SlackSourcePanel.jsx';
import SybillReview from './components/SybillReview.jsx';
import ClassificationReviewPanel from './components/ClassificationReviewPanel.jsx';
import ChannelMatchPanel from './components/ChannelMatchPanel.jsx';
import CostPreview from './components/CostPreview.jsx';
import RunPanel from './components/RunPanel.jsx';
import AirtableWritePanel from './components/AirtableWritePanel.jsx';

export default function App() {
  // ── Sybill source / cutoff stats (Phase 2) ──────────────────────────────
  const [cutoffStats, setCutoffStats] = useState(null);

  // ── Sybill classification (Phase 3) ─────────────────────────────────────
  const [sybillMeetings, setSybillMeetings] = useState(null);
  const [sybillAutoAssigned, setSybillAutoAssigned] = useState(null);
  const [sybillGroups, setSybillGroups] = useState(null);
  const [sybillReviewAssigned, setSybillReviewAssigned] = useState(null);
  const [sybillRows, setSybillRows] = useState(null);

  // ── Slack source + channel mapping (Phases 2 & 4) ───────────────────────
  const [slackParsed, setSlackParsed] = useState(null);
  const [slackAssignments, setSlackAssignments] = useState(null);

  // ── AI run + merge (Phase 6) ─────────────────────────────────────────────
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [mergedRows, setMergedRows] = useState(null);

  // ── Callbacks ────────────────────────────────────────────────────────────
  const handleSybillParsed = useCallback(({ meetings, droppedCount, totalCount }) => {
    setCutoffStats((prev) => ({ ...prev, sybillTotal: totalCount, sybillDropped: droppedCount }));
    setSybillMeetings(meetings);
    setSybillAutoAssigned(null);
    setSybillGroups(null);
    setSybillReviewAssigned(null);
    setSybillRows(null);

    // Classification is synchronous — run inline to avoid cascading effects.
    const autoAssigned = [];
    const uncertain = [];
    for (const meeting of meetings) {
      const r = classifyMeeting(meeting);
      if (r.status === 'client') {
        autoAssigned.push({ meeting, client: r.client });
      } else if (r.status === 'uncertain') {
        uncertain.push({ ...meeting, candidateDomain: r.candidateDomain });
      }
      // 'internal': silently drop
    }
    setSybillAutoAssigned(autoAssigned);
    if (uncertain.length > 0) {
      setSybillGroups(groupUncertain(uncertain));
    } else {
      // No uncertain meetings — skip past the two-pane review and go straight
      // to the all-classifications review.
      setSybillGroups([]);
      setSybillReviewAssigned([]);
    }
  }, []);

  const handleSlackParsed = useCallback(({ parsed, totalBuckets, eligibleBuckets }) => {
    setSlackParsed(parsed);
    setSlackAssignments(null);
    setCutoffStats((prev) => ({ ...prev, slackTotal: totalBuckets, slackEligible: eligibleBuckets }));
  }, []);

  const handleReviewComplete = useCallback((reviewAssigned) => {
    setSybillReviewAssigned(reviewAssigned);
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

  // ── Derived state ─────────────────────────────────────────────────────────
  const bothReady = sybillRows !== null && slackAssignments !== null;
  const needsReview =
    sybillGroups !== null && sybillGroups.length > 0 && sybillReviewAssigned === null;
  const needsClassificationReview =
    sybillAutoAssigned !== null && sybillReviewAssigned !== null && sybillRows === null;
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

          {/* Step 2a: Sybill review (shown while Slack may still be uploading) */}
          {needsReview && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-bm-text px-1">
                <span className="text-bm-accent mr-2">2a.</span>
                Review uncertain Sybill meetings
                <span className="text-bm-muted font-normal text-xs ml-2">
                  ({sybillGroups.length} group{sybillGroups.length !== 1 ? 's' : ''})
                  — you can complete this while Slack uploads
                </span>
              </h2>
              <SybillReview groups={sybillGroups} onComplete={handleReviewComplete} />
            </section>
          )}

          {/* Step 2c: review all classifications */}
          {needsClassificationReview && (
            <ClassificationReviewPanel
              autoAssigned={sybillAutoAssigned}
              reviewAssigned={sybillReviewAssigned}
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
                {sybillAutoAssigned && ` · ${sybillAutoAssigned.length} auto-assigned`}
                {cutoffStats?.sybillDropped > 0 && ` · ${cutoffStats.sybillDropped} dropped by cutoff`}
              </p>
            </section>
          )}

          {/* Step 2b: Slack channel mapping (shown once Slack parses, before merge) */}
          {slackParsed && slackAssignments === null && (
            <ChannelMatchPanel
              parsed={slackParsed}
              onComplete={handleChannelMappingComplete}
            />
          )}

          {/* Step 2b complete */}
          {slackAssignments !== null && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-1">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2b.</span>Channel mapping complete
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
