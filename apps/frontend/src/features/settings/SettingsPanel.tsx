import { useMemo, useState } from 'react';

import { trpc } from '../../lib/trpc';

const GROUPS: { id: string; label: string }[] = [
  { id: 'openai', label: 'Provider' },
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
  const listEmbeddingModels = trpc.settings.listEmbeddingModels.useMutation();

  async function pickModel(
    key: 'openai.model' | 'openai.embeddingModel',
    model: string,
  ) {
    setDrafts((p) => ({ ...p, [key]: model }));
    await updateSetting.mutateAsync({ key, value: model });
    void utils.settings.list.invalidate();
  }

  const PRESETS: {
    id: string;
    label: string;
    baseUrl: string;
    /** Extra guidance shown after applying the preset. */
    note?: string;
  }[] = [
    { id: 'openai', label: 'OpenAI', baseUrl: '' },
    {
      id: 'opencode',
      label: 'OpenCode Zen',
      baseUrl: 'https://opencode.ai/zen/v1',
      note: 'OpenCode Zen serves chat models only — set the embedding base URL and key below to a provider with embeddings (OpenAI, Ollama, ...).',
    },
    {
      id: 'opencode-go',
      label: 'OpenCode Zen Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      note: 'OpenCode Zen Go (Go plan) serves chat models only — set the embedding base URL and key below to a provider with embeddings (OpenAI, Ollama, ...).',
    },
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  ];

  async function applyPreset(preset: { baseUrl: string; note?: string }) {
    await updateSetting.mutateAsync({
      key: 'openai.baseUrl',
      value: preset.baseUrl,
    });
    setDrafts((p) => ({ ...p, 'openai.baseUrl': preset.baseUrl }));
    void utils.settings.list.invalidate();
    setSaved(
      preset.baseUrl
        ? `Provider preset applied — ${
            preset.note ?? 'set the model names and fetch the model list below.'
          }`
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
              ones). Local providers don't need an API key. Chat-only providers
              (like OpenCode Zen) have no embeddings — point the embedding base
              URL and key at another provider. Set the chat and embedding model
              names below, matching the embedding dimensions setting.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => void applyPreset(preset)}
                  disabled={updateSetting.isPending}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-nexus-500 hover:text-nexus-300 disabled:opacity-40"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-4 border-t border-zinc-800 pt-3">
              <ModelPickerRow
                label="Fetch chat models"
                onFetch={() => listModels.mutate()}
                pending={listModels.isPending}
                result={listModels.data}
                onPick={(model) => void pickModel('openai.model', model)}
              />
              <ModelPickerRow
                label="Fetch embedding models"
                onFetch={() => listEmbeddingModels.mutate()}
                pending={listEmbeddingModels.isPending}
                result={listEmbeddingModels.data}
                onPick={(model) =>
                  void pickModel('openai.embeddingModel', model)
                }
              />
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
            {testOpenAI.isPending ? 'Testing...' : 'Test connection'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelPickerRowProps {
  label: string;
  onFetch: () => void;
  pending: boolean;
  result?: { models: string[]; error: string | null };
  onPick: (model: string) => void;
}

/** Fetch button + status + clickable model-name chips for one provider. */
function ModelPickerRow({
  label,
  onFetch,
  pending,
  result,
  onPick,
}: ModelPickerRowProps) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={onFetch}
          disabled={pending}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          {pending ? 'Fetching...' : label}
        </button>
        {result && !result.error && (
          <span className="text-xs text-emerald-400">
            {result.models.length} models found
          </span>
        )}
        {result?.error && (
          <span className="text-xs text-red-400">{result.error}</span>
        )}
      </div>
      {result && !result.error && result.models.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] text-zinc-500">
            {result.models.length} models found — click one to select it
          </p>
          <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {result.models.map((model) => (
              <button
                key={model}
                onClick={() => onPick(model)}
                className="rounded bg-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:bg-nexus-600/30"
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      )}
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
      placeholder?: string;
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
            placeholder={def.placeholder ?? setting.value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
        )}
      </div>
    </div>
  );
}
