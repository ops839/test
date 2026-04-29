// Smoke test for the slack-backfill pipeline using a mock slackdump ZIP.
// Run with: node slack-backfill/test-mock.mjs
//
// Validates: ZIP unpacking, user-mention resolution, day bucketing,
// thread reply attachment, alias matching, and the no-users.json case.

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

// Embedded user_profile blocks, no users.json. This matches the
// real slackdump v3+ output shape.
const KAREEM_PROFILE = {
  display_name: 'Kareem T',
  real_name: 'Kareem Talaat',
  first_name: 'Kareem',
  name: 'kareem',
};
const JANE_PROFILE = {
  display_name: '',
  real_name: 'Jane Client',
  first_name: 'Jane',
  name: 'jane',
};

const PARENT_MSG = {
  type: 'message',
  user: 'U001',
  user_profile: KAREEM_PROFILE,
  text: 'Hey <@U002>, can you confirm the renewal numbers for Q2?',
  ts: '1714329600.000100',
  thread_ts: '1714329600.000100',
  reply_count: 1,
};

const JOIN_NOISE = {
  type: 'message',
  subtype: 'channel_join',
  user: 'U002',
  text: 'has joined',
  ts: '1714329700.000100',
};

const REPLY_MSG = {
  type: 'message',
  user: 'U002',
  user_profile: JANE_PROFILE,
  text: 'Confirmed, sending the file shortly.',
  ts: '1714330000.000200',
  thread_ts: '1714329600.000100',
};

const RANDOM_MSG = {
  type: 'message',
  user: 'U001',
  user_profile: KAREEM_PROFILE,
  text: 'Internal note',
  ts: '1714464000.000100',
};

async function buildMockZip() {
  const zip = new JSZip();

  // No users.json. Profiles are embedded per message.
  zip.file('channels.json', JSON.stringify([{ id: 'C100', name: 'bm-x-jencap-2024' }]));

  // ts 1714329600 = 2024-04-28 00:00:00 UTC
  zip.file('bm-x-jencap-2024/2024-04-28.json', JSON.stringify([PARENT_MSG, JOIN_NOISE]));
  zip.file('bm-x-jencap-2024/threads/1714329600.000100.json', JSON.stringify([REPLY_MSG]));
  zip.file('random-internal/2024-04-30.json', JSON.stringify([RANDOM_MSG]));

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
  assert(parent.author === 'Kareem T', `author resolved (no users.json): ${parent.author}`);
  assert(parent.text.includes('@Jane Client'), `mention resolved (no users.json): ${parent.text}`);
  assert(parent.replies.length === 1, `1 reply, got ${parent.replies.length}`);
  assert(parent.replies[0].author === 'Jane Client', `reply author: ${parent.replies[0].author}`);

  // Profile harvested into shared userMap
  assert(result.userMap.get('U001') === 'Kareem T', 'U001 harvested into userMap');
  assert(result.userMap.get('U002') === 'Jane Client', 'U002 harvested into userMap');

  // Alias match
  const matched = matchClient(jencap.name);
  assert(matched === 'Jencap', `alias matched: ${matched}`);

  const random = result.channels.find((c) => c.name === 'random-internal');
  assert(matchClient(random.name) === null, 'random-internal unmatched');

  const block = formatThreadBlock(bucket);
  assert(block.includes('Kareem T'), 'thread block includes parent');
  assert(block.includes('└'), 'thread block has reply marker');

  const prompt = buildPrompt(bucket);
  assert(prompt.includes('#bm-x-jencap-2024'), 'prompt has channel');
  assert(prompt.includes('2024-04-28'), 'prompt has date');

  assert(matchClient('client-bsr-2024') === 'Blu Sky', 'bsr maps to Blu Sky');
  assert(matchClient('tel-team') === 'The Estate Lawyers', 'tel maps to Estate Lawyers');
  assert(
    matchClient('estate-lawyers-misc') === 'The Estate Lawyers',
    'estate lawyers full match',
  );
  assert(matchClient('telly-channel') === null, 'tel only matches whole word');

  // ─── Folder-mode parser, no users.json ────────────────────────────
  const channelsJson = JSON.stringify([{ id: 'C100', name: 'bm-x-jencap-2024' }]);
  const dayJson = JSON.stringify([PARENT_MSG, JOIN_NOISE]);
  const threadJson = JSON.stringify([REPLY_MSG]);
  const randomJson = JSON.stringify([RANDOM_MSG]);

  const folderFiles = [
    new MockFile('channels.json', 'slackdump_export/channels.json', channelsJson),
    new MockFile('2024-04-28.json', 'slackdump_export/bm-x-jencap-2024/2024-04-28.json', dayJson),
    new MockFile(
      '1714329600.000100.json',
      'slackdump_export/bm-x-jencap-2024/threads/1714329600.000100.json',
      threadJson,
    ),
    new MockFile('2024-04-30.json', 'slackdump_export/random-internal/2024-04-30.json', randomJson),
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

  // ─── Unknown user fallback: a message whose user has no profile anywhere
  const lonelyZip = new JSZip();
  lonelyZip.file(
    'lonely/2024-04-28.json',
    JSON.stringify([
      { type: 'message', user: 'U999', text: 'no profile here', ts: '1714329600.000100' },
    ]),
  );
  const lonelyResult = await parseSlackdumpZip(await lonelyZip.generateAsync({ type: 'nodebuffer' }));
  assert(
    lonelyResult.channels[0].dayBuckets[0].messages[0].author === 'U999',
    'unknown user falls back to raw userId',
  );

  // ─── Empty source rejection: no channel folders ────────────────────
  const emptyZip = new JSZip();
  emptyZip.file('readme.txt', 'nothing slack-related');
  let threw = false;
  try {
    await parseSlackdumpZip(await emptyZip.generateAsync({ type: 'nodebuffer' }));
  } catch (e) {
    threw = /No slackdump channel data found/.test(e.message);
  }
  assert(threw, 'empty source throws clear error');

  console.log('\nAll smoke tests passed.');
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
