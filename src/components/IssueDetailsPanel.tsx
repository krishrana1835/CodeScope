import { Check, Copy, ExternalLink, FileCode2, X } from 'lucide-react';
import { useState } from 'react';
import type { Finding, GitChange } from '../types.ts';
import { MonacoCodePane, MonacoDiffPane } from './MonacoDiffPane.tsx';
import { SeverityLabel } from './SeverityText.tsx';

interface IssueDetailsPanelProps {
  finding: Finding | null;
  changedFile?: GitChange;
  onAccept: (finding: Finding) => Promise<void>;
  onReject: (finding: Finding) => Promise<void>;
  busyFindingId: string | null;
}

export function IssueDetailsPanel({
  finding,
  changedFile,
  onAccept,
  onReject,
  busyFindingId,
}: IssueDetailsPanelProps) {
  const [viewMode, setViewMode] = useState<'diff' | 'full-file'>('diff');
  const [sideBySide, setSideBySide] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!finding) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] rounded-xl border border-slate-800/80 bg-[#111722] p-8 text-center">
        <FileCode2 className="w-9 h-9 text-slate-500 mb-3" />
        <p className="text-sm font-medium text-slate-200">Select an issue to inspect</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Choose any Roslyn diagnostic, architectural rule violation, or AI contextual finding from the list to inspect the evidence and Monaco diff.
        </p>
      </div>
    );
  }

  const isBusy = busyFindingId === finding.id;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(finding.suggestedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-800/80 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-1.5">
              <SeverityLabel severity={finding.severity} />
              <span aria-hidden="true">·</span>
              <span>{finding.category}</span>
              <span aria-hidden="true">·</span>
              <span>{finding.detectionSource}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-300">{finding.ruleId}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300">
                Confidence {Math.round(finding.confidence * 100)}%
              </span>
            </div>
            <h3 className="text-base font-semibold text-slate-100 leading-snug">{finding.title}</h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {finding.status === 'Accepted' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
                <Check className="w-3.5 h-3.5" />
                Applied to File
              </span>
            ) : finding.status === 'Rejected' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
                <X className="w-3.5 h-3.5" />
                Rejected
              </span>
            ) : null}
          </div>
        </div>

        {/* File + Line Navigation + Developer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'diff' ? 'full-file' : 'diff')}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors truncate max-w-full"
            title="Toggle full file view positioned at this line"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {finding.filePath}:{finding.lineNumber}
            </span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Suggested Code'}
            </button>

            <button
              type="button"
              disabled={isBusy || finding.status === 'Rejected'}
              onClick={() => onReject(finding)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>

            <button
              type="button"
              disabled={isBusy || finding.status === 'Accepted'}
              onClick={() => onAccept(finding)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              {isBusy ? 'Applying...' : finding.status === 'Accepted' ? 'Accepted' : 'Accept Suggestion'}
            </button>
          </div>
        </div>
      </div>

      {/* Monaco Diff / Full-File Viewer */}
      <div className="p-5 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('diff')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'diff' ? 'bg-[#1A2332] text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Suggested Diff
            </button>
            <button
              type="button"
              onClick={() => setViewMode('full-file')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'full-file' ? 'bg-[#1A2332] text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Full File (Line {finding.lineNumber})
            </button>
          </div>

          {viewMode === 'diff' && (
            <button
              type="button"
              onClick={() => setSideBySide((v) => !v)}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
            >
              {sideBySide ? 'Switch to Inline Diff' : 'Switch to Side-by-Side Diff'}
            </button>
          )}
        </div>

        {viewMode === 'diff' ? (
          <MonacoDiffPane
            original={finding.originalCode}
            modified={finding.suggestedCode}
            filePath={finding.filePath}
            height="250px"
            renderSideBySide={sideBySide}
          />
        ) : (
          <MonacoCodePane
            code={changedFile?.modifiedContent || finding.originalCode}
            filePath={finding.filePath}
            highlightLine={finding.lineNumber}
            height="280px"
          />
        )}
      </div>

      {/* 10-Point Detailed Engineering Analysis */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 text-sm">
        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Exact Problem & Explanation</h4>
          <p className="text-slate-200 leading-relaxed">{finding.description}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Why This Is a Problem</h4>
          <p className="text-slate-300 leading-relaxed">{finding.reason}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Trigger Conditions</h4>
          <p className="text-slate-300 leading-relaxed">{finding.conditions}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Potential Impact</h4>
          <p className="text-slate-300 leading-relaxed">{finding.impact}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Recommended Solution</h4>
          <p className="text-slate-200 leading-relaxed">{finding.suggestion}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-1">Supporting Evidence</h4>
          <p className="text-slate-300 leading-relaxed font-mono text-xs bg-[#0B0F17] p-3 rounded-lg border border-slate-800/80">
            {finding.evidence}
          </p>
        </div>
      </div>
    </div>
  );
}
