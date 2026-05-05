// Thin Airtable REST client. Browser-direct, rate-limited at ≤5 req/sec/base
// via a shared token bucket. Retries 429 / 5xx with exponential backoff,
// up to 5 attempts. Used by full-backfill/components/AirtableWritePanel.jsx.

const API_BASE = 'https://api.airtable.com/v0';
const RATE_PER_SEC = 5;
const CAPACITY = 5;
const MAX_RETRIES = 5;

// Token bucket — exported for direct testing.
export class TokenBucket {
  constructor(rate, capacity) {
    this.rate = rate;
    this.capacity = capacity;
    this.tokens = capacity;
    this.last = Date.now();
  }
  async take() {
    while (true) {
      const now = Date.now();
      this.tokens = Math.min(
        this.capacity,
        this.tokens + ((now - this.last) / 1000) * this.rate,
      );
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = ((1 - this.tokens) / this.rate) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

const defaultBucket = new TokenBucket(RATE_PER_SEC, CAPACITY);
let activeBucket = defaultBucket;
let fetchImpl = null;

// Test hooks.
export function setBucketOverride(bucket) {
  activeBucket = bucket ?? defaultBucket;
}
export function setFetchOverride(fn) {
  fetchImpl = fn;
}

function doFetch(url, options) {
  return (fetchImpl ?? globalThis.fetch.bind(globalThis))(url, options);
}

async function request(url, options) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await activeBucket.take();
    const res = await doFetch(url, options);
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Airtable ${res.status} after ${MAX_RETRIES} attempts`);
      }
      const delay = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Airtable ${res.status}: ${text}`);
    }
    return res.json();
  }
  throw new Error('unreachable');
}

// Returns [{ id, name, fields: [{ id, name, type }] }, ...]
export async function getBaseSchema(baseId, pat) {
  const data = await request(`${API_BASE}/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  return data.tables;
}

// Compute the list of target client names that have no matching table in the
// base schema. Pure — exposed separately so the preflight check is testable
// without HTTP.
export function findMissingTables(schema, targetClients) {
  const have = new Set(schema.map((t) => t.name));
  return targetClients.filter((c) => !have.has(c));
}

// For a target table, list any required column names that are missing.
export function findMissingColumns(table, requiredColumns) {
  const have = new Set(table.fields.map((f) => f.name));
  return requiredColumns.filter((c) => !have.has(c));
}

// Delete every record in a table, batched at 10 ids per DELETE request.
export async function wipeTable(baseId, tableName, pat, onProgress) {
  const ids = [];
  let offset;
  do {
    const url = new URL(`${API_BASE}/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('fields[]', '');
    if (offset) url.searchParams.set('offset', offset);
    const data = await request(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });
    for (const r of data.records) ids.push(r.id);
    offset = data.offset;
  } while (offset);

  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const url = new URL(`${API_BASE}/${baseId}/${encodeURIComponent(tableName)}`);
    for (const id of batch) url.searchParams.append('records[]', id);
    await request(url.toString(), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pat}` },
    });
    deleted += batch.length;
    onProgress?.(deleted, ids.length);
  }
  return deleted;
}

// Insert records, batched at 10 per POST.
export async function insertRecords(baseId, tableName, rows, pat, onProgress) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    await request(`${API_BASE}/${baseId}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: batch.map((fields) => ({ fields })) }),
    });
    inserted += batch.length;
    onProgress?.(inserted, rows.length);
  }
  return inserted;
}

// Required v2 schema columns each client table must have. Used by preflight
// to verify *existing* tables — name-only list so adding columns here
// doesn't silently change auto-create behavior.
export const REQUIRED_COLUMNS = [
  'Engagement Date',
  'Type of Engagement',
  'Meeting Name',
  'Attendees',
  'Summary',
  'Action Items',
  'Slack Message',
];

// Field schema sent to the create-table endpoint when auto-creating a missing
// client table. Includes 'Source' on top of the v2 schema. 'Meeting Name'
// is first so it becomes the primary field in Airtable.
export const CREATE_TABLE_FIELDS = [
  { name: 'Meeting Name', type: 'singleLineText' },
  { name: 'Engagement Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Type of Engagement', type: 'singleLineText' },
  { name: 'Attendees', type: 'multilineText' },
  { name: 'Summary', type: 'multilineText' },
  { name: 'Action Items', type: 'multilineText' },
  { name: 'Slack Message', type: 'multilineText' },
  { name: 'Source', type: 'singleLineText' },
];

// Create a new client table in the base. Requires the PAT to have
// schema.bases:write scope. Returns the parsed table object on success.
export async function createTable(baseId, tableName, pat) {
  return await request(`${API_BASE}/meta/bases/${baseId}/tables`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: tableName,
      fields: CREATE_TABLE_FIELDS,
    }),
  });
}
