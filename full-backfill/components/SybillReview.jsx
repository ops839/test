import { useEffect, useState } from 'react';
import ReviewPanel from '../../src/components/ReviewPanel.jsx';
import { classifyGroups } from '../../src/lib/ai.js';
import { ANTHROPIC_API_KEY } from '../lib/secrets.js';

// AI suggestions are only attempted when the key looks like a real value.
const AI_ENABLED =
  typeof ANTHROPIC_API_KEY === 'string' &&
  ANTHROPIC_API_KEY.startsWith('sk-ant-') &&
  !ANTHROPIC_API_KEY.endsWith('...');

export default function SybillReview({ groups, onComplete }) {
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [aiComplete, setAiComplete] = useState(false);

  // Derive whether AI is currently in flight (avoids setState in effect body).
  const aiRunning = AI_ENABLED && (groups?.length ?? 0) > 0 && !aiComplete;

  useEffect(() => {
    if (!AI_ENABLED || !groups || groups.length === 0) return;
    let cancelled = false;
    classifyGroups(ANTHROPIC_API_KEY, groups, null)
      .then((results) => { if (!cancelled) setAiSuggestions(results); })
      .catch((e) => console.warn('SybillReview: AI classify failed:', e))
      .finally(() => { if (!cancelled) setAiComplete(true); });
    return () => { cancelled = true; };
  }, [groups]);

  function handleConfirm(finalized) {
    // Filter out skipped / internal (client === null) and pass assigned pairs up.
    const assigned = finalized
      .filter((f) => f.client !== null)
      .map((f) => ({ meeting: f.meeting, client: f.client }));
    onComplete(assigned);
  }

  if (!groups || groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {aiRunning && (
        <p className="text-xs text-bm-muted px-1">
          Running AI suggestions for {groups.length} group{groups.length !== 1 ? 's' : ''}…
        </p>
      )}
      <ReviewPanel
        groups={groups}
        aiSuggestions={aiSuggestions}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
