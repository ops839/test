// Smoke test for the slack-backfill pipeline using a mock slackdump ZIP.
// Run with: node slack-backfill/test-mock.mjs
//
// This validates: ZIP unpacking, user-mention resolution, day bucketing,
// thread reply attachment, alias matching.

import JSZip from 'jszip';
import {
  parseSlackdumpZip,
  parseSlackdumpFolder,
  formatThreadBlock,
  buildPrompt,
} from './lib/slackParser.js';
import { matchClient } from './lib/aliasMap.js';

// Mock browser File-with-webkitRelativePath for the folder-mode test.
class MockFile {
  constructor(name, webkitRelativePath, content) {
    this.name = name;
    this.webkitRelativePath = webkitRelativePath;
    this._content = content;
  }
  async text() {
    return this._content;
  }
}

async function buildMockZip() {
  const zip = new JSZip();

  zip.file(
    'users.json',
    JSON.stringify([
      { id: 'U001', name: 'kareem', profile: { display_name: 'Kareem T', real_name: 'Kareem Talaat' } },
      { id: 'U002', name: 'jane', profile: { display_name: '', real_name: 'Jane Client' } },
    ]),
  );

  zip.file(
    'channels.json',
    JSON.stringify([{ id: 'C100', name: 'bm-x-jencap-2024' }]),
  );

  // Day 1: parent message + reply
  // ts 1714329600 = 2024-04-28 00:00:00 UTC
  zip.file(
    'bm-x-jencap-2024/2024-04-28.json',
    JSON.stringify([
      {
        type: 'message',
        user: 'U001',
        text: 'Hey <@U002>, can you confirm the renewal numbers for Q2?',
        ts: '1714329600.000100',
        thread_ts: '1714329600.000100',
        reply_count: 1,
      },
      {
        type: 'message',
        subtype: 'channel_join',
        user: 'U002',
        text: 'has joined',
        ts: '1714329700.000100',
      },
    ]),
  );

  zip.file(
    'bm-x-jencap-2024/threads/1714329600.000100.json',
    JSON.stringify([
      {
        type: 'message',
        user: 'U002',
        text: 'Confirmed — sending the file shortly.',
        ts: '1714330000.000200',
        thread_ts: '1714329600.000100',
      },
    ]),
  );

  // Day 2: solo message, different channel
  zip.file(
    'random-internal/2024-04-30.json',
    JSON.stringify([
      {
        type: 'message',
        user: 'U001',
        text: 'Internal note',
        ts: '1714464000.000100',
      },
    ]),
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

async function main() {
  const buf = await buildMockZip();
  const result = await parseSlackdumpZip(buf);

  assert(result.channels.length === 2, `expected 2 channels, got ${result.channels.length}`);

  const jencap = result.channels.find((c) => c.name.includes('jencap'));
  assert(jencap, 'jencap channel parsed');
  assert(jencap.dayBuckets.length === 1, `expected 1 day-bucket, got ${jencap.dayBuckets.length}`);

  const bucket = jencap.dayBuckets[0];
  assert(bucket.date === '2024-04-28', `date ${bucket.date}`);
  assert(bucket.messages.length === 1, `1 top-level msg, got ${bucket.messages.length}`);

  const parent = bucket.messages[0];
  assert(parent.author === 'Kareem T', `author resolved: ${parent.author}`);
  assert(parent.text.includes('@Jane Client'), `mention resolved: ${parent.text}`);
  assert(parent.replies.length === 1, `1 reply, got ${parent.replies.length}`);
  assert(parent.replies[0].author === 'Jane Client', `reply author: ${parent.replies[0].author}`);

  // Alias match
  const matched = matchClient(jencap.name);
  assert(matched === 'Jencap', `alias matched: ${matched}`);

  // Unmatched channel
  const random = result.channels.find((c) => c.name === 'random-internal');
  assert(matchClient(random.name) === null, 'random-internal unmatched');

  // Format output
  const block = formatThreadBlock(bucket);
  assert(block.includes('Kareem T'), 'thread block includes parent');
  assert(block.includes('└'), 'thread block has reply marker');

  // Prompt
  const prompt = buildPrompt(bucket);
  assert(prompt.includes('#bm-x-jencap-2024'), 'prompt has channel');
  assert(prompt.includes('2024-04-28'), 'prompt has date');

  // BSR alias
  assert(matchClient('client-bsr-2024') === 'Blu Sky', 'bsr -> Blu Sky');
  assert(matchClient('tel-team') === 'The Estate Lawyers', 'tel -> Estate Lawyers');
  assert(
    matchClient('estate-lawyers-misc') === 'The Estate Lawyers',
    'estate lawyers full match',
  );
  // Whole-word boundary: "telly" should NOT match "tel"
  assert(matchClient('telly-channel') === null, 'tel only matches whole word');

  // ─── Folder-mode parser: same fixture, but as MockFile list ────────
  const usersJson = JSON.stringify([
    { id: 'U001', name: 'kareem', profile: { display_name: 'Kareem T', real_name: 'Kareem Talaat' } },
    { id: 'U002', name: 'jane', profile: { display_name: '', real_name: 'Jane Client' } },
  ]);
  const channelsJson = JSON.stringify([{ id: 'C100', name: 'bm-x-jencap-2024' }]);
  const dayJson = JSON.stringify([
    {
      type: 'message',
      user: 'U001',
      text: 'Hey <@U002>, can you confirm the renewal numbers for Q2?',
      ts: '1714329600.000100',
      thread_ts: '1714329600.000100',
      reply_count: 1,
    },
    {
      type: 'message',
      subtype: 'channel_join',
      user: 'U002',
      text: 'has joined',
      ts: '1714329700.000100',
    },
  ]);
  const threadJson = JSON.stringify([
    {
      type: 'message',
      user: 'U002',
      text: 'Confirmed — sending the file shortly.',
      ts: '1714330000.000200',
      thread_ts: '1714329600.000100',
    },
  ]);
  const randomJson = JSON.stringify([
    {
      type: 'message',
      user: 'U001',
      text: 'Internal note',
      ts: '1714464000.000100',
    },
  ]);

  // Browser provides FileList where each File has webkitRelativePath
  // anchored to the user-selected folder (e.g. "slackdump_export/...").
  const folderFiles = [
    new MockFile('users.json', 'slackdump_export/users.json', usersJson),
    new MockFile('channels.json', 'slackdump_export/channels.json', channelsJson),
    new MockFile('2024-04-28.json', 'slackdump_export/bm-x-jencap-2024/2024-04-28.json', dayJson),
    new MockFile(
      '1714329600.000100.json',
      'slackdump_export/bm-x-jencap-2024/threads/1714329600.000100.json',
      threadJson,
    ),
    new MockFile('2024-04-30.json', 'slackdump_export/random-internal/2024-04-30.json', randomJson),
    // Decoy: a non-JSON file should be skipped silently
    new MockFile('readme.txt', 'slackdump_export/readme.txt', 'ignore me'),
  ];

  const folderResult = await parseSlackdumpFolder(folderFiles);
  assert(
    folderResult.channels.length === 2,
    `folder mode: 2 channels, got ${folderResult.channels.length}`,
  );
  const folderJencap = folderResult.channels.find((c) => c.name.includes('jencap'));
  assert(folderJencap, 'folder mode: jencap parsed');
  assert(
    folderJencap.dayBuckets[0].messages[0].replies.length === 1,
    'folder mode: thread reply attached',
  );
  assert(
    folderJencap.dayBuckets[0].messages[0].author === 'Kareem T',
    'folder mode: author resolved',
  );
  assert(
    folderJencap.dayBuckets[0].messages[0].text.includes('@Jane Client'),
    'folder mode: mention resolved',
  );
  assert(
    folderResult.totalMessages === result.totalMessages,
    `folder mode: same totalMessages (${folderResult.totalMessages} vs ${result.totalMessages})`,
  );

  console.log('\nAll smoke tests passed.');
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
