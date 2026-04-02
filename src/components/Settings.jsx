import { useState } from 'react';

const STORAGE_KEY = 'sybill-processor-settings';

export function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  };
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function Settings({ settings, onChange }) {
  const [open, setOpen] = useState(!settings.apiKey || !settings.clientId);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    saveSettings(next);
    onChange(next);
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="font-medium text-sm text-gray-700">
          Google Cloud Settings
        </span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Google API Key
            </label>
            <input
              type="text"
              value={settings.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder="AIza..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              OAuth 2.0 Client ID
            </label>
            <input
              type="text"
              value={settings.clientId}
              onChange={(e) => update('clientId', e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <p className="text-xs text-gray-400">
            These are stored in your browser's localStorage. You can also set
            VITE_GOOGLE_API_KEY and VITE_GOOGLE_CLIENT_ID in a .env file.
          </p>
        </div>
      )}
    </div>
  );
}
