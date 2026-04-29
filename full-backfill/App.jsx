import { useState, useCallback } from 'react';
import SybillSourcePanel from './components/SybillSourcePanel.jsx';
import SlackSourcePanel from './components/SlackSourcePanel.jsx';

export default function App() {
  const [sybillMeetings, setSybillMeetings] = useState(null);
  const [slackParsed, setSlackParsed] = useState(null);
  const [cutoffStats, setCutoffStats] = useState(null);

  const handleSybillParsed = useCallback(({ meetings, droppedCount, totalCount }) => {
    setSybillMeetings(meetings);
    setCutoffStats((prev) => ({ ...prev, sybillTotal: totalCount, sybillDropped: droppedCount }));
  }, []);

  const handleSlackParsed = useCallback(({ parsed, totalBuckets, eligibleBuckets }) => {
    setSlackParsed(parsed);
    setCutoffStats((prev) => ({ ...prev, slackTotal: totalBuckets, slackEligible: eligibleBuckets }));
  }, []);

  const bothDone = sybillMeetings !== null && slackParsed !== null;

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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SybillSourcePanel onParsed={handleSybillParsed} />
            <SlackSourcePanel onParsed={handleSlackParsed} />
          </div>

          {bothDone && (
            <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-bm-text">Both sources loaded</h2>
              <p className="text-xs text-bm-muted">
                {sybillMeetings.length} Sybill meeting
                {sybillMeetings.length !== 1 ? 's' : ''} within cutoff
                {cutoffStats?.sybillDropped > 0 && ` (${cutoffStats.sybillDropped} dropped)`}
                {' · '}
                {slackParsed.channels.length} Slack channel
                {slackParsed.channels.length !== 1 ? 's' : ''}
                {cutoffStats?.slackEligible != null &&
                  ` · ${cutoffStats.slackEligible} / ${cutoffStats.slackTotal} buckets eligible`}
              </p>
              <p className="text-xs text-bm-muted">Classification and channel mapping coming in the next phase.</p>
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
