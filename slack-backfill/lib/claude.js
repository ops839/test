// Claude API client (browser-direct).

export const MODELS = {
  'claude-haiku-4-5': {
    label: 'Haiku 4.5',
    id: 'claude-haiku-4-5',
    inputPerM: 1.0,
    outputPerM: 5.0,
  },
  'claude-sonnet-4-6': {
    label: 'Sonnet 4.6',
    id: 'claude-sonnet-4-6',
    inputPerM: 3.0,
    outputPerM: 15.0,
  },
};

export const DEFAULT_MODEL = 'claude-haiku-4-5';

export const SYSTEM_PROMPT =
  'You are summarizing one day of Slack messages from a B2B consultancy client channel. ' +
  'Output 2-4 sentences capturing what was discussed, decided, or flagged. ' +
  'Focus on substance, skip pleasantries. Use Canadian English. No em dashes.';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

async function callClaudeOnce({ apiKey, model, system, user, maxTokens = 400 }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const err = new Error(`Claude API ${res.status}: ${errBody.slice(0, 300)}`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const usage = data.usage || {};
  return {
    text,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callClaude(opts) {
  let attempt = 0;
  const maxRetries = 3;
  while (true) {
    try {
      return await callClaudeOnce(opts);
    } catch (e) {
      if (e.status === 429 && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        await sleep(delay);
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
}

// Validate by making one cheap test call
export async function validateApiKey(apiKey) {
  const res = await callClaudeOnce({
    apiKey,
    model: DEFAULT_MODEL,
    system: 'Respond with the single word OK.',
    user: 'ping',
    maxTokens: 8,
  });
  return res.text.length > 0;
}

// Run async tasks with a concurrency limit. `tasks` is a list of () => Promise.
// `onResult(idx, result, error)` is called for each. Returns when all done.
export async function runWithConcurrency(tasks, concurrency, onResult) {
  let next = 0;
  const total = tasks.length;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= total) return;
      try {
        const result = await tasks[idx]();
        onResult(idx, result, null);
      } catch (err) {
        onResult(idx, null, err);
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

// Rough token estimator: 4 chars per token.
export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(str.length / 4);
}

export function estimateCost(inputTokens, outputTokens, modelId) {
  const m = MODELS[modelId];
  if (!m) return 0;
  return (
    (inputTokens / 1_000_000) * m.inputPerM +
    (outputTokens / 1_000_000) * m.outputPerM
  );
}
