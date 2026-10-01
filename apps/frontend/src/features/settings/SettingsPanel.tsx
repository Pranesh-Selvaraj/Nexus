import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { trpc } from '../../lib/trpc';

const GROUPS: { id: string; label: string }[] = [
  // Provider settings (chat + embeddings) render in the dedicated cards above.
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
  const updateMany = trpc.settings.updateMany.useMutation();
  const testOpenAI = trpc.settings.testOpenAI.useMutation();
  const saving = updateSetting.isPending || updateMany.isPending;

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

    // One validated batch: cross-field invariants (chunk overlap < chunk
    // size) are checked against the final state, not the save order.
    const values: Record<string, string> = {};
    for (const s of data) {
      if (s.def.type === 'secret') {
        const value = secretDrafts[s.key] ?? '';
        if (value !== '') values[s.key] = value;
      } else {
        const value = drafts[s.key] ?? s.value;
        if (value !== s.value) values[s.key] = value;
      }
    }
    if (Object.keys(values).length === 0) return;

    try {
      await updateMany.mutateAsync({ values });
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
      const values: Record<string, string> = {};
      for (const s of data) values[s.key] = '';
      await updateMany.mutateAsync({ values });
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

  interface ProviderPreset {
    id: string;
    label: string;
    baseUrl: string;
    /** Extra guidance shown after applying the preset. */
    note?: string;
  }

  /** Providers that answer chat questions (text model). */
  const CHAT_PRESETS: ProviderPreset[] = [
    { id: 'openai', label: 'OpenAI', baseUrl: '' },
    {
      id: 'opencode-go',
      label: 'OpenCode Zen Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      note: 'Go is chat-only — set up an embedding provider below.',
    },
    {
      id: 'opencode',
      label: 'OpenCode Zen',
      baseUrl: 'https://opencode.ai/zen/v1',
      note: 'Zen is chat-only — set up an embedding provider below.',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
    {
      id: 'ollama',
      label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434/v1',
      note: 'no key needed — e.g. llama3.1 for chat.',
    },
    {
      id: 'lmstudio',
      label: 'LM Studio (local)',
      baseUrl: 'http://localhost:1234/v1',
      note: 'no key needed.',
    },
  ];

  /** Providers that turn documents/questions into vectors. */
  const EMBEDDING_PRESETS: ProviderPreset[] = [
    {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      note: 'e.g. text-embedding-3-small (1536 dims).',
    },
    {
      id: 'ollama',
      label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434/v1',
      note: 'no key needed — e.g. qwen3-embedding:4b (2560 dims) or nomic-embed-text (768 dims).',
    },
    {
      id: 'jina',
      label: 'Jina',
      baseUrl: 'https://api.jina.ai/v1',
      note: 'e.g. jina-embeddings-v3 (1024 dims).',
    },
    {
      id: 'mistral',
      label: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      note: 'e.g. mistral-embed (1024 dims).',
    },
  ];

  async function applyPreset(
    key: 'openai.baseUrl' | 'openai.embeddingBaseUrl',
    preset: ProviderPreset,
  ) {
    await updateSetting.mutateAsync({ key, value: preset.baseUrl });
    setDrafts((p) => ({ ...p, [key]: preset.baseUrl }));
    void utils.settings.list.invalidate();
    setSaved(
      preset.baseUrl
        ? `${preset.label} preset applied — ${preset.note ?? 'now pick a model below.'}`
        : 'Provider set to OpenAI (default endpoint).',
    );
  }

  /** Live value of a setting (pending drafts included). */
  function liveValue(key: string): string {
    const s = data.find((item) => item.key === key);
    return drafts[key] !== undefined && drafts[key] !== ''
      ? (drafts[key] as string)
      : (s?.value ?? '');
  }

  /** Render one setting with the shared field component. */
  function renderField(key: string) {
    const s = data.find((item) => item.key === key);
    if (!s) return null;
    return (
      <Field
        key={s.key}
        setting={s}
        draft={drafts[s.key] ?? ''}
        secretDraft={secretDrafts[s.key] ?? ''}
        secretMode={secretMode[s.key] ?? false}
        onChange={(value) => setDrafts((p) => ({ ...p, [s.key]: value }))}
        onSecretChange={(value) =>
          setSecretDrafts((p) => ({ ...p, [s.key]: value }))
        }
        onToggleSecret={() =>
          setSecretMode((p) => ({ ...p, [s.key]: !p[s.key] }))
        }
      />
    );
  }

  const secretSetupMissing = data.some(
    (s) => s.def.type === 'secret' && !s.secretConfigured,
  );
  const decryptionFailed = data.filter(
    (s) => s.def.type === 'secret' && s.decryptionFailed,
  );

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
              Two independent providers: the text model answers your questions,
              the embedding model turns documents into searchable vectors. Each
              can point at a different OpenAI-compatible endpoint.
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

        {secretSetupMissing && (
          <div className="mb-6 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs leading-relaxed text-amber-300">
            <strong>API keys can't be saved from this panel yet:</strong>{' '}
            <code>SETTINGS_SECRET</code> is missing from your <code>.env</code>{' '}
            file. Keys set as environment variables still work, but keys entered
            here are encrypted with <code>SETTINGS_SECRET</code> (AES-256-GCM)
            before storage — add a random string to <code>.env</code> (e.g.{' '}
            <code>openssl rand -hex 32</code>) and restart the backend.
          </div>
        )}

        {decryptionFailed.length > 0 && (
          <div className="mb-6 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-3 text-xs leading-relaxed text-red-300">
            <strong>Stored keys can't be decrypted.</strong> The values for{' '}
            {decryptionFailed.map((s) => s.def.label).join(', ')} were encrypted
            with a different <code>SETTINGS_SECRET</code> than the one currently
            configured. Re-enter each key below (or restore the original secret)
            — until then, requests fall back to the environment/default value.
          </div>
        )}

        <ProviderPane
          title="Text model — answers your questions"
          description="Chat with your documents over WebSocket streams. Pick a preset for the endpoint (or type any OpenAI-compatible endpoint below) and choose the model."
          presets={CHAT_PRESETS}
          activeBaseUrl={liveValue('openai.baseUrl')}
          onApplyPreset={(preset) => void applyPreset('openai.baseUrl', preset)}
          pending={saving}
        >
          {renderField('openai.baseUrl')}
          {renderField('openai.apiKey')}
          {renderField('openai.model')}
          <div className="border-t border-zinc-800/60 px-5 py-4">
            <ModelPickerRow
              label="Fetch models from this endpoint"
              onFetch={() => listModels.mutate()}
              pending={listModels.isPending}
              result={listModels.data}
              activeModel={liveValue('openai.model')}
              onPick={(model) => void pickModel('openai.model', model)}
            />
          </div>
          {renderField('openai.temperature')}
        </ProviderPane>

        <ProviderPane
          title="Embeddings — makes your documents searchable"
          description="Indexes documents and encodes each question so retrieval can find the right passages. Chat-only endpoints (OpenCode Zen/Go) don't serve embeddings — use OpenAI or a local server here."
          presets={EMBEDDING_PRESETS}
          activeBaseUrl={liveValue('openai.embeddingBaseUrl')}
          onApplyPreset={(preset) =>
            void applyPreset('openai.embeddingBaseUrl', preset)
          }
          pending={saving}
        >
          {renderField('openai.embeddingBaseUrl')}
          {renderField('openai.embeddingApiKey')}
          {renderField('openai.embeddingModel')}
          <div className="border-t border-zinc-800/60 px-5 py-4">
            <ModelPickerRow
              label="Fetch models from this endpoint"
              onFetch={() => listEmbeddingModels.mutate()}
              pending={listEmbeddingModels.isPending}
              result={listEmbeddingModels.data}
              activeModel={liveValue('openai.embeddingModel')}
              onPick={(model) => void pickModel('openai.embeddingModel', model)}
            />
          </div>
          {renderField('embedding.dimensions')}
        </ProviderPane>

        <p className="mb-6 mt-2 text-[11px] text-zinc-600">
          API keys are encrypted at rest (AES-256-GCM with SETTINGS_SECRET) and
          never shown in full here — only a masked preview. Environment-provided
          keys show an "env" badge.
        </p>

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
                {items.map((s) => renderField(s.key))}
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
            disabled={saving || dirtyCount === 0}
            className="rounded-lg bg-nexus-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
          >
            {saving
              ? 'Saving...'
              : `Save changes${dirtyCount ? ` (${dirtyCount})` : ''}`}
          </button>
          <button
            onClick={resetAll}
            disabled={saving}
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

interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  note?: string;
}

interface ProviderPaneProps {
  title: string;
  description: string;
  presets: ProviderPreset[];
  activeBaseUrl: string;
  onApplyPreset: (preset: ProviderPreset) => void;
  pending?: boolean;
  children: ReactNode;
}

/** One role-specific provider card (chat or embeddings). */
function ProviderPane({
  title,
  description,
  presets,
  activeBaseUrl,
  onApplyPreset,
  pending,
  children,
}: ProviderPaneProps) {
  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
        {title}
      </h2>
      <div className="px-5 py-4">
        <p className="text-xs text-zinc-500">{description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((preset) => {
            const active = preset.baseUrl === activeBaseUrl;
            return (
              <button
                key={preset.id}
                onClick={() => onApplyPreset(preset)}
                disabled={pending}
                title={preset.note}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                  active
                    ? 'border-nexus-500 bg-nexus-600/20 text-nexus-300'
                    : 'border-zinc-700 text-zinc-300 hover:border-nexus-500 hover:text-nexus-300'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Presets fill in the endpoint only — or type any OpenAI-compatible
          endpoint into the field below. Click a fetched model to select it.
        </p>
      </div>
      <div className="divide-y divide-zinc-800/60 border-t border-zinc-800">
        {children}
      </div>
    </section>
  );
}

interface ModelPickerRowProps {
  label: string;
  onFetch: () => void;
  pending: boolean;
  result?: { models: string[]; error: string | null };
  activeModel?: string;
  onPick: (model: string) => void;
}

/** Fetch button + status + clickable model-name chips for one provider. */
function ModelPickerRow({
  label,
  onFetch,
  pending,
  result,
  activeModel,
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
            {result.models.map((model) => {
              const active = activeModel !== '' && activeModel === model;
              return (
                <button
                  key={model}
                  onClick={() => onPick(model)}
                  className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                    active
                      ? 'bg-nexus-600/40 text-nexus-200'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-nexus-600/30'
                  }`}
                >
                  {model}
                </button>
              );
            })}
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
    decryptionFailed: boolean;
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
          {!secretMode &&
            (setting.displayValue || setting.decryptionFailed) && (
              <button
                onClick={onToggleSecret}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                {setting.decryptionFailed ? 'Re-enter' : 'Change'}
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
          <p
            className={`mt-1 font-mono text-sm ${
              setting.decryptionFailed ? 'text-red-400' : 'text-zinc-400'
            }`}
          >
            {setting.decryptionFailed
              ? 'cannot decrypt — re-enter this key'
              : setting.displayValue || 'unset'}
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
