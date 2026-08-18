import { useMemo, useState } from 'react';

import { trpc } from '../../lib/trpc';

const GROUPS: { id: string; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'retrieval', label: 'Retrieval' },
  { id: 'server', label: 'Server' },
  { id: 'auth', label: 'Authentication' },
  { id: 'ui', label: 'Appearance' },
];

export function SettingsPanel() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.list.useQuery(undefined);
  const updateSetting = trpc.settings.update.useMutation({
    onSuccess: () => void utils.settings.list.invalidate(),
  });
  const testOpenAI = trpc.settings.testOpenAI.useMutation();

  // Draft values (raw). Secret fields are edited via the "Change" toggle.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [secretMode, setSecretMode] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => settings.data ?? [], [settings.data]);

  // Keep drafts in sync when the server data changes (render-phase
  // adjustment - the React-documented alternative to setState-in-effect).
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const s of data) {
        next[s.key] = s.def.type === 'secret' ? (prev[s.key] ?? '') : s.value;
      }
      return next;
    });
  }

  const dirtyCount = useMemo(
    () =>
      data.filter((s) => {
        if (s.def.type === 'secret') {
          return (secretDrafts[s.key] ?? '') !== '';
        }
        return (drafts[s.key] ?? s.value) !== s.value;
      }).length,
    [data, drafts, secretDrafts],
  );

  async function saveAll() {
    setError(null);
    setSaved(null);
    try {
      for (const s of data) {
        const value =
          s.def.type === 'secret'
            ? (secretDrafts[s.key] ?? '')
            : (drafts[s.key] ?? '');
        if (value === s.value && !(s.def.type === 'secret' && value !== '')) {
          continue;
        }
        await updateSetting.mutateAsync({ key: s.key, value });
      }
      setSecretDrafts({});
      setSaved('Settings saved — new requests pick them up immediately.');
      void utils.settings.list.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }

  async function resetAll() {
    setError(null);
    setSaved(null);
    try {
      for (const s of data) {
        await updateSetting.mutateAsync({ key: s.key, value: '' });
      }
      setDrafts({});
      setSecretDrafts({});
      setSaved('All settings reset to defaults.');
      void utils.settings.list.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset settings');
    }
  }

  const listModels = trpc.settings.listModels.useMutation();

  const PRESETS: { id: string; label: string; baseUrl: string }[] = [
    { id: 'openai', label: 'OpenAI', baseUrl: '' },
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  ];

  async function applyPreset(baseUrl: string) {
    await updateSetting.mutateAsync({ key: 'openai.baseUrl', value: baseUrl });
    setDrafts((p) => ({ ...p, 'openai.baseUrl': baseUrl }));
    void utils.settings.list.invalidate();
    setSaved(
      baseUrl
        ? 'Provider preset applied — set the model names and fetch the model list below.'
        : 'Provider set to OpenAI.',
    );
  }

  if (settings.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Settings</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Values set here override environment variables and apply without a
              restart. Leave a field empty to use its default.
            </p>
          </div>
          {testOpenAI.isSuccess && (
            <span
              className={`rounded-lg px-3 py-1.5 text-xs ${
                testOpenAI.data.ok
                  ? 'bg-emerald-950/40 text-emerald-400'
                  : 'bg-red-950/40 text-red-400'
              }`}
            >
              {testOpenAI.data.message}
            </span>
          )}
        </div>

        <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
            Provider
          </h2>
          <div className="px-5 py-4">
            <p className="text-xs text-zinc-500">
              Quick-set the API base URL for common providers (including local
              ones). Local providers don't need an API key. Set the chat and
              embedding model names below, matching the embedding dimensions
              setting.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => void applyPreset(preset.baseUrl)}
                  disabled={updateSetting.isPending}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-nexus-500 hover:text-nexus-300 disabled:opacity-40"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-zinc-800 pt-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => listModels.mutate()}
                  disabled={listModels.isPending}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  {listModels.isPending
                    ? 'Fetching...'
                    : 'Fetch available models'}
                </button>
                {listModels.data && !listModels.data.error && (
                  <span className="text-xs text-emerald-400">
                    {listModels.data.models.length} models found
                  </span>
                )}
                {listModels.data?.error && (
                  <span className="text-xs text-red-400">
                    {listModels.data.error}
                  </span>
                )}
              </div>
              {listModels.data && listModels.data.models.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {listModels.data.models.map((model) => (
                    <button
                      key={model}
                      onClick={() => {
                        setDrafts((p) => ({
                          ...p,
                          'openai.model': model,
                        }));
                        void updateSetting.mutateAsync({
                          key: 'openai.model',
                          value: model,
                        });
                        void utils.settings.list.invalidate();
                      }}
                      className="rounded bg-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:bg-nexus-600/30"
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {GROUPS.map((group) => {
          const items = data.filter((s) => s.def.group === group.id);
          if (items.length === 0) return null;
          return (
            <section
              key={group.id}
              className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40"
            >
              <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
                {group.label}
              </h2>
              <div className="divide-y divide-zinc-800/60">
                {items.map((s) => (
                  <Field
                    key={s.key}
                    setting={s}
                    draft={drafts[s.key] ?? ''}
                    secretDraft={secretDrafts[s.key] ?? ''}
                    secretMode={secretMode[s.key] ?? false}
                    onChange={(value) =>
                      setDrafts((p) => ({ ...p, [s.key]: value }))
                    }
                    onSecretChange={(value) =>
                      setSecretDrafts((p) => ({ ...p, [s.key]: value }))
                    }
                    onToggleSecret={() =>
                      setSecretMode((p) => ({ ...p, [s.key]: !p[s.key] }))
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}

        {error && (
          <p className="mb-4 rounded-lg bg-red-950/40 px-4 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        {saved && (
          <p className="mb-4 rounded-lg bg-emerald-950/40 px-4 py-2 text-sm text-emerald-400">
            {saved}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={saveAll}
            disabled={updateSetting.isPending || dirtyCount === 0}
            className="rounded-lg bg-nexus-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
          >
            {updateSetting.isPending
              ? 'Saving...'
              : `Save changes${dirtyCount ? ` (${dirtyCount})` : ''}`}
          </button>
          <button
            onClick={resetAll}
            disabled={updateSetting.isPending}
            className="rounded-lg border border-zinc-700 px-5 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800"
          >
            Reset all to defaults
          </button>
          <button
            onClick={() => testOpenAI.mutate()}
            disabled={testOpenAI.isPending}
            className="rounded-lg border border-zinc-700 px-5 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            {testOpenAI.isPending ? 'Testing...' : 'Test OpenAI connection'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  setting: {
    key: string;
    value: string;
    displayValue: string;
    source: 'ui' | 'env';
    def: {
      label: string;
      description: string;
      type: string;
      min?: number;
      max?: number;
      step?: number;
      options?: string[];
    };
  };
  draft: string;
  secretDraft: string;
  secretMode: boolean;
  onChange: (value: string) => void;
  onSecretChange: (value: string) => void;
  onToggleSecret: () => void;
}

function Field({
  setting,
  draft,
  secretDraft,
  secretMode,
  onChange,
  onSecretChange,
  onToggleSecret,
}: FieldProps) {
  const { def } = setting;

  if (def.type === 'secret') {
    return (
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {def.label}
              {setting.source === 'env' && (
                <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  env
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{def.description}</p>
          </div>
          {!secretMode && setting.displayValue && (
            <button
              onClick={onToggleSecret}
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Change
            </button>
          )}
        </div>
        {secretMode ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={secretDraft}
              onChange={(e) => onSecretChange(e.target.value)}
              placeholder={setting.displayValue || 'New value'}
              autoFocus
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
            />
            <button
              onClick={onToggleSecret}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Done
            </button>
          </div>
        ) : (
          <p className="mt-1 font-mono text-sm text-zinc-400">
            {setting.displayValue ||
              (setting.source === 'env' ? 'unset' : 'unset')}
          </p>
        )}
      </div>
    );
  }

  const isNumber = def.type === 'number' || def.type === 'slider';

  return (
    <div className="px-5 py-4">
      <p className="text-sm font-medium">
        {def.label}
        {setting.source === 'env' && (
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
            env
          </span>
        )}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{def.description}</p>
      <div className="mt-2">
        {def.type === 'slider' ? (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step ?? 1}
              value={draft === '' ? setting.value : draft}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 accent-nexus-600"
            />
            <input
              type="number"
              min={def.min}
              max={def.max}
              step={def.step ?? 1}
              value={draft === '' ? setting.value : draft}
              onChange={(e) => onChange(e.target.value)}
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-right text-sm outline-none focus:border-nexus-500"
            />
          </div>
        ) : def.type === 'textarea' ? (
          <textarea
            value={draft}
            placeholder={setting.value || 'Built-in default prompt'}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
        ) : def.type === 'select' ? (
          <select
            value={draft === '' ? setting.value : draft}
            onChange={(e) => onChange(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            {(def.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={isNumber ? 'number' : 'text'}
            min={def.min}
            max={def.max}
            value={draft}
            placeholder={setting.value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
        )}
      </div>
    </div>
  );
}
