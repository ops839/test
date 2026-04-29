import * as XLSX from 'xlsx';

const UNMATCHED_SHEET = 'Unmatched Slack';

// Lowercase a sheet name for fuzzy matching to client names.
function normalizeSheetName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findSheetForClient(workbook, clientName) {
  const target = normalizeSheetName(clientName);
  for (const sheetName of workbook.SheetNames) {
    if (normalizeSheetName(sheetName) === target) return sheetName;
  }
  // Fallback: substring match
  for (const sheetName of workbook.SheetNames) {
    const norm = normalizeSheetName(sheetName);
    if (norm.includes(target) || target.includes(norm)) return sheetName;
  }
  return null;
}

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

// `assignments` is a list of:
//   { clientName | null, channelName, date, summary, threadText }
// `clientName` null means unmatched -> Unmatched Slack sheet.
export function appendAssignments(workbook, assignments) {
  const groups = new Map(); // sheetName -> rows[]

  for (const a of assignments) {
    let sheetName;
    let channelForUnmatched = '';

    if (a.clientName) {
      sheetName = findSheetForClient(workbook, a.clientName);
      if (!sheetName) {
        // Create a new sheet for this client
        sheetName = a.clientName.slice(0, 31);
        const ws = aoaToSheet([
          ['Engagement Date', 'Type of Engagement', 'Meeting Name', 'Attendees', 'Summary', 'Action Items', 'Slack Message'],
        ]);
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      }
    } else {
      sheetName = UNMATCHED_SHEET;
      channelForUnmatched = `#${a.channelName}`;
      if (!workbook.SheetNames.includes(sheetName)) {
        const ws = aoaToSheet([
          ['Engagement Date', 'Type of Engagement', 'Meeting Name', 'Attendees', 'Summary', 'Action Items', 'Slack Message'],
        ]);
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
