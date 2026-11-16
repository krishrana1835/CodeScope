import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DetectionSource, Finding, FindingCategory, ReviewSession, Severity } from '../types.ts';
import { IssueDetailsPanel } from './IssueDetailsPanel.tsx';
import { SeverityLabel } from './SeverityText.tsx';

interface FindingsWorkspaceProps {
  session: ReviewSession;
  title: string;
  subtitle: string;
  lockedCategory?: FindingCategory;
  aiOnly?: boolean;
  showOverviewKpis?: boolean;
  onAcceptFinding: (finding: Finding) => Promise<void>;
  onRejectFinding: (finding: Finding) => Promise<void>;
  busyFindingId: string | null;
}

export function FindingsWorkspace({
  session,
  title,
  subtitle,
  lockedCategory,
  aiOnly = false,
  showOverviewKpis = false,
  onAcceptFinding,
  onRejectFinding,
  busyFindingId,
}: FindingsWorkspaceProps) {
  const [severityFilter, setSeverityFilter] = useState<'All' | Severity>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | FindingCategory>('All');
  const [sourceFilter, setSourceFilter] = useState<'All' | DetectionSource>('All');
  const [fileFilter, setFileFilter] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scopedFindings = useMemo(() => {
    return session.findings.filter((f) => {
      if (lockedCategory && f.category !== lockedCategory) return false;
      if (aiOnly && f.detectionSource !== 'AI Review') return false;
      if (severityFilter !== 'All' && f.severity !== severityFilter) return false;
      if (!lockedCategory && categoryFilter !== 'All' && f.category !== categoryFilter) return false;
      if (!aiOnly && sourceFilter !== 'All' && f.detectionSource !== sourceFilter) return false;
      if (fileFilter !== 'All' && f.filePath !== fileFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.filePath.toLowerCase().includes(q) ||
          f.ruleId.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [session.findings, lockedCategory, aiOnly, severityFilter, categoryFilter, sourceFilter, fileFilter, query]);

  const availableFiles = useMemo(() => {
    return Array.from(new Set(session.findings.map((f) => f.filePath)));
  }, [session.findings]);

  const selectedFinding = useMemo(() => {
    if (selectedId) {
      const exact = scopedFindings.find((f) => f.id === selectedId);
      if (exact) return exact;
    }
    return scopedFindings[0] ?? null;
  }, [scopedFindings, selectedId]);

  const selectedChangedFile = useMemo(() => {
    if (!selectedFinding) return undefined;
    return session.changedFiles.find((c) => c.filePath === selectedFinding.filePath);
  }, [session.changedFiles, selectedFinding]);

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight">{title}</h2>
          <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
          <span>Scope: {session.mode}</span>
          <span aria-hidden="true">·</span>
          <span>Branch: {session.branch}</span>
          <span aria-hidden="true">·</span>
          <span>{session.durationMs}ms</span>
        </div>
      </div>

      {/* Overview KPI Strip */}
      {showOverviewKpis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: 'Files Analyzed', value: session.totalFiles, accent: 'text-slate-100' },
              { label: 'Total Findings', value: session.totalFindings, accent: 'text-slate-100' },
              { label: 'Critical', value: session.criticalCount, accent: 'text-rose-400' },
              { label: 'High', value: session.highCount, accent: 'text-orange-400' },
              { label: 'Medium', value: session.mediumCount, accent: 'text-amber-300' },
              { label: 'Low', value: session.lowCount, accent: 'text-sky-400' },
              { label: 'Suggestions', value: session.suggestionCount, accent: 'text-slate-300' },
              { label: 'Duration (ms)', value: session.durationMs, accent: 'text-blue-400' },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-slate-800/80 bg-[#111722] px-4 py-3.5"
              >
                <div className="text-xs text-slate-400 truncate">{kpi.label}</div>
                <div className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${kpi.accent}`}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-[#111722] px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400">
                Review Summary · Provider: <span className="text-slate-200">{session.aiProvider}</span> · Model:{' '}
                <span className="font-mono text-slate-200">{session.aiModel}</span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{session.summary}</p>
            </div>
          </div>
        </>
      )}

      {/* AI Review Context Retrieval Trace */}
      {aiOnly && (
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Contextual AI Summary & Retrieval Scope</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Provider: {session.aiProvider} · Model: <span className="font-mono">{session.aiModel}</span>
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {session.contextTrace.length} target file(s) scoped
            </span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">{session.summary}</p>

          {session.contextTrace.length > 0 && (
            <div className="border-t border-slate-800/80 pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              {session.contextTrace.map((trace) => (
                <div key={trace.targetFile} className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 text-xs space-y-1.5">
                  <div className="font-mono text-blue-400 truncate" title={trace.targetFile}>
                    {trace.targetFile}
                  </div>
                  <div className="text-slate-400">
                    Retrieved Context:{' '}
                    <span className="text-slate-300">
                      {trace.relatedFiles.length > 0 ? trace.relatedFiles.map((f) => f.split('/').pop()).join(', ') : 'Self-contained'}
                    </span>
                  </div>
                  <div className="text-slate-500 truncate" title={trace.relatedSymbols.join(', ')}>
                    Symbols: {trace.relatedSymbols.length > 0 ? trace.relatedSymbols.join(', ') : 'None'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800/80 bg-[#111722] p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter findings by title, rule ID, or file..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as 'All' | Severity)}
          className="px-3 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option value="All">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
          <option value="Suggestion">Suggestion</option>
        </select>

        {!lockedCategory && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'All' | FindingCategory)}
            className="px-3 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="All">All Categories</option>
            <option value="Bug">Bug</option>
            <option value="Architecture">Architecture</option>
            <option value="Security">Security</option>
            <option value="Performance">Performance</option>
            <option value="Maintainability">Maintainability</option>
          </select>
        )}

        {!aiOnly && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'All' | DetectionSource)}
            className="px-3 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="All">All Sources</option>
            <option value="Roslyn Rule">Roslyn Rule</option>
            <option value="Custom Rule">Custom Rule</option>
            <option value="AI Review">AI Review</option>
          </select>
        )}

        <select
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 max-w-[220px] truncate focus:outline-none focus:border-blue-500"
        >
          <option value="All">All Files ({availableFiles.length})</option>
          {availableFiles.map((file) => (
            <option key={file} value={file}>
              {file.split('/').pop()}
            </option>
          ))}
        </select>
      </div>

      {/* Split Issues List & Issue Details */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Issues List */}
        <div className="xl:col-span-5 rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium text-slate-200">Detected Findings</span>
            <span className="font-mono tabular-nums">{scopedFindings.length} item(s)</span>
          </div>

          {scopedFindings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-200">No findings match the current filter</p>
              <p className="text-xs text-slate-400 mt-1">
                Adjust severity, source, or file filters, or run a fresh analysis on modified code.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70 max-h-[760px] overflow-y-auto">
              {scopedFindings.map((finding) => {
                const isSelected = selectedFinding?.id === finding.id;
                return (
                  <button
                    key={finding.id}
                    type="button"
                    onClick={() => setSelectedId(finding.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isSelected ? 'bg-[#1A2332]' : 'hover:bg-[#151D2B]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <SeverityLabel severity={finding.severity} />
                      <span className="text-xs text-slate-400 font-mono tabular-nums">
                        {Math.round(finding.confidence * 100)}% · {finding.detectionSource}
                      </span>
                    </div>

                    <div className="text-sm font-medium text-slate-100 leading-snug mb-1.5">
                      {finding.title}
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span className="font-mono truncate">
                        {finding.filePath}:{finding.lineNumber}
                      </span>
                      <span className="shrink-0">
                        {finding.category}
                        {finding.status !== 'Pending' ? ` · ${finding.status}` : ''}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Issue Details Panel */}
        <div className="xl:col-span-7">
          <IssueDetailsPanel
            finding={selectedFinding}
            changedFile={selectedChangedFile}
            onAccept={onAcceptFinding}
            onReject={onRejectFinding}
            busyFindingId={busyFindingId}
          />
        </div>
      </div>
    </div>
  );
}
