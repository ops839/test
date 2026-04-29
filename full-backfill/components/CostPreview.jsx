import { useMemo, useState } from 'react';
import {
  MODELS,
  DEFAULT_MODEL,
  estimateTokens,
  estimateCost,
} from '../../slack-backfill/lib/claude.js';
import { buildPrompt } from '../../slack-backfill/lib/slackParser.js';

export default function CostPreview({ slackAssignments, onConfirm }) {
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

  const stats = useMemo(() => {
    const eligible = slackAssignments.filter((a) => a.eligible);
    const totalBuckets = slackAssignments.length;
    const eligibleCount = eligible.length;
    let inputTokens = 0;
    for (const a of eligible) {
      inputTokens += estimateTokens(buildPrompt(a.bucket));
    }
    const outputTokens = eligibleCount * 120;
    const costs = {};
    for (const id of Object.keys(MODELS)) {
      costs[id] = estimateCost(inputTokens, outputTokens, id);
    }
    return { totalBuckets, eligibleCount, inputTokens, outputTokens, costs };
  }, [slackAssignments]);

  return (
    <section className="rounded-xl border border-bm-border bg-bm-panel p-6 space-y-4">
      <h2 className="text-base font-semibold text-bm-text">
        <span className="text-bm-accent mr-2">4.</span>AI cost estimate
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-bm-muted">Total buckets</div>
          <div className="text-sm font-medium text-bm-text">{stats.totalBuckets}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-bm-muted">Eligible (&le;30d)</div>
          <div className="text-sm font-medium text-bm-text">{stats.eligibleCount}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-bm-muted">Est. input tokens</div>
          <div className="text-sm font-medium text-bm-text">{stats.inputTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-bm-muted">Est. output tokens</div>
          <div className="text-sm font-medium text-bm-text">{stats.outputTokens.toLocaleString()}</div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-bm-muted">Estimated cost — select model:</p>
        <div className="space-y-1">
          {Object.entries(MODELS).map(([id, m]) => (
            <label key={id} className="flex items-center gap-3 cursor-pointer text-sm">
              <input
                type="radio"
                name="full-backfill-model"
                value={id}
                checked={selectedModel === id}
                onChange={() => setSelectedModel(id)}
              />
              <span className="text-bm-text font-medium">{m.label}</span>
              <span className="text-bm-muted">
                {'≈ $'}{stats.costs[id].toFixed(4)}
              </span>
            </label>
          ))}
        </div>
      </div>

      {stats.eligibleCount === 0 && (
        <p className="text-xs text-bm-muted">
          No eligible buckets — confirming will skip AI and proceed directly to write.
        </p>
      )}

      <button
        onClick={() => onConfirm(selectedModel)}
        className="px-4 py-2 rounded-lg bg-bm-accent text-bm-bg text-sm font-medium hover:opacity-90"
      >
        Confirm and run
      </button>
    </section>
  );
}
