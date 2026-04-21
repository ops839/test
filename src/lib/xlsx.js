import * as XLSX from 'xlsx';

const COLUMNS = ['Meeting Date', 'Meeting Name', 'Attendees', 'Summary', 'Action Items'];
const SHEET_NAME_MAX = 31;

function sheetNameFor(client) {
  const cleaned = client.replace(/[\\/*?:[\]]/g, '');
  return cleaned.slice(0, SHEET_NAME_MAX) || 'Sheet';
}

function uniqueSheetName(name, used) {
  let candidate = name;
  let n = 1;
  while (used.has(candidate)) {
    const suffix = ` (${++n})`;
    candidate = name.slice(0, SHEET_NAME_MAX - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

/**
 * @param {Record<string, Meeting[]>} byClient
 * @param {string} filename
 */
export function exportXlsx(byClient, filename) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  const clients = Object.keys(byClient).sort((a, b) => a.localeCompare(b));
  if (clients.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS]);
    XLSX.utils.book_append_sheet(wb, ws, 'Empty');
  }

  for (const client of clients) {
    const rows = [...byClient[client]].sort((a, b) => {
      if (a.date === b.date) return 0;
      return a.date < b.date ? 1 : -1;
    });
    const aoa = [COLUMNS];
    for (const m of rows) {
      aoa.push([
        m.date || '',
        m.title || '',
        m.attendees || '',
        m.summary || '',
        m.actionItems || '',
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 },
      { wch: 42 },
      { wch: 36 },
      { wch: 60 },
      { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheetNameFor(client), usedNames));
  }

  XLSX.writeFile(wb, filename);
}
