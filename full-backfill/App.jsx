import { useCallback, useState } from 'react';
import { classifyMeeting } from '../src/lib/classifier.js';
import { groupUncertain } from '../src/lib/grouping.js';
import SybillSourcePanel from './components/SybillSourcePanel.jsx';
import SlackSourcePanel from './components/SlackSourcePanel.jsx';
import SybillReview from './components/SybillReview.jsx';

// Build final Airtable-ready rows from auto-classified and review-confirmed meetings.
function buildSybillRows(autoAssigned, reviewAssigned) {
  return [...autoAssigned, ...reviewAssigned].map(({ meeting, client }) => ({
    targetClient: client,
    fields: {
      'Engagement Date': meeting.date,
      'Type of Engagement': 'Meeting',
      'Meeting Name': meeting.title,
      'Attendees': meeting.attendees,
      'Summary': meeting.summary,
      'Action Items': meeting.actionItems,
      'Slack Message': '',
    },
  }));
}

export default function App() {
  // ── Sybill source / cutoff stats (Phase 2) ──────────────────────────────
  const [cutoffStats, setCutoffStats] = useState(null);

  // ── Sybill classification (Phase 3) ─────────────────────────────────────
  const [sybillAutoAssigned, setSybillAutoAssigned] = useState(null);
  const [sybillGroups, setSybillGroups] = useState(null);   // uncertain groups for review
  const [sybillRows, setSybillRows] = useState(null);        // final rows after review

  // ── Slack source (Phase 2) ───────────────────────────────────────────────
  const [slackParsed, setSlackParsed] = useState(null);

  // ── Callbacks ────────────────────────────────────────────────────────────
  const handleSybillParsed = useCallback(({ meetings, droppedCount, totalCount }) => {
    setCutoffStats((prev) => ({ ...prev, sybillTotal: totalCount, sybillDropped: droppedCount }));

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
      setSybillGroups([]);
      setSybillRows(buildSybillRows(autoAssigned, []));
    }
  }, []);

  const handleSlackParsed = useCallback(({ parsed, totalBuckets, eligibleBuckets }) => {
    setSlackParsed(parsed);
    setCutoffStats((prev) => ({ ...prev, slackTotal: totalBuckets, slackEligible: eligibleBuckets }));
  }, []);

  const handleReviewComplete = useCallback((reviewAssigned) => {
    setSybillRows(buildSybillRows(sybillAutoAssigned ?? [], reviewAssigned));
  }, [sybillAutoAssigned]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const bothReady = sybillRows !== null && slackParsed !== null;
  const needsReview = sybillGroups !== null && sybillGroups.length > 0 && sybillRows === null;
  const classifyDone = sybillAutoAssigned !== null;

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

          {/* Step 2: classification summary (Sybill only, shown while Slack may still be uploading) */}
          {classifyDone && !needsReview && sybillRows !== null && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-1">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">2.</span>Sybill classification complete
              </h2>
              <p className="text-xs text-bm-muted">
                {sybillRows.length} row{sybillRows.length !== 1 ? 's' : ''} ready
                {sybillAutoAssigned && ` · ${sybillAutoAssigned.length} auto-assigned`}
                {cutoffStats?.sybillDropped > 0 && ` · ${cutoffStats.sybillDropped} dropped by cutoff`}
              </p>
            </section>
          )}

          {/* Step 2 (review path): show review while Slack can still be uploading */}
          {needsReview && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-bm-text px-1">
                <span className="text-bm-accent mr-2">2.</span>
                Review uncertain Sybill meetings
                <span className="text-bm-muted font-normal text-xs ml-2">
                  ({sybillGroups.length} group{sybillGroups.length !== 1 ? 's' : ''})
                  — you can complete this while Slack uploads
                </span>
              </h2>
              <SybillReview groups={sybillGroups} onComplete={handleReviewComplete} />
            </section>
          )}

          {/* Step 3: both sources ready — next phases will go here */}
          {bothReady && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-bm-text">
                <span className="text-bm-accent mr-2">3.</span>Both sources ready
              </h2>
              <p className="text-xs text-bm-muted">
                {sybillRows.length} Sybill row{sybillRows.length !== 1 ? 's' : ''}
                {' · '}
                {slackParsed.channels.length} Slack channel{slackParsed.channels.length !== 1 ? 's' : ''}
                {cutoffStats?.slackEligible != null &&
                  ` · ${cutoffStats.slackEligible} / ${cutoffStats.slackTotal} buckets eligible`}
              </p>
              <p className="text-xs text-bm-muted">
                Channel mapping and AI summarization coming in the next phases.
              </p>
            </section>
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
