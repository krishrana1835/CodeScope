import {
  Activity,
  AlertOctagon,
  Boxes,
  Bug,
  FileCode2,
  FolderGit2,
  GitBranch,
  History,
  Layers,
  Play,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ChangedFilesView } from './components/ChangedFilesView.tsx';
import { CliModal, DotNetSolutionModal } from './components/CliAndDotNetModals.tsx';
import { FindingsWorkspace } from './components/FindingsWorkspace.tsx';
import { ProjectArchitectureView } from './components/ProjectArchitectureView.tsx';
import { ProviderSettingsView } from './components/ProviderSettingsView.tsx';
import { ReviewHistoryView } from './components/ReviewHistoryView.tsx';
import type {
  CheckMode,
  Finding,
  GitRepositoryInfo,
  NavSection,
  ProjectIndexSummary,
  ProviderConfig,
  ReviewSession,
  ReviewSessionSummary,
} from './types.ts';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'changed-files', label: 'Changed Files', icon: FileCode2 },
  { id: 'bugs', label: 'Potential Bugs', icon: Bug },
  { id: 'structural', label: 'Structural Problems', icon: Layers },
  { id: 'security', label: 'Security Concerns', icon: Shield },
  { id: 'performance', label: 'Performance Issues', icon: Zap },
  { id: 'improvements', label: 'Code Improvements', icon: Wrench },
  { id: 'ai-review', label: 'AI Review', icon: Sparkles },
  { id: 'architecture', label: 'Project Architecture', icon: Boxes },
  { id: 'history', label: 'Review History', icon: History },
  { id: 'settings', label: 'AI Provider Settings', icon: Settings },
];

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [repoPath, setRepoPath] = useState<string>('');
  const [repoInput, setRepoInput] = useState<string>('');
  const [repoInfo, setRepoInfo] = useState<GitRepositoryInfo | null>(null);
  const [branches, setBranches] = useState<string[]>(['main']);
  const [projectIndex, setProjectIndex] = useState<ProjectIndexSummary | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [history, setHistory] = useState<ReviewSessionSummary[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  const [checkMode, setCheckMode] = useState<CheckMode>('changes');
  const [baseBranch, setBaseBranch] = useState<string>('main');
  const [noAi, setNoAi] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [runningCheck, setRunningCheck] = useState<boolean>(false);
  const [refreshingIndex, setRefreshingIndex] = useState<boolean>(false);
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [cliOpen, setCliOpen] = useState(false);
  const [dotnetOpen, setDotnetOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 3500);
  };

  const loadHistoryAndProviders = useCallback(async () => {
    const [sessionsRes, providersRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/providers'),
    ]);
    if (sessionsRes.ok) {
      setHistory((await sessionsRes.json()) as ReviewSessionSummary[]);
    }
    if (providersRes.ok) {
      setProviders((await providersRes.json()) as ProviderConfig[]);
    }
  }, []);

  const runCheck = useCallback(
    async (opts?: { targetRepo?: string; mode?: CheckMode; noAiFlag?: boolean }) => {
      setRunningCheck(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoPath: opts?.targetRepo ?? (repoPath || undefined),
            mode: opts?.mode ?? checkMode,
            noAi: opts?.noAiFlag ?? noAi,
            baseBranch,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'CodeScope check failed.');
        }
        const newSession = data as ReviewSession;
        setSession(newSession);
        setRepoPath(newSession.rootPath);
        setRepoInput(newSession.rootPath);
        await loadHistoryAndProviders();
        const idxRes = await fetch(`/api/project-index?repoPath=${encodeURIComponent(newSession.rootPath)}`);
        if (idxRes.ok) {
          setProjectIndex((await idxRes.json()) as ProjectIndexSummary);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Check execution failed.');
      } finally {
        setRunningCheck(false);
      }
    },
    [repoPath, checkMode, noAi, baseBranch, loadHistoryAndProviders]
  );

  // Initial bootstrap: detect repo status, load existing sessions or run initial check
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        const statusRes = await fetch('/api/repo/status');
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Repository detection failed.');
        if (cancelled) return;

        setRepoInfo(statusData.info as GitRepositoryInfo);
        setRepoPath(statusData.info.rootPath);
        setRepoInput(statusData.info.rootPath);
        setBranches(statusData.branches as string[]);
        setProjectIndex(statusData.index as ProjectIndexSummary);

        await loadHistoryAndProviders();

        // Load latest persisted session or run an immediate initial check
        const histRes = await fetch('/api/sessions');
        const hist = (await histRes.json()) as ReviewSessionSummary[];
        if (hist.length > 0) {
          const latestRes = await fetch(`/api/sessions/${hist[0].id}`);
          if (latestRes.ok) {
            setSession((await latestRes.json()) as ReviewSession);
            setLoading(false);
            return;
          }
        }

        // First launch: run initial static + AI check automatically
        const checkRes = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: statusData.info.rootPath, mode: 'changes', noAi: false }),
        });
        if (checkRes.ok && !cancelled) {
          const initialSession = (await checkRes.json()) as ReviewSession;
          setSession(initialSession);
          await loadHistoryAndProviders();
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize CodeScope.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadHistoryAndProviders]);

  const handleSwitchRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoInput.trim()) return;
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/repo/status?repoPath=${encodeURIComponent(repoInput.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid repository path.');
      setRepoInfo(data.info as GitRepositoryInfo);
      setRepoPath(data.info.rootPath);
      setBranches(data.branches as string[]);
      setProjectIndex(data.index as ProjectIndexSummary);
      await runCheck({ targetRepo: data.info.rootPath });
      showToast(`Switched repository to ${data.info.rootPath}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to switch repository.');
    }
  };

  const handleRefreshIndex = async (forceFull: boolean) => {
    setRefreshingIndex(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, force: forceFull }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Index refresh failed.');
      setProjectIndex(data.index as ProjectIndexSummary);
      showToast(forceFull ? 'Full project index rebuilt.' : 'Incremental project index refreshed.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Index refresh failed.');
    } finally {
      setRefreshingIndex(false);
    }
  };

  const handleAcceptFinding = async (finding: Finding) => {
    setBusyFindingId(finding.id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/findings/${finding.id}/apply`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply suggestion.');
      setSession((prev) =>
        prev
          ? {
              ...prev,
              findings: prev.findings.map((f) => (f.id === finding.id ? { ...f, status: 'Accepted' } : f)),
            }
          : prev
      );
      showToast(data.message || `Applied suggestion to ${finding.filePath}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not apply suggestion.');
    } finally {
      setBusyFindingId(null);
    }
  };

  const handleRejectFinding = async (finding: Finding) => {
    setBusyFindingId(finding.id);
    try {
      const res = await fetch(`/api/findings/${finding.id}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reject suggestion.');
      setSession((prev) =>
        prev
          ? {
              ...prev,
              findings: prev.findings.map((f) => (f.id === finding.id ? { ...f, status: 'Rejected' } : f)),
            }
          : prev
      );
      showToast('Suggestion rejected. Original code preserved.');
    } finally {
      setBusyFindingId(null);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (res.ok) {
      const loaded = (await res.json()) as ReviewSession;
      setSession(loaded);
      setActiveNav('overview');
    }
  };

  const handleUpdateProvider = async (
    id: string,
    patch: Partial<Pick<ProviderConfig, 'endpoint' | 'modelId' | 'thinkingLevel' | 'isDefault' | 'isEnabled' | 'excludedDirs'>>
  ) => {
    const res = await fetch(`/api/providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setProviders((await res.json()) as ProviderConfig[]);
      showToast('Provider settings saved to local SQLite store.');
    }
  };

  const handleTestProvider = async (id: string) => {
    const res = await fetch(`/api/providers/${id}/test`, { method: 'POST' });
    return (await res.json()) as { ok: boolean; latencyMs: number; message: string };
  };

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav)!;

  const countForNav = (id: NavSection): number | null => {
    if (!session) return null;
    switch (id) {
      case 'changed-files':
        return session.changedFiles.length;
      case 'bugs':
        return session.findings.filter((f) => f.category === 'Bug').length;
      case 'structural':
        return session.findings.filter((f) => f.category === 'Architecture').length;
      case 'security':
        return session.findings.filter((f) => f.category === 'Security').length;
      case 'performance':
        return session.findings.filter((f) => f.category === 'Performance').length;
      case 'improvements':
        return session.findings.filter((f) => f.category === 'Maintainability').length;
      case 'ai-review':
        return session.findings.filter((f) => f.detectionSource === 'AI Review').length;
      case 'history':
        return history.length;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {/* Left Sidebar (260px) */}
      <aside className="w-[260px] shrink-0 border-r border-slate-800/80 bg-[#0E131D] flex flex-col justify-between sticky top-0 h-screen">
        <div className="overflow-y-auto">
          {/* Brand */}
          <div className="h-14 px-5 flex items-center border-b border-slate-800/80">
            <span className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap">
              CodeScope
            </span>
          </div>

          {/* Repository Info & Path Switcher */}
          <form onSubmit={handleSwitchRepository} className="px-4 py-3.5 border-b border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
              <FolderGit2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">{projectIndex?.name ?? 'Repository'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              <GitBranch className="w-3 h-3 shrink-0" />
              <span className="truncate">{repoInfo?.branch ?? 'main'}</span>
              <span aria-hidden="true">·</span>
              <span>{repoInfo?.headCommit ?? 'HEAD'}</span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                title="Local Git repository path"
                className="w-full px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#0B0F17] border border-slate-800 text-slate-300 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="px-2 py-1 text-[11px] font-medium rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Open
              </button>
            </div>
          </form>

          {/* Primary 11 Navigation Sections */}
          <nav className="p-2.5 space-y-0.5" aria-label="Dashboard sections">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              const count = countForNav(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#1A2332] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#141B26]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-500'}`} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {count !== null && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Developer Tools Footer */}
        <div className="p-3 border-t border-slate-800/80 space-y-1.5">
          <button
            type="button"
            onClick={() => setCliOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg text-slate-300 hover:bg-[#141B26] border border-slate-800/80 transition-colors whitespace-nowrap"
          >
            <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
            <span>CLI Terminal</span>
          </button>
          <button
            type="button"
            onClick={() => setDotnetOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg text-slate-300 hover:bg-[#141B26] border border-slate-800/80 transition-colors whitespace-nowrap"
          >
            <Boxes className="w-4 h-4 text-slate-400 shrink-0" />
            <span>.NET 8 C# Solution</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar (Strict 3-zone alignment) */}
        <header className="h-14 px-6 border-b border-slate-800/80 bg-[#0B0F17] flex items-center justify-between gap-8 sticky top-0 z-20">
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0 truncate">
            <span className="text-slate-300 font-medium whitespace-nowrap">
              {projectIndex?.name ?? 'OrderFlow.Net8'}
            </span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-100 font-medium whitespace-nowrap">{activeNavMeta.label}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              aria-label="Analysis scope"
              value={checkMode}
              onChange={(e) => setCheckMode(e.target.value as CheckMode)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[#111722] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="changes">Working Changes</option>
              <option value="staged">Staged Only (--staged)</option>
              <option value="all">Full Solution (--all)</option>
              <option value="branch">Branch Diff</option>
            </select>

            {checkMode === 'branch' && (
              <select
                aria-label="Base branch"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono rounded-lg bg-[#111722] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    vs {b}
                  </option>
                ))}
              </select>
            )}

            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-[#111722] border border-slate-800 text-slate-300 cursor-pointer whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={noAi}
                onChange={(e) => setNoAi(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
              />
              Offline (--no-ai)
            </label>

            <button
              type="button"
              disabled={runningCheck || loading}
              onClick={() => runCheck()}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              {runningCheck ? 'Analyzing...' : 'Run Check'}
            </button>
          </div>
        </header>

        {/* Notifications */}
        {(errorMsg || toastMsg) && (
          <div className="px-6 pt-4">
            {errorMsg && (
              <div className="rounded-lg border border-rose-800/80 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200 flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            {toastMsg && !errorMsg && (
              <div className="rounded-lg border border-blue-800/70 bg-blue-950/30 px-4 py-2.5 text-xs text-blue-200">
                {toastMsg}
              </div>
            )}
          </div>
        )}

        {/* Active Viewport */}
        <main className="flex-1 p-6 max-w-[1480px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 rounded-xl bg-[#111722] border border-slate-800/80 animate-pulse" />
              <div className="h-96 rounded-xl bg-[#111722] border border-slate-800/80 animate-pulse" />
            </div>
          ) : (
            <>
              {activeNav === 'overview' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Review Overview"
                  subtitle="Combined Git diff, Roslyn static rule diagnostics, architectural boundary checks, and contextual AI review."
                  showOverviewKpis
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'changed-files' && session && (
                <ChangedFilesView changedFiles={session.changedFiles} />
              )}

              {activeNav === 'bugs' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Potential Bugs"
                  subtitle="Null reference risks, unhandled exception paths, resource leaks, and business logic defects."
                  lockedCategory="Bug"
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'structural' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Structural Problems"
                  subtitle="Layered architecture violations, direct DataAccess coupling, and dependency boundary breaks."
                  lockedCategory="Architecture"
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'security' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Security Concerns"
                  subtitle="SQL injection vectors, unsafe input concatenation, and credential handling diagnostics."
                  lockedCategory="Security"
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'performance' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Performance Issues"
                  subtitle="Thread-pool blocking (.Result/.Wait), socket exhaustion, and inefficient LINQ enumeration."
                  lockedCategory="Performance"
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'improvements' && session && (
                <FindingsWorkspace
                  session={session}
                  title="Code Improvements"
                  subtitle="Argument validation guards, maintainability enhancements, and contract consistency."
                  lockedCategory="Maintainability"
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'ai-review' && session && (
                <FindingsWorkspace
                  session={session}
                  title="AI Review"
                  subtitle="Cross-file reasoning and business-logic findings produced from retrieved project context."
                  aiOnly
                  onAcceptFinding={handleAcceptFinding}
                  onRejectFinding={handleRejectFinding}
                  busyFindingId={busyFindingId}
                />
              )}

              {activeNav === 'architecture' && (
                <ProjectArchitectureView
                  index={projectIndex}
                  onRefreshIndex={handleRefreshIndex}
                  refreshing={refreshingIndex}
                />
              )}

              {activeNav === 'history' && (
                <ReviewHistoryView
                  sessions={history}
                  activeSessionId={session?.id ?? null}
                  onSelectSession={handleSelectSession}
                />
              )}

              {activeNav === 'settings' && (
                <ProviderSettingsView
                  providers={providers}
                  onUpdateProvider={handleUpdateProvider}
                  onTestProvider={handleTestProvider}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      <CliModal
        open={cliOpen}
        repoPath={repoPath}
        onClose={() => setCliOpen(false)}
        onSessionCreated={async (id) => {
          await loadHistoryAndProviders();
          await handleSelectSession(id);
        }}
      />

      <DotNetSolutionModal open={dotnetOpen} onClose={() => setDotnetOpen(false)} />
    </div>
  );
}
