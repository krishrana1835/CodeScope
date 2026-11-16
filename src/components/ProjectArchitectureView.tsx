import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ArchitecturalLayer, ProjectIndexSummary } from '../types.ts';

interface ProjectArchitectureViewProps {
  index: ProjectIndexSummary | null;
  onRefreshIndex: (forceFull: boolean) => Promise<void>;
  refreshing: boolean;
}

export function ProjectArchitectureView({
  index,
  onRefreshIndex,
  refreshing,
}: ProjectArchitectureViewProps) {
  const [layerFilter, setLayerFilter] = useState<'All' | ArchitecturalLayer>('All');

  const uniqueProjects = useMemo(() => {
    if (!index) return [];
    const map = new Map<string, { name: string; tfm: string; sdk: string; refs: string[] }>();
    for (const edge of index.projects) {
      const existing = map.get(edge.sourceProject) ?? {
        name: edge.sourceProject,
        tfm: edge.targetFramework,
        sdk: edge.sdk,
        refs: [],
      };
      if (edge.targetProject !== '(none)' && !existing.refs.includes(edge.targetProject)) {
        existing.refs.push(edge.targetProject);
      }
      map.set(edge.sourceProject, existing);
    }
    return Array.from(map.values());
  }, [index]);

  const filteredSymbols = useMemo(() => {
    if (!index) return [];
    if (layerFilter === 'All') return index.symbols;
    return index.symbols.filter((s) => s.layer === layerFilter);
  }, [index, layerFilter]);

  if (!index) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-[#111722] p-12 text-center">
        <p className="text-sm text-slate-300">Project intelligence index is not initialized yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight">Project Architecture</h2>
          <p className="text-sm text-slate-400 mt-1">
            Persistent SQLite knowledge index of solution projects, namespaces, symbols, and DI dependencies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => onRefreshIndex(false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Incremental Refresh
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => onRefreshIndex(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            Rebuild Full Index
          </button>
        </div>
      </div>

      {/* Index Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] px-4 py-3.5">
          <div className="text-xs text-slate-400">Solution / Repository</div>
          <div className="text-base font-semibold text-slate-100 mt-1 truncate" title={index.solutionFile ?? index.name}>
            {index.solutionFile ?? index.name}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] px-4 py-3.5">
          <div className="text-xs text-slate-400">Projects Discovered</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
            {uniqueProjects.length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] px-4 py-3.5">
          <div className="text-xs text-slate-400">Indexed Source Files</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
            {index.fileCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#111722] px-4 py-3.5">
          <div className="text-xs text-slate-400">Indexed Symbols</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-blue-400 mt-1">
            {index.symbolCount}
          </div>
        </div>
      </div>

      {/* Project Reference Graph Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Solution Project Reference Graph</h3>
          {index.incrementalStats && (
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Last scan: {index.incrementalStats.reindexedFiles} re-indexed · {index.incrementalStats.cachedFiles} cached
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800/80 text-slate-400 bg-[#0B0F17]/60">
              <tr>
                <th className="py-2.5 px-5 font-medium">Project</th>
                <th className="py-2.5 px-5 font-medium">Target Framework</th>
                <th className="py-2.5 px-5 font-medium">SDK</th>
                <th className="py-2.5 px-5 font-medium">Project References</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {uniqueProjects.map((proj) => (
                <tr key={proj.name} className="hover:bg-[#151D2B]">
                  <td className="py-3 px-5 font-mono font-medium text-slate-100">{proj.name}</td>
                  <td className="py-3 px-5 font-mono text-slate-300">{proj.tfm}</td>
                  <td className="py-3 px-5 font-mono text-slate-400">{proj.sdk}</td>
                  <td className="py-3 px-5 font-mono text-slate-300">
                    {proj.refs.length > 0 ? proj.refs.join(', ') : 'None (Leaf Contracts)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Symbol & DI Registry Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">Indexed Types, Layers & DI Dependencies</h3>
          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-lg border border-slate-800">
            {(['All', 'API', 'BusinessLogic', 'DataAccess', 'Contracts'] as const).map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => setLayerFilter(layer)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  layerFilter === layer ? 'bg-[#1A2332] text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {layer}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800/80 text-slate-400 bg-[#0B0F17]/60">
              <tr>
                <th className="py-2.5 px-5 font-medium">Symbol</th>
                <th className="py-2.5 px-5 font-medium">Kind & Layer</th>
                <th className="py-2.5 px-5 font-medium">Namespace</th>
                <th className="py-2.5 px-5 font-medium">Base / Interfaces</th>
                <th className="py-2.5 px-5 font-medium">Injected Dependencies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredSymbols.map((sym, idx) => (
                <tr key={`${sym.filePath}-${sym.symbolName}-${idx}`} className="hover:bg-[#151D2B]">
                  <td className="py-3 px-5">
                    <div className="font-mono font-medium text-slate-100">{sym.symbolName}</div>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">{sym.filePath}</div>
                  </td>
                  <td className="py-3 px-5 text-slate-300 whitespace-nowrap">
                    {sym.symbolKind} · {sym.layer}
                  </td>
                  <td className="py-3 px-5 font-mono text-slate-400">{sym.namespace}</td>
                  <td className="py-3 px-5 font-mono text-slate-300">
                    {sym.baseTypes.length > 0 ? sym.baseTypes.join(', ') : '—'}
                  </td>
                  <td className="py-3 px-5 font-mono text-slate-300">
                    {sym.dependencies.length > 0
                      ? sym.dependencies.join(', ')
                      : sym.diRegistrations.length > 0
                        ? `Registers: ${sym.diRegistrations.join(', ')}`
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
