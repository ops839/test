// Smoke tests for Phases 2, 4, 5: cutoffs, fingerprint, airtable client,
// checkpoint roundtrip. Run with: node full-backfill/test-pipeline.mjs

// localStorage polyfill for Node — checkpoint.js targets the browser.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

import { SYBILL_CUTOFF_DAYS, SLACK_CUTOFF_DAYS, cutoffDateStr } from './lib/cutoffs.js';
import { computeExportFingerprint } from './lib/exportFingerprint.js';
import {
  TokenBucket,
  findMissingTables,
  findMissingColumns,
  REQUIRED_COLUMNS,
  CREATE_TABLE_FIELDS,
  wipeTable,
  insertRecords,
  getBaseSchema,
  createTable,
  setBucketOverride,
  setFetchOverride,
} from './lib/airtable.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from './lib/checkpoint.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function daysAgoStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function filterSybill(meetings, days) {
  const cutoff = cutoffDateStr(days);
  return meetings.filter((m) => m.date >= cutoff);
}

function filterSlackBuckets(buckets, days) {
  const cutoff = cutoffDateStr(days);
  return buckets.filter((b) => b.date >= cutoff);
}

// ─── cutoffDateStr ──────────────────────────────────────────────────────────

console.log('cutoffDateStr:');

{
  const result = cutoffDateStr(0);
  const today = new Date().toISOString().slice(0, 10);
  assert(result === today, `cutoffDateStr(0) === today (${today})`);
}

{
  const result = cutoffDateStr(SYBILL_CUTOFF_DAYS);
  const expected = daysAgoStr(SYBILL_CUTOFF_DAYS);
  assert(result === expected, `cutoffDateStr(SYBILL_CUTOFF_DAYS) === ${expected}`);
}

{
  const result = cutoffDateStr(SLACK_CUTOFF_DAYS);
  const expected = daysAgoStr(SLACK_CUTOFF_DAYS);
  assert(result === expected, `cutoffDateStr(SLACK_CUTOFF_DAYS) === ${expected}`);
}

assert(typeof cutoffDateStr(1) === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoffDateStr(1)),
  'cutoffDateStr returns YYYY-MM-DD string');

// ─── Sybill cutoff filtering ────────────────────────────────────────────────

console.log('\nSybill cutoff filtering:');

{
  const meetings = [
    { date: daysAgoStr(10), title: 'Recent meeting' },
    { date: daysAgoStr(364), title: 'Just within cutoff' },
    { date: daysAgoStr(365), title: 'On the cutoff day' },
    { date: daysAgoStr(366), title: 'One day past cutoff' },
    { date: daysAgoStr(500), title: 'Old meeting' },
  ];

  const filtered = filterSybill(meetings, SYBILL_CUTOFF_DAYS);

  // daysAgoStr(365) === cutoffDateStr(365), so the "on cutoff" meeting is included (>=)
  assert(filtered.length === 3, `3 of 5 meetings pass 365-day cutoff (got ${filtered.length})`);
  assert(filtered.every((m) => m.date >= cutoffDateStr(SYBILL_CUTOFF_DAYS)),
    'all kept meetings are within cutoff');
  assert(!filtered.some((m) => m.title === 'Old meeting'), 'old meeting is dropped');
  assert(!filtered.some((m) => m.title === 'One day past cutoff'), 'day-366 meeting is dropped');
}

{
  const empty = filterSybill([], SYBILL_CUTOFF_DAYS);
  assert(empty.length === 0, 'empty input returns empty');
}

{
  const allOld = [
    { date: daysAgoStr(400), title: 'Old 1' },
    { date: daysAgoStr(500), title: 'Old 2' },
  ];
  const filtered = filterSybill(allOld, SYBILL_CUTOFF_DAYS);
  assert(filtered.length === 0, 'all-old list returns empty');
}

// ─── Slack cutoff filtering ──────────────────────────────────────────────────

console.log('\nSlack cutoff filtering:');

{
  const buckets = [
    { date: daysAgoStr(1), channelName: 'general' },
    { date: daysAgoStr(15), channelName: 'general' },
    { date: daysAgoStr(30), channelName: 'general' },   // on cutoff — included
    { date: daysAgoStr(31), channelName: 'general' },   // just past — excluded
    { date: daysAgoStr(60), channelName: 'general' },
  ];

  const eligible = filterSlackBuckets(buckets, SLACK_CUTOFF_DAYS);
  assert(eligible.length === 3, `3 of 5 buckets pass 30-day cutoff (got ${eligible.length})`);
  assert(eligible.every((b) => b.date >= cutoffDateStr(SLACK_CUTOFF_DAYS)),
    'all eligible buckets are within cutoff');
}

{
  const empty = filterSlackBuckets([], SLACK_CUTOFF_DAYS);
  assert(empty.length === 0, 'empty bucket list returns empty');
}

{
  const allRecent = [
    { date: daysAgoStr(0), channelName: 'eng' },
    { date: daysAgoStr(5), channelName: 'eng' },
  ];
  const eligible = filterSlackBuckets(allRecent, SLACK_CUTOFF_DAYS);
  assert(eligible.length === 2, 'all-recent buckets all eligible');
}

// ─── constants ──────────────────────────────────────────────────────────────

console.log('\nConstants:');
assert(SYBILL_CUTOFF_DAYS === 365, `SYBILL_CUTOFF_DAYS === 365 (got ${SYBILL_CUTOFF_DAYS})`);
assert(SLACK_CUTOFF_DAYS === 30, `SLACK_CUTOFF_DAYS === 30 (got ${SLACK_CUTOFF_DAYS})`);

// ─── exportFingerprint ───────────────────────────────────────────────────────

console.log('\nexportFingerprint:');

function makeChannels(folderNames) {
  return folderNames.map((name) => ({ folderPath: `export/${name}`, name, dayBuckets: [] }));
}

{
  const channels = makeChannels(['general', 'eng', 'sales']);
  const [id1, id2] = await Promise.all([
    computeExportFingerprint(channels),
    computeExportFingerprint(channels),
  ]);
  assert(id1 === id2, 'same channels → same fingerprint (stability)');
  assert(typeof id1 === 'string' && id1.length === 40, `fingerprint is 40-char hex (got "${id1}")`);
  assert(/^[0-9a-f]+$/.test(id1), 'fingerprint is lowercase hex');
}

{
  const a = makeChannels(['general', 'eng']);
  const b = makeChannels(['general', 'sales']);
  const [idA, idB] = await Promise.all([
    computeExportFingerprint(a),
    computeExportFingerprint(b),
  ]);
  assert(idA !== idB, 'different channels → different fingerprint');
}

{
  // Order of channels should not matter (sorted internally)
  const forward = makeChannels(['aaa', 'bbb', 'ccc']);
  const reverse = makeChannels(['ccc', 'bbb', 'aaa']);
  const [idF, idR] = await Promise.all([
    computeExportFingerprint(forward),
    computeExportFingerprint(reverse),
  ]);
  assert(idF === idR, 'channel order does not affect fingerprint');
}

{
  const single = makeChannels(['only-channel']);
  const id = await computeExportFingerprint(single);
  assert(id.length === 40, 'single-channel fingerprint is 40 chars');
}

{
  // Cache scoping: verify the shape logic used in ChannelMatchPanel.
  // Two exports with different fingerprints should load independent choices.
  const mockStorage = {};
  const fakeLS = {
    getItem: (k) => mockStorage[k] ?? null,
    setItem: (k, v) => { mockStorage[k] = v; },
  };

  const [idA, idB] = await Promise.all([
    computeExportFingerprint(makeChannels(['alpha'])),
    computeExportFingerprint(makeChannels(['beta'])),
  ]);

  // Simulate saving choices for idA
  const cacheAfterA = { [idA]: { alpha: 'Athena' } };
  fakeLS.setItem('full-backfill:channel-cache-v1', JSON.stringify(cacheAfterA));

  // Simulate hydrating idB — should get empty choices, not idA's choices
  const cache = JSON.parse(fakeLS.getItem('full-backfill:channel-cache-v1'));
  const choicesForB = cache[idB] ?? {};
  assert(Object.keys(choicesForB).length === 0, 'different fingerprint loads empty choices (cache scoping)');

  // Simulate hydrating idA — should restore its choices
  const choicesForA = cache[idA] ?? {};
  assert(choicesForA['alpha'] === 'Athena', 'same fingerprint restores cached choices');
}

// ─── airtable: TokenBucket rate limit ───────────────────────────────────────

console.log('\nairtable TokenBucket:');

{
  // 10 tokens/sec, burst capacity 5: first 5 free, next 5 take ~0.5s.
  const tb = new TokenBucket(10, 5);
  const start = Date.now();
  for (let i = 0; i < 10; i++) await tb.take();
  const elapsed = Date.now() - start;
  assert(elapsed >= 400,
    `10 takes at rate=10 capacity=5 → at least ~0.5s (got ${elapsed}ms)`);
  assert(elapsed < 1500, `not absurdly slow (got ${elapsed}ms)`);
}

{
  // Burst within capacity should be near-instant.
  const tb = new TokenBucket(5, 5);
  const start = Date.now();
  for (let i = 0; i < 5; i++) await tb.take();
  const elapsed = Date.now() - start;
  assert(elapsed < 100, `5 takes within burst capacity is instant (got ${elapsed}ms)`);
}

// ─── airtable: halt-on-missing-table ────────────────────────────────────────

console.log('\nairtable preflight (pure):');

{
  const schema = [
    { id: 't1', name: 'Athena', fields: [] },
    { id: 't2', name: 'Bushel', fields: [] },
  ];
  const targets = ['Athena', 'Bushel', 'NewClient', 'AnotherNew'];
  const missing = findMissingTables(schema, targets);
  assert(missing.length === 2, `2 of 4 targets missing (got ${missing.length})`);
  assert(missing.includes('NewClient') && missing.includes('AnotherNew'),
    'both new targets surfaced');
}

{
  const allPresent = findMissingTables([{ id: 'x', name: 'A', fields: [] }], ['A']);
  assert(allPresent.length === 0, 'no missing when all present');
}

{
  // Column check: spec requires exact v2 schema column names.
  const fullTable = {
    name: 'Athena',
    fields: REQUIRED_COLUMNS.map((name) => ({ id: name, name, type: 'singleLineText' })),
  };
  assert(findMissingColumns(fullTable, REQUIRED_COLUMNS).length === 0,
    'fully-specced table has no missing columns');

  const partialTable = {
    name: 'Athena',
    fields: [
      { id: 'f1', name: 'Engagement Date', type: 'date' },
      { id: 'f2', name: 'Meeting Name', type: 'singleLineText' },
    ],
  };
  const missingCols = findMissingColumns(partialTable, REQUIRED_COLUMNS);
  assert(missingCols.length === REQUIRED_COLUMNS.length - 2,
    `partial table missing ${REQUIRED_COLUMNS.length - 2} columns (got ${missingCols.length})`);
  assert(missingCols.includes('Summary') && missingCols.includes('Action Items'),
    'specific missing columns surface correctly');
}

// ─── airtable: wipe-then-insert order via mocked fetch ──────────────────────

console.log('\nairtable wipe-then-insert order:');

{
  // Use a fast bucket so the test isn't slowed by rate limit.
  setBucketOverride(new TokenBucket(1000, 1000));

  const fetchLog = [];
  setFetchOverride(async (url, options) => {
    const method = options?.method ?? 'GET';
    const u = url.toString();
    fetchLog.push({ method, url: u });

    if (method === 'GET' && u.includes('/meta/bases/')) {
      return {
        ok: true, status: 200,
        json: async () => ({ tables: [{ id: 't1', name: 'Athena', fields: [] }] }),
        text: async () => '',
      };
    }
    if (method === 'GET') {
      // List records — return one page with two records, no offset.
      return {
        ok: true, status: 200,
        json: async () => ({ records: [{ id: 'rec1' }, { id: 'rec2' }] }),
        text: async () => '',
      };
    }
    if (method === 'DELETE') {
      return {
        ok: true, status: 200,
        json: async () => ({ records: [{ id: 'rec1', deleted: true }] }),
        text: async () => '',
      };
    }
    if (method === 'POST') {
      return {
        ok: true, status: 200,
        json: async () => ({ records: [{ id: 'recNew' }] }),
        text: async () => '',
      };
    }
    return { ok: false, status: 500, json: async () => ({}), text: async () => 'unhandled' };
  });

  // Verify schema fetch
  const schema = await getBaseSchema('appBase', 'patFake');
  assert(schema.length === 1 && schema[0].name === 'Athena',
    'getBaseSchema returns parsed tables');

  // Run wipe then insert against the same table
  const wiped = await wipeTable('appBase', 'Athena', 'patFake');
  const inserted = await insertRecords('appBase', 'Athena', [{ x: 1 }, { x: 2 }], 'patFake');

  assert(wiped === 2, `wipeTable deleted 2 records (got ${wiped})`);
  assert(inserted === 2, `insertRecords inserted 2 records (got ${inserted})`);

  // Check call sequence: schema(GET) → list(GET) → DELETE → POST
  const tail = fetchLog.slice(-3).map((c) => c.method);
  assert(tail[0] === 'GET' || tail[0] === 'DELETE',
    'wipe lists records before deleting');
  const deleteIdx = fetchLog.findIndex((c) => c.method === 'DELETE');
  const postIdx = fetchLog.findIndex((c) => c.method === 'POST');
  assert(deleteIdx >= 0 && postIdx >= 0 && deleteIdx < postIdx,
    `DELETE happens before POST (delete at ${deleteIdx}, post at ${postIdx})`);

  // Verify URL shape — searchParams encodes [] as %5B%5D, so just check the ids.
  const deleteCall = fetchLog.find((c) => c.method === 'DELETE');
  assert(deleteCall.url.includes('rec1') && deleteCall.url.includes('rec2'),
    'DELETE URL contains record ids');

  // Regression: empty fields[]= caused Airtable UNKNOWN_FIELD_NAME on real
  // API. The list call must not include a fields[] param at all.
  const listCall = fetchLog.find((c) => c.method === 'GET' && c.url.includes('Athena'));
  assert(listCall && !listCall.url.includes('fields%5B%5D=') && !listCall.url.includes('fields[]='),
    'wipeTable list URL has no empty fields[] param');

  setFetchOverride(null);
  setBucketOverride(null);
}

// ─── airtable: batching at 10 per request ───────────────────────────────────

console.log('\nairtable batching:');

{
  setBucketOverride(new TokenBucket(1000, 1000));
  let postCount = 0;
  setFetchOverride(async (_url, options) => {
    if (options?.method === 'POST') postCount += 1;
    return { ok: true, status: 200, json: async () => ({ records: [] }), text: async () => '' };
  });

  const rows = Array.from({ length: 25 }, (_, i) => ({ name: `r${i}` }));
  await insertRecords('appBase', 'T', rows, 'patFake');
  assert(postCount === 3, `25 rows → 3 POSTs (10+10+5), got ${postCount}`);

  setFetchOverride(null);
  setBucketOverride(null);
}

// ─── checkpoint roundtrip ───────────────────────────────────────────────────

console.log('\ncheckpoint:');

{
  clearCheckpoint();
  assert(loadCheckpoint() === null, 'load returns null when nothing saved');
}

{
  const state = {
    rows: [{ targetClient: 'Athena', fields: { 'Meeting Name': 'kickoff' } }],
    slackAssignments: [{ targetClient: 'Athena', channelName: 'general', date: '2026-04-29' }],
  };
  saveCheckpoint(state);
  const loaded = loadCheckpoint();
  assert(loaded !== null, 'loadCheckpoint returns saved state');
  assert(loaded.rows.length === 1, 'rows survive roundtrip');
  assert(loaded.rows[0].targetClient === 'Athena', 'nested fields survive roundtrip');
  assert(loaded.slackAssignments[0].date === '2026-04-29', 'second key survives roundtrip');
  clearCheckpoint();
  assert(loadCheckpoint() === null, 'clearCheckpoint removes the entry');
}

{
  // TTL: a checkpoint older than 7 days should be ignored.
  const stale = { savedAt: Date.now() - (8 * 24 * 60 * 60 * 1000), state: { x: 1 } };
  globalThis.localStorage.setItem('full-backfill:checkpoint-v1', JSON.stringify(stale));
  assert(loadCheckpoint() === null, 'stale checkpoint (>7d) is dropped on read');
  assert(globalThis.localStorage.getItem('full-backfill:checkpoint-v1') === null,
    'stale checkpoint is removed from storage');
}

// ─── mergeRows: buildSybillRows ─────────────────────────────────────────────

import { buildSybillRows, buildSlackRows } from './lib/mergeRows.js';

console.log('\nmergeRows buildSybillRows:');

{
  const autoAssigned = [
    { meeting: { date: '2026-04-01', title: 'Athena Kick-off', attendees: 'alice@athena.com', summary: 'Great meeting', actionItems: 'Follow up' }, client: 'Athena' },
    { meeting: { date: '2026-04-02', title: 'Bushel Review', attendees: 'bob@bushel.ag', summary: 'Good progress', actionItems: 'Ship it' }, client: 'Bushel' },
  ];
  const rows = buildSybillRows(autoAssigned, []);
  assert(rows.length === 2, `buildSybillRows produces 2 rows (got ${rows.length})`);
  assert(rows[0].targetClient === 'Athena', 'first row targets Athena');
  assert(rows[1].targetClient === 'Bushel', 'second row targets Bushel');
  assert(rows[0].fields['Type of Engagement'] === 'Meeting', 'Sybill row type is Meeting');
  assert(rows[0].fields['Meeting Name'] === 'Athena Kick-off', 'Meeting Name set correctly');
  assert(rows[0].fields['Slack Message'] === '', 'Sybill row has empty Slack Message');
}

{
  const reviewAssigned = [
    { meeting: { date: '2026-04-03', title: 'InnoVint sync', attendees: 'carol@innovint.us', summary: 'Discussed roadmap', actionItems: 'Send deck' }, client: 'InnoVint' },
  ];
  const rows = buildSybillRows([], reviewAssigned);
  assert(rows.length === 1, 'review-assigned rows included');
  assert(rows[0].targetClient === 'InnoVint', 'review-assigned client set');
}

{
  const rows = buildSybillRows([], []);
  assert(rows.length === 0, 'empty inputs return empty rows');
}

// ─── mergeRows: buildSlackRows ───────────────────────────────────────────────

console.log('\nmergeRows buildSlackRows:');

const mockBucket = (text) => ({
  channelName: 'test-channel',
  date: '2026-04-20',
  messages: [{ time: '09:00', author: 'alice', text, replies: [] }],
});

{
  const slackAssignments = [
    { targetClient: 'Athena', channelName: 'athena-gen', date: '2026-04-20', eligible: true, bucket: mockBucket('Hello!') },
    { targetClient: 'Athena', channelName: 'athena-gen', date: '2025-12-01', eligible: false, bucket: mockBucket('Old msg') },
    { targetClient: 'Bushel', channelName: 'bushel-eng', date: '2026-04-21', eligible: true, bucket: mockBucket('LGTM') },
  ];
  const summaries = {
    0: { summary: 'Alice greeted in Athena channel.' },
    // 1: ineligible — no summary entry; row is still included with blank Summary
    2: { summary: 'Bob approved changes in Bushel.' },
  };
  const rows = buildSlackRows(slackAssignments, summaries);
  // All 3 assignments have a targetClient: eligible rows get AI summary,
  // ineligible row gets a blank Summary but still produces a row.
  assert(rows.length === 3, `buildSlackRows produces 3 rows (got ${rows.length})`);
  assert(rows[0].targetClient === 'Athena', 'first Slack row targets Athena (eligible)');
  assert(rows[0].fields['Summary'] === 'Alice greeted in Athena channel.', 'eligible row has AI summary');
  assert(rows[1].targetClient === 'Athena', 'second Slack row targets Athena (ineligible)');
  assert(rows[1].fields['Summary'] === '', 'ineligible row has blank Summary');
  assert(rows[2].targetClient === 'Bushel', 'third Slack row targets Bushel');
  assert(rows[0].fields['Type of Engagement'] === 'Slack messages', 'Slack row type correct');
  assert(typeof rows[0].fields['Slack Message'] === 'string' && rows[0].fields['Slack Message'].includes('alice'), 'Slack Message contains formatted thread');
  assert(rows[0].fields['Meeting Name'] === '', 'Slack row has empty Meeting Name');
}

{
  // Error summaries are excluded
  const slackAssignments = [
    { targetClient: 'Athena', channelName: 'c', date: '2026-04-20', eligible: true, bucket: mockBucket('hi') },
  ];
  const summaries = { 0: { error: 'Claude API 429: rate limit' } };
  const rows = buildSlackRows(slackAssignments, summaries);
  assert(rows.length === 0, 'error summaries are excluded from Slack rows');
}

{
  // No targetClient — excluded
  const slackAssignments = [
    { targetClient: null, channelName: 'unmapped', date: '2026-04-20', eligible: true, bucket: mockBucket('hi') },
  ];
  const summaries = { 0: { summary: 'Test summary.' } };
  const rows = buildSlackRows(slackAssignments, summaries);
  assert(rows.length === 0, 'null targetClient excluded from Slack rows');
}

// ─── full pipeline smoke test ────────────────────────────────────────────────

console.log('\nfull pipeline smoke test:');

{
  setBucketOverride(new TokenBucket(1000, 1000));

  // Fixture data
  const sybillAuto = [
    { meeting: { date: '2026-04-01', title: 'Athena Q2', attendees: 'a@athena.com', summary: 'Q2 review', actionItems: 'Send report' }, client: 'Athena' },
    { meeting: { date: '2026-04-02', title: 'Athena follow-up', attendees: 'a@athena.com', summary: 'Follow-up items', actionItems: 'Schedule call' }, client: 'Athena' },
    { meeting: { date: '2026-04-03', title: 'Bushel Q2', attendees: 'b@bushel.ag', summary: 'Bushel progress', actionItems: 'Update roadmap' }, client: 'Bushel' },
  ];

  const slackAssignmentsFixture = [
    { targetClient: 'Athena', channelName: 'athena', date: '2026-04-20', eligible: true, bucket: mockBucket('Athena Slack msg') },
    { targetClient: 'Bushel', channelName: 'bushel', date: '2026-04-21', eligible: true, bucket: mockBucket('Bushel Slack msg') },
    { targetClient: 'Athena', channelName: 'athena', date: '2025-01-01', eligible: false, bucket: mockBucket('Old msg') },
  ];

  // Stubbed summaries (simulate RunPanel output — only eligible entries)
  const slackSummariesFixture = {
    0: { summary: 'Athena Slack summary.' },
    1: { summary: 'Bushel Slack summary.' },
    // 2: ineligible — no summary; still produces a row with blank Summary
  };

  // Build rows
  const sybillRows = buildSybillRows(sybillAuto, []);
  const slackRows = buildSlackRows(slackAssignmentsFixture, slackSummariesFixture);
  const merged = [...sybillRows, ...slackRows];

  assert(sybillRows.length === 3, `3 Sybill rows (got ${sybillRows.length})`);
  // 3 Slack rows: 2 eligible (with AI summary) + 1 ineligible (blank Summary)
  assert(slackRows.length === 3, `3 Slack rows (got ${slackRows.length})`);
  assert(merged.length === 6, `6 merged rows total (got ${merged.length})`);
  const ineligibleRow = slackRows.find((r) => r.fields['Summary'] === '');
  assert(ineligibleRow !== undefined, 'ineligible Slack bucket produces row with blank Summary');

  // Group by client (mirrors AirtableWritePanel logic)
  const byClient = new Map();
  for (const r of merged) {
    if (!r.targetClient) continue;
    if (!byClient.has(r.targetClient)) byClient.set(r.targetClient, []);
    byClient.get(r.targetClient).push(r);
  }
  // Athena: 2 Sybill + 1 eligible Slack + 1 ineligible Slack = 4
  assert(byClient.get('Athena').length === 4, `Athena gets 4 rows (2 Sybill + 2 Slack), got ${byClient.get('Athena').length}`);
  assert(byClient.get('Bushel').length === 2, `Bushel gets 2 rows (1 Sybill + 1 Slack), got ${byClient.get('Bushel').length}`);

  // Mock Airtable write for each client
  const insertLog = {};
  setFetchOverride(async (url, options) => {
    const method = options?.method ?? 'GET';
    const u = url.toString();
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ records: [] }), text: async () => '' };
    }
    if (method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({ records: [] }), text: async () => '' };
    }
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      const table = decodeURIComponent(u.split('/').pop().split('?')[0]);
      insertLog[table] = (insertLog[table] ?? 0) + body.records.length;
      return { ok: true, status: 200, json: async () => ({ records: body.records.map((_, i) => ({ id: `rec${i}` })) }), text: async () => '' };
    }
    return { ok: false, status: 500, json: async () => ({}), text: async () => 'unhandled' };
  });

  for (const [client, clientRows] of byClient) {
    await wipeTable('appTest', client, 'patFake');
    await insertRecords('appTest', client, clientRows.map((r) => r.fields), 'patFake');
  }

  assert(insertLog['Athena'] === 4, `Athena table received 4 inserts (got ${insertLog['Athena']})`);
  assert(insertLog['Bushel'] === 2, `Bushel table received 2 inserts (got ${insertLog['Bushel']})`);

  setFetchOverride(null);
  setBucketOverride(null);
}

// ─── airtable createTable ───────────────────────────────────────────────────

console.log('\nairtable createTable:');

{
  setBucketOverride(new TokenBucket(1000, 1000));
  let postUrl = null;
  let postBody = null;
  setFetchOverride(async (url, options) => {
    if (options?.method === 'POST') {
      postUrl = url.toString();
      postBody = JSON.parse(options.body);
      return {
        ok: true, status: 200,
        json: async () => ({ id: 'tblNew', name: postBody.name, fields: postBody.fields }),
        text: async () => '',
      };
    }
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
  });

  const result = await createTable('appBase', 'NewClient', 'patFake');
  assert(postUrl.endsWith('/meta/bases/appBase/tables'),
    `POST hits /meta/bases/{baseId}/tables (got ${postUrl})`);
  assert(postBody.name === 'NewClient', 'request body has table name');
  const fieldNames = postBody.fields.map((f) => f.name);
  for (const col of REQUIRED_COLUMNS) {
    assert(fieldNames.includes(col), `'${col}' field present in create body`);
  }
  assert(fieldNames.includes('Source'), "'Source' field added on top of v2 schema");
  assert(postBody.fields[0].name === 'Meeting Name',
    'Meeting Name is the first (primary) field');
  const dateField = postBody.fields.find((f) => f.name === 'Engagement Date');
  assert(dateField?.type === 'date', "'Engagement Date' uses date field type");
  assert(dateField?.options?.dateFormat?.name === 'iso',
    "'Engagement Date' configured with ISO date format");
  assert(result.id === 'tblNew', 'createTable returns the parsed table object');
  assert(CREATE_TABLE_FIELDS.length === 8, '8 fields total (v2 schema + Source)');

  setFetchOverride(null);
  setBucketOverride(null);
}

// ─── sybillFingerprint ──────────────────────────────────────────────────────

import { computeSybillFingerprint } from './lib/sybillFingerprint.js';

console.log('\nsybillFingerprint:');

{
  const meetings = [
    { date: '2026-04-01', title: 'Athena Q2' },
    { date: '2026-04-02', title: 'Bushel sync' },
    { date: '2026-04-03', title: 'InnoVint roadmap' },
  ];
  const [a, b] = await Promise.all([
    computeSybillFingerprint(meetings),
    computeSybillFingerprint(meetings),
  ]);
  assert(a === b, 'same meetings → same fingerprint (stability)');
  assert(typeof a === 'string' && a.length === 40, `fingerprint is 40-char hex (got "${a}")`);
  assert(/^[0-9a-f]+$/.test(a), 'fingerprint is lowercase hex');

  const reordered = [meetings[2], meetings[0], meetings[1]];
  const r = await computeSybillFingerprint(reordered);
  assert(a === r, 'meeting order does not affect fingerprint');

  const different = [...meetings, { date: '2026-04-04', title: 'New mtg' }];
  const d = await computeSybillFingerprint(different);
  assert(a !== d, 'different meetings → different fingerprint');
}

// ─── applyClassificationOverrides ───────────────────────────────────────────

import { applyClassificationOverrides } from './lib/classificationOverrides.js';

console.log('\napplyClassificationOverrides:');

{
  const autoAssigned = [
    { meeting: { id: 1 }, client: 'HubSpot' },
    { meeting: { id: 2 }, client: 'HubSpot' },
    { meeting: { id: 3 }, client: 'Athena' },
  ];
  const reviewAssigned = [
    { meeting: { id: 4 }, client: 'Bushel' },
  ];

  // No overrides → keep all
  let r = applyClassificationOverrides(autoAssigned, reviewAssigned, {});
  assert(r.length === 4, 'no overrides → all 4 kept');

  // KEEP explicitly → no change
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, { HubSpot: { action: 'KEEP' } });
  assert(r.length === 4 && r.filter((a) => a.client === 'HubSpot').length === 2,
    'KEEP retains the original group');

  // SKIP → drops the group
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, { HubSpot: { action: 'SKIP' } });
  assert(r.length === 2, 'SKIP drops 2 HubSpot meetings → 2 remain');
  assert(!r.some((a) => a.client === 'HubSpot'), 'no HubSpot remains after SKIP');

  // SWITCH → consolidates into existing client
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, {
    HubSpot: { action: 'SWITCH', target: 'Athena' },
  });
  assert(r.filter((a) => a.client === 'Athena').length === 3,
    'SWITCH HubSpot → Athena: 1 + 2 = 3 Athena rows');
  assert(!r.some((a) => a.client === 'HubSpot'), 'HubSpot removed after SWITCH');

  // RENAME → relabels group to a new typed name
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, {
    HubSpot: { action: 'RENAME', target: 'HubSpot Inc' },
  });
  assert(r.filter((a) => a.client === 'HubSpot Inc').length === 2,
    'RENAME relabels 2 HubSpot → HubSpot Inc');
  assert(!r.some((a) => a.client === 'HubSpot'), 'original name gone after RENAME');

  // RENAME with empty target → falls back to original (don't silently lose meetings)
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, {
    HubSpot: { action: 'RENAME', target: '' },
  });
  assert(r.filter((a) => a.client === 'HubSpot').length === 2,
    'RENAME with empty target falls back to original client name');

  // Multiple overrides at once
  r = applyClassificationOverrides(autoAssigned, reviewAssigned, {
    HubSpot: { action: 'SKIP' },
    Bushel: { action: 'RENAME', target: 'Bushel Co' },
  });
  assert(r.length === 2, 'SKIP + RENAME applied together → 2 rows');
  assert(r.find((a) => a.client === 'Bushel Co'), 'Bushel renamed to Bushel Co');
  assert(r.find((a) => a.client === 'Athena'), 'untouched group preserved');
}

// ─── summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
