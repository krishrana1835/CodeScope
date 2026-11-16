import { CheckCircle2, Play, Save, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { ProviderConfig } from '../types.ts';

interface ProviderSettingsViewProps {
  providers: ProviderConfig[];
  onUpdateProvider: (
    id: string,
    patch: Partial<Pick<ProviderConfig, 'endpoint' | 'modelId' | 'thinkingLevel' | 'isDefault' | 'isEnabled' | 'excludedDirs'>>
  ) => Promise<void>;
  onTestProvider: (id: string) => Promise<{ ok: boolean; latencyMs: number; message: string }>;
}

const GEMINI_MODELS = [
  { id: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen (Recommended Fast Reasoning)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Lightweight)' },
];

export function ProviderSettingsView({
  providers,
  onUpdateProvider,
  onTestProvider,
}: ProviderSettingsViewProps) {
  const [selectedId, setSelectedId] = useState<string>(providers[0]?.id ?? 'gemini-studio');
  const active = providers.find((p) => p.id === selectedId) ?? providers[0];

  const [modelId, setModelId] = useState(active?.modelId ?? 'gemini-4-hydrogen');
  const [endpoint, setEndpoint] = useState(active?.endpoint ?? '');
  const [thinkingLevel, setThinkingLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>(active?.thinkingLevel ?? 'MEDIUM');
  const [excludedText, setExcludedText] = useState((active?.excludedDirs ?? []).join(', '));
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectProvider = (p: ProviderConfig) => {
    setSelectedId(p.id);
    setModelId(p.modelId);
    setEndpoint(p.endpoint);
    setThinkingLevel(p.thinkingLevel);
    setExcludedText(p.excludedDirs.join(', '));
    setTestResult(null);
  };

  if (!active) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const excludedDirs = excludedText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await onUpdateProvider(active.id, {
        modelId: modelId.trim() || active.modelId,
        endpoint: endpoint.trim() || active.endpoint,
        thinkingLevel,
        excludedDirs,
      });
      setTestResult({ ok: true, message: `Saved configuration for ${active.name}.` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestProvider(active.id);
      setTestResult({ ok: res.ok, message: res.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100 tracking-tight">AI Provider Settings</h2>
        <p className="text-sm text-slate-400 mt-1">
          Configure provider-independent IAIReviewProvider adapters, model selection, and directory exclusions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Provider List */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800/80 text-xs font-medium text-slate-300">
            Configured Review Providers (IAIReviewProvider)
          </div>
          <div className="divide-y divide-slate-800/70">
            {providers.map((p) => {
              const isSelected = p.id === active.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p)}
                  className={`w-full text-left px-4 py-3.5 transition-colors ${
                    isSelected ? 'bg-[#1A2332]' : 'hover:bg-[#151D2B]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100">{p.name}</span>
                    <span className="text-xs font-mono text-blue-400">
                      {p.isDefault ? 'Default' : p.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-mono truncate">
                    Model: {p.modelId} · {p.providerType}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Provider Editor */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800/80 bg-[#111722] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
            <div>
              <h3 className="text-base font-semibold text-slate-100">{active.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Adapter Type: <span className="font-mono text-slate-300">{active.providerType}</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateProvider(active.id, { isEnabled: !active.isEnabled })}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {active.isEnabled ? 'Disable Provider' : 'Enable Provider'}
              </button>
              {!active.isDefault && (
                <button
                  type="button"
                  onClick={() => onUpdateProvider(active.id, { isDefault: true, isEnabled: true })}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
                >
                  Set as Default
                </button>
              )}
            </div>
          </div>

          {/* Server-Managed Credential Notice (no API key input UI) */}
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <div className="font-medium text-slate-200">
                {active.providerType === 'gemini'
                  ? active.hasServerCredential
                    ? 'Server-side Gemini credential active (Settings > Secrets / Windows Credential Manager)'
                    : 'Server-side Gemini credential not detected in runtime environment'
                  : 'Local / OpenAI-compatible inference endpoint'}
              </div>
              <p className="text-slate-400 leading-relaxed">
                API credentials are never stored in SQLite or exposed to frontend JavaScript. The .NET CLI uses Windows Credential Manager, and the local server uses environment secrets strictly on the backend.
              </p>
            </div>
          </div>

          {/* Model Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Model Identifier</label>
              {active.providerType === 'gemini' ? (
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  {GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Reasoning Depth</label>
              <select
                value={thinkingLevel}
                onChange={(e) => setThinkingLevel(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')}
                className="w-full px-3 py-2 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500"
              >
                <option value="LOW">Low (Fastest latency)</option>
                <option value="MEDIUM">Medium (Balanced speed and depth)</option>
                <option value="HIGH">High (Deep cross-file reasoning)</option>
              </select>
            </div>
          </div>

          {active.providerType !== 'gemini' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Provider API Endpoint</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Excluded Directories (comma-separated)
            </label>
            <input
              type="text"
              value={excludedText}
              onChange={(e) => setExcludedText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {testResult && (
            <div
              className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2.5 ${
                testResult.ok
                  ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
                  : 'border-rose-800/70 bg-rose-950/30 text-rose-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={testing}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
