// Smoke test for the XLSX builder using a mock engagement-log workbook.
import * as XLSX from 'xlsx';
import { appendAssignments, readSheetNames } from './lib/xlsxBuilder.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

const HEADER = [
  'Engagement Date',
  'Type of Engagement',
  'Meeting Name',
  'Attendees',
  'Summary',
  'Action Items',
  'Slack Message',
];

function makeMockWorkbook() {
  const wb = XLSX.utils.book_new();
  // Existing Jencap sheet with one prior meeting on 2024-04-15
  const jencap = XLSX.utils.aoa_to_sheet([
    HEADER,
    ['2024-04-15', 'Meeting', 'Q2 Kickoff', 'kareem,jane', 'Discussed Q2 plan.', '', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, jencap, 'Jencap');
  return wb;
}

const wb = makeMockWorkbook();

const assignments = [
  {
    sheetName: 'Jencap',
    channelName: 'bm-x-jencap-2024',
    date: '2024-04-28',
    summary: 'Renewal numbers confirmed by Jane.',
    threadText: '[16:00] <Kareem T>: Hey...\n└ [16:06] <Jane Client>: Confirmed.',
  },
  {
    sheetName: null,
    channelName: 'random-internal',
    date: '2024-04-30',
    summary: 'Internal note logged.',
    threadText: '[00:00] <Kareem T>: Internal note',
  },
  {
    sheetName: 'New Client Sheet',
    channelName: 'new-client-channel',
    date: '2024-04-29',
    summary: 'New client kickoff.',
    threadText: '[09:00] <Kareem T>: Welcome',
  },
];

appendAssignments(wb, assignments);

assert(wb.SheetNames.includes('Jencap'), 'Jencap sheet present');
assert(wb.SheetNames.includes('Unmatched Slack'), 'Unmatched Slack sheet created');

const jencapRows = XLSX.utils.sheet_to_json(wb.Sheets['Jencap'], { header: 1, blankrows: false });
console.log('Jencap rows:', JSON.stringify(jencapRows, null, 2));
assert(jencapRows.length === 3, `expected 3 rows (header + 2), got ${jencapRows.length}`);
// Sorted descending: header, then 2024-04-28, then 2024-04-15
assert(jencapRows[0][0] === 'Engagement Date', 'header preserved');
assert(jencapRows[1][0] === '2024-04-28', `newest first: ${jencapRows[1][0]}`);
assert(jencapRows[1][1] === 'Slack messages', `type column: ${jencapRows[1][1]}`);
assert(jencapRows[1][4] === 'Renewal numbers confirmed by Jane.', 'summary written');
assert(jencapRows[2][0] === '2024-04-15', `older row preserved: ${jencapRows[2][0]}`);

const unmatchedRows = XLSX.utils.sheet_to_json(wb.Sheets['Unmatched Slack'], { header: 1, blankrows: false });
assert(unmatchedRows.length === 2, `unmatched: header + 1 row, got ${unmatchedRows.length}`);
assert(unmatchedRows[1][2] === '#random-internal', `channel ref in column C: ${unmatchedRows[1][2]}`);

// New sheet was created from explicit sheetName not in original workbook
assert(wb.SheetNames.includes('New Client Sheet'), 'new sheet created from explicit sheetName');
const newSheetRows = XLSX.utils.sheet_to_json(wb.Sheets['New Client Sheet'], { header: 1, blankrows: false });
assert(newSheetRows[0][0] === 'Engagement Date', 'new sheet has header');
assert(newSheetRows[1][4] === 'New client kickoff.', 'new sheet row written');

// readSheetNames returns sheet names from a Blob/file-like input
const wbBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const fileLike = { arrayBuffer: async () => wbBuf };
const sheetNames = await readSheetNames(fileLike);
assert(sheetNames.includes('Jencap'), `readSheetNames includes Jencap: ${sheetNames}`);
assert(sheetNames.includes('New Client Sheet'), 'readSheetNames includes new sheet');
assert(sheetNames.includes('Unmatched Slack'), 'readSheetNames includes Unmatched Slack');

console.log('\nAll xlsx smoke tests passed.');
