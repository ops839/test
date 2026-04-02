/**
 * Google Sheets API integration using Google Identity Services + Sheets API v4.
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

const TOKEN_KEY = 'sybill-google-token';
const API_DELAY_MS = 1000;

let tokenClient = null;
let gapiInited = false;
let gisInited = false;
let onAuthChange = null;
let lastApiCall = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastApiCall;
  if (elapsed < API_DELAY_MS) {
    await sleep(API_DELAY_MS - elapsed);
  }
  lastApiCall = Date.now();
}

async function withRetry(fn) {
  const delays = [2000, 4000];
  await throttle();
  try {
    return await fn();
  } catch (err) {
    for (let i = 0; i < delays.length; i++) {
      await sleep(delays[i]);
      await throttle();
      try {
        return await fn();
      } catch (retryErr) {
        if (i === delays.length - 1) throw retryErr;
      }
    }
  }
}

export function setAuthChangeCallback(cb) {
  onAuthChange = cb;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function initGapi(apiKey) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => {
    window.gapi.load('client', { callback: resolve, onerror: reject });
  });
  await window.gapi.client.init({
    apiKey,
    discoveryDocs: [DISCOVERY_DOC],
  });
  gapiInited = true;

  // Restore saved token if available
  try {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      const token = JSON.parse(saved);
      // Check if token hasn't expired (expires_in is seconds from issue time)
      if (token.expiry && Date.now() < token.expiry) {
        window.gapi.client.setToken(token);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    }
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export async function initGis(clientId) {
  await loadScript('https://accounts.google.com/gsi/client');
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.error('Auth error', resp);
        return;
      }
      // Persist token with expiry timestamp
      const token = window.gapi.client.getToken();
      if (token) {
        token.expiry = Date.now() + (token.expires_in || 3600) * 1000;
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
      }
      gisInited = true;
      onAuthChange?.(true);
    },
  });
}

export function signIn() {
  if (!tokenClient) throw new Error('GIS not initialized');
  if (window.gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

export function signOut() {
  const token = window.gapi.client.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
    sessionStorage.removeItem(TOKEN_KEY);
    onAuthChange?.(false);
  }
}

export function isSignedIn() {
  return gapiInited && window.gapi?.client?.getToken() != null;
}

export async function listSpreadsheets() {
  // Use Drive API to list sheets
  await loadScript('https://apis.google.com/js/api.js');
  // Ensure Drive discovery is loaded
  try {
    await window.gapi.client.load('drive', 'v3');
  } catch {
    // might already be loaded
  }
  const resp = await window.gapi.client.drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });
  return resp.result.files || [];
}

export async function createSpreadsheet(title) {
  const resp = await window.gapi.client.sheets.spreadsheets.create({
    properties: { title },
  });
  return { id: resp.result.spreadsheetId, name: resp.result.properties.title };
}

async function getSheetNames(spreadsheetId) {
  const resp = await withRetry(() =>
    window.gapi.client.sheets.spreadsheets.get({ spreadsheetId })
  );
  return resp.result.sheets.map((s) => s.properties.title);
}

async function addSheet(spreadsheetId, sheetTitle) {
  await withRetry(() =>
    window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    })
  );
}

async function getNextEmptyRow(spreadsheetId, sheetTitle) {
  const range = `'${sheetTitle}'!A:A`;
  const resp = await withRetry(() =>
    window.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range })
  );
  const values = resp.result.values || [];
  return values.length + 1;
}

async function appendRow(spreadsheetId, sheetTitle, row) {
  const nextRow = await getNextEmptyRow(spreadsheetId, sheetTitle);
  const range = `'${sheetTitle}'!A${nextRow}`;
  await withRetry(() =>
    window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values: [row] },
    })
  );
}

const HEADERS = ['Meeting Date', 'Meeting Name', 'Attendees', 'Summary', 'Action Items'];

// Cache of known sheet names per spreadsheet to avoid redundant API calls
const knownSheets = new Map();

export function resetSheetCache() {
  knownSheets.clear();
}

async function ensureSheetExists(spreadsheetId, sheetTitle) {
  if (!knownSheets.has(spreadsheetId)) {
    const names = await getSheetNames(spreadsheetId);
    knownSheets.set(spreadsheetId, new Set(names));
  }

  const cached = knownSheets.get(spreadsheetId);
  if (!cached.has(sheetTitle)) {
    await addSheet(spreadsheetId, sheetTitle);
    await appendRow(spreadsheetId, sheetTitle, HEADERS);
    cached.add(sheetTitle);
  }
}

export async function uploadMeeting(spreadsheetId, clientName, meeting) {
  if (!clientName) throw new Error('No client name');

  // Sanitize sheet title (max 100 chars, no special chars that Sheets disallows)
  const sheetTitle = clientName.replace(/[\\/*?[\]:]/g, '').substring(0, 100);

  await ensureSheetExists(spreadsheetId, sheetTitle);

  const row = [
    meeting.date,
    meeting.title,
    meeting.attendees,
    meeting.summary,
    meeting.actionItems,
  ];

  await appendRow(spreadsheetId, sheetTitle, row);
}
