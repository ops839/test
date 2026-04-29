// Smoke tests for Phase 2: cutoff filtering for both Sybill and Slack sources.
// Run with: node full-backfill/test-pipeline.mjs

import { SYBILL_CUTOFF_DAYS, SLACK_CUTOFF_DAYS, cutoffDateStr } from './lib/cutoffs.js';

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

// ─── summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
