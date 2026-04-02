import { useState, useEffect } from 'react';
import {
  initGapi,
  initGis,
  signIn,
  signOut,
  isSignedIn,
  setAuthChangeCallback,
  listSpreadsheets,
  createSpreadsheet,
} from '../lib/sheets';

export default function GoogleAuth({
  apiKey,
  clientId,
  onAuthReady,
  onSpreadsheetSelect,
  disabled,
}) {
  const [authed, setAuthed] = useState(false);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState('');
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setAuthChangeCallback((signedIn) => {
      setAuthed(signedIn);
      onAuthReady(signedIn);
      if (signedIn) loadSheets();
    });

    // Auto-init on mount if credentials are available
    if (apiKey && clientId) {
      initOnMount(apiKey, clientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initOnMount = async (key, cid) => {
    setIniting(true);
    setError(null);
    try {
      await initGapi(key);
      await initGis(cid);
      if (isSignedIn()) {
        setAuthed(true);
        onAuthReady(true);
        await loadSheets();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIniting(false);
    }
  };

  const init = async () => {
    if (!apiKey || !clientId) {
      setError('Please enter API Key and Client ID in settings');
      return;
    }
    await initOnMount(apiKey, clientId);
  };

  const loadSheets = async () => {
    setLoadingSheets(true);
    try {
      const files = await listSpreadsheets();
      setSheets(files);
    } catch (e) {
      console.warn('Failed to list spreadsheets:', e);
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const s = await createSpreadsheet(newName.trim());
      setSheets((prev) => [{ id: s.id, name: s.name }, ...prev]);
      setSelected(s.id);
      onSpreadsheetSelect(s.id);
      setNewName('');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSelect = (e) => {
    setSelected(e.target.value);
    onSpreadsheetSelect(e.target.value);
  };

  return (
    <div className="space-y-3">
      {!authed ? (
        <div className="flex items-center gap-3">
          <button
            onClick={initing ? undefined : init}
            disabled={initing || disabled}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {initing ? 'Connecting...' : 'Connect Google Account'}
          </button>
          {!initing && !error && (
            <button
              onClick={() => { init().then(() => signIn()); }}
              disabled={disabled}
              className="px-5 py-2.5 bg-white border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Sign In with Google
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-green-600 font-medium text-sm">Connected to Google</span>
            <button
              onClick={signOut}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Sign out
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={handleSelect}
              disabled={loadingSheets || disabled}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">
                {loadingSheets ? 'Loading spreadsheets...' : '-- Select a spreadsheet --'}
              </option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={loadSheets}
              disabled={loadingSheets}
              className="text-sm px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              title="Refresh"
            >
              ↻
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New spreadsheet name..."
              disabled={disabled}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || disabled}
              className="text-sm px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  );
}
