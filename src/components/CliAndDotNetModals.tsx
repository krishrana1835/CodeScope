import { Download, Terminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DotNetSolutionFile } from '../types.ts';
import { MonacoCodePane } from './MonacoDiffPane.tsx';

interface CliModalProps {
  open: boolean;
  repoPath: string;
  onClose: () => void;
  onSessionCreated: (sessionId: string) => Promise<void>;
}

const PRESET_COMMANDS = [
  'codescope init',
  'codescope check',
  'codescope check --staged',
  'codescope check --no-ai',
  'codescope check --all',
  'codescope review',
  'codescope refresh',
  'codescope history',
  'codescope config',
];

export function CliModal({ open, repoPath, onClose, onSessionCreated }: CliModalProps) {
  const [command, setCommand] = useState('codescope check');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<Array<{ cmd: string; output: string[] }>>([
    {
      cmd: 'codescope --help',
      output: [
        'CodeScope CLI — Local-first Git + Roslyn + AI code review tool',
        'Select a preset command below or type any codescope subcommand and press Enter.',
      ],
    },
  ]);

  if (!open) return null;

  const runCmd = async (cmdToRun: string) => {
    const trimmed = cmdToRun.trim();
    if (!trimmed || running) return;
    setRunning(true);
    try {
      const res = await fetch('/api/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed, repoPath }),
      });
      const data = (await res.json()) as { exitCode: number; lines: string[]; sessionId?: string };
      setHistory((prev) => [...prev, { cmd: trimmed, output: data.lines }]);
      if (data.sessionId) {
        await onSessionCreated(data.sessionId);
      }
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        { cmd: trimmed, output: [err instanceof Error ? err.message : 'CLI request failed.'] },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-xl border border-slate-800 bg-[#0B0F17] overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
            <Terminal className="w-4 h-4 text-blue-400" />
            CodeScope CLI Runner
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            aria-label="Close CLI Runner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap gap-2 bg-[#111722]">
          {PRESET_COMMANDS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={running}
              onClick={() => {
                setCommand(preset);
                void runCmd(preset);
              }}
              className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-blue-500 transition-colors whitespace-nowrap"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="p-5 h-[360px] overflow-y-auto font-mono text-xs space-y-4 bg-[#080B11]">
          {history.map((entry, idx) => (
            <div key={idx} className="space-y-1">
              <div className="text-blue-400">$ {entry.cmd}</div>
              {entry.output.map((line, i) => (
                <div key={i} className="text-slate-300 whitespace-pre-wrap pl-3">
                  {line}
                </div>
              ))}
            </div>
          ))}
          {running && <div className="text-amber-300">Executing command...</div>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runCmd(command);
          }}
          className="px-5 py-3 border-t border-slate-800 bg-[#111722] flex items-center gap-3"
        >
          <span className="font-mono text-xs text-blue-400 shrink-0">$</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="codescope check --staged"
            className="flex-1 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
          />
          <button
            type="submit"
            disabled={running}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            {running ? 'Running...' : 'Run Command'}
          </button>
        </form>
      </div>
    </div>
  );
}

interface DotNetSolutionModalProps {
  open: boolean;
  onClose: () => void;
}

export function DotNetSolutionModal({ open, onClose }: DotNetSolutionModalProps) {
  const [files, setFiles] = useState<DotNetSolutionFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || files.length > 0) return;
    setLoading(true);
    fetch('/api/dotnet-solution')
      .then((r) => r.json())
      .then((data: DotNetSolutionFile[]) => {
        setFiles(data);
        if (data[0]) setSelectedPath(data[0].path);
      })
      .finally(() => setLoading(false));
  }, [open, files.length]);

  if (!open) return null;

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl rounded-xl border border-slate-800 bg-[#0B0F17] overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              CodeScope .NET 8 Multi-Project C# Solution
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Modular Windows-installable .NET 8 CLI, Roslyn MSBuildWorkspace analyzer, LibGit2Sharp detector, and Windows Credential Manager store.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/api/dotnet-solution/download"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download .NET 8 Solution (.zip)
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              aria-label="Close .NET 8 Solution Explorer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading C# solution files...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 h-[540px]">
            <div className="lg:col-span-4 border-r border-slate-800 overflow-y-auto divide-y divide-slate-800/60 bg-[#111722]">
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    activeFile?.path === f.path ? 'bg-[#1A2332]' : 'hover:bg-[#151D2B]'
                  }`}
                >
                  <div className="text-xs font-mono text-slate-100 truncate">{f.path}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{f.project}</div>
                </button>
              ))}
            </div>
            <div className="lg:col-span-8 p-4 bg-[#0B0F17]">
              {activeFile && (
                <MonacoCodePane
                  code={activeFile.content}
                  filePath={activeFile.path}
                  languageOverride={activeFile.language === 'text' ? 'plaintext' : activeFile.language}
                  height="505px"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
