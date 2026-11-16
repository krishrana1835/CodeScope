import { FileDiff, FilePlus2, FileWarning, FileX2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GitChange } from '../types.ts';
import { MonacoDiffPane } from './MonacoDiffPane.tsx';

interface ChangedFilesViewProps {
  changedFiles: GitChange[];
}

export function ChangedFilesView({ changedFiles }: ChangedFilesViewProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);

  const selectedFile = useMemo(() => {
    if (selectedPath) {
      const found = changedFiles.find((f) => f.filePath === selectedPath);
      if (found) return found;
    }
    return changedFiles[0] ?? null;
  }, [changedFiles, selectedPath]);

  const iconForKind = (kind: GitChange['changeKind']) => {
    switch (kind) {
      case 'Added':
      case 'Untracked':
        return <FilePlus2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'Deleted':
        return <FileX2 className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'Renamed':
        return <FileWarning className="w-4 h-4 text-amber-300 shrink-0" />;
      default:
        return <FileDiff className="w-4 h-4 text-blue-400 shrink-0" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight">Changed Files</h2>
          <p className="text-sm text-slate-400 mt-1">
            Inspect staged, unstaged, added, deleted, and untracked Git changes in Monaco Diff Editor.
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-400">
          {changedFiles.length} file(s) in current scope
        </span>
      </div>

      {changedFiles.length === 0 ? (
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] p-12 text-center">
          <p className="text-sm font-medium text-slate-200">No modified files detected</p>
          <p className="text-xs text-slate-400 mt-1">
            Switch the analysis scope to Full Solution in the top toolbar to inspect every tracked source file.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* File List */}
          <div className="xl:col-span-4 rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800/80 text-xs font-medium text-slate-300">
              Git Working Tree & Index
            </div>
            <div className="divide-y divide-slate-800/70 max-h-[640px] overflow-y-auto">
              {changedFiles.map((file) => {
                const active = selectedFile?.filePath === file.filePath;
                const stateLabels = [
                  file.changeKind,
                  file.staged ? 'Staged' : null,
                  file.unstaged ? 'Unstaged' : null,
                ].filter(Boolean);

                return (
                  <button
                    key={file.filePath}
                    type="button"
                    onClick={() => setSelectedPath(file.filePath)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      active ? 'bg-[#1A2332]' : 'hover:bg-[#151D2B]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {iconForKind(file.changeKind)}
                      <span className="text-xs font-mono text-slate-100 truncate">{file.filePath}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 pl-6 text-xs text-slate-400">
                      <span>{stateLabels.join(' · ')}</span>
                      <span className="font-mono tabular-nums">
                        <span className="text-emerald-400">+{file.additions}</span>{' '}
                        <span className="text-rose-400">-{file.deletions}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side-by-Side Diff */}
          <div className="xl:col-span-8 rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
            {selectedFile && (
              <>
                <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-200 truncate">{selectedFile.filePath}</div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                      Original (HEAD) vs Modified (Working Tree) · {selectedFile.lineCount} lines
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSideBySide((s) => !s)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    {sideBySide ? 'Inline Diff' : 'Side-by-Side Diff'}
                  </button>
                </div>
                <div className="p-4">
                  <MonacoDiffPane
                    original={selectedFile.originalContent}
                    modified={selectedFile.modifiedContent}
                    filePath={selectedFile.filePath}
                    height="560px"
                    renderSideBySide={sideBySide}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
