import * as XLSX from 'xlsx';

const UNMATCHED_SHEET = 'Unmatched Slack';

const HEADER_ROW = [
  'Engagement Date',
  'Type of Engagement',
  'Meeting Name',
  'Attendees',
  'Summary',
  'Action Items',
  'Slack Message',
];

// Read a sheet's rows as arrays-of-arrays.
function sheetToAOA(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
}

function aoaToSheet(aoa) {
  return XLSX.utils.aoa_to_sheet(aoa);
}

// Sort by column A (index 0) descending. Keep header row at top if it looks
// like one (first cell is non-date text like "Engagement Date").
function sortRowsByDateDesc(aoa) {
  if (aoa.length === 0) return aoa;
  const headerLooks = (row) => {
    const cell = String(row[0] || '').toLowerCase();
    return cell.includes('date') || cell.includes('engagement');
  };
  let header = null;
  let body = aoa;
  if (headerLooks(aoa[0])) {
    header = aoa[0];
    body = aoa.slice(1);
  }
  body.sort((a, b) => {
    const sa = String(a[0] || '');
    const sb = String(b[0] || '');
    return sb.localeCompare(sa);
  });
  return header ? [header, ...body] : body;
}

// Build a row matching v2 schema:
// A: date  B: "Slack messages"  C: meetingName (blank or channel for unmatched)
// D: attendees (blank)  E: summary  F: action items (blank)  G: thread text
function buildRow({ date, summary, threadText, channelForUnmatched }) {
  return [
    date,
    'Slack messages',
    channelForUnmatched || '',
    '',
    summary || '',
    '',
    threadText || '',
  ];
}

export async function loadWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array' });
}

// Read just the sheet names from an XLSX file. Used to populate the
// channel-mapping dropdown without holding the full workbook in memory.
export async function readSheetNames(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
  return [...wb.SheetNames];
}

// `assignments` is a list of:
//   { sheetName | null, channelName, date, summary, threadText }
// `sheetName` null routes the row to the Unmatched Slack sheet, with the
// channel name written into column C. The user picks `sheetName` explicitly
// in the channel matches step, so we don't fuzzy-match anything here.
export function appendAssignments(workbook, assignments) {
  const groups = new Map(); // sheetName -> rows[]

  for (const a of assignments) {
    let sheetName;
    let channelForUnmatched = '';

    if (a.sheetName) {
      sheetName = a.sheetName.slice(0, 31); // Excel sheet-name limit
      if (!workbook.SheetNames.includes(sheetName)) {
        const ws = aoaToSheet([HEADER_ROW]);
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      }
    } else {
      sheetName = UNMATCHED_SHEET;
      channelForUnmatched = `#${a.channelName}`;
      if (!workbook.SheetNames.includes(sheetName)) {
        const ws = aoaToSheet([HEADER_ROW]);
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      }
    }

    const row = buildRow({
      date: a.date,
      summary: a.summary,
      threadText: a.threadText,
      channelForUnmatched,
    });
    if (!groups.has(sheetName)) groups.set(sheetName, []);
    groups.get(sheetName).push(row);
  }

  for (const [sheetName, newRows] of groups.entries()) {
    const ws = workbook.Sheets[sheetName];
    const existing = sheetToAOA(ws);
    const combined = [...existing, ...newRows];
    const sorted = sortRowsByDateDesc(combined);
    workbook.Sheets[sheetName] = aoaToSheet(sorted);
  }

  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename);
}
