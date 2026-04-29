import { useState } from 'react';
import { saveSettings } from '../lib/settings';
import { testApiKey } from '../lib/ai';

export default function Settings({ settings, onChange }) {
  const [key, setKey] = useState(settings.apiKey || '');
  const [status, setStatus] = useState('idle'); // idle | testing | ok | fail
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!settings.apiKey);

  const persist = (apiKey) => {
    const next = { ...settings, apiKey };
    saveSettings(next);
    onChange(next);
  };

  const runTest = async (candidate) => {
    if (!candidate) {
      setStatus('idle');
      setError('');
      return;
    }
    setStatus('testing');
    setError('');
    const res = await testApiKey(candidate);
    if (res.ok) {
      setStatus('ok');
      setError('');
    } else {
      setStatus('fail');
      setError(res.error || 'unknown error');
    }
  };

  const onBlur = () => {
    persist(key.trim());
    runTest(key.trim());
  };

  const clear = () => {
    setKey('');
    persist('');
    setStatus('idle');
    setError('');
  };

  const dotClass = {
    idle: 'bg-gray-300',
    testing: 'bg-amber-400 animate-pulse',
    ok: 'bg-green-500',
    fail: 'bg-red-500',
  }[status];

  const dotLabel = {
    idle: key ? 'Not tested' : 'No key',
    testing: 'Testing…',
    ok: 'API key works',
    fail: `Failed: ${error}`,
  }[status];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
        type="button"
      >
        <span className="flex items-center gap-2 font-medium text-sm text-gray-700">
          Anthropic API key
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`}
            title={dotLabel}
          />
          <span className="text-xs text-gray-500 font-normal">
            {settings.apiKey ? 'set' : 'not set'}. AI classification of uncertain groups{' '}
            {settings.apiKey ? 'enabled' : 'disabled'}
          </span>
        </span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">API key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onBlur={onBlur}
                placeholder="sk-ant-..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => runTest(key.trim())}
                disabled={!key.trim() || status === 'testing'}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                Test
              </button>
              {settings.apiKey && (
                <button
                  type="button"
                  onClick={clear}
                  className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Stored in your browser&apos;s localStorage only; never sent anywhere except directly to
            Anthropic. This app uses{' '}
            <code className="text-[11px] bg-gray-100 px-1 rounded">
              anthropic-dangerous-direct-browser-access
            </code>{' '}
            header. Safe for personal single-user use, not for deployments where other people share your
            browser. Leave blank to skip AI classification entirely; deterministic rules still run.
          </p>
          {status === 'fail' && (
            <p className="text-xs text-red-600 break-words">
              <strong>Test failed:</strong> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
