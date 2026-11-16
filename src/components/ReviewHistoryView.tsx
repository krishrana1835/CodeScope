import { ArrowRight } from 'lucide-react';
import type { ReviewSessionSummary } from '../types.ts';

interface ReviewHistoryViewProps {
  sessions: ReviewSessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => Promise<void>;
}

export function ReviewHistoryView({
  sessions,
  activeSessionId,
  onSelectSession,
}: ReviewHistoryViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100 tracking-tight">Review History</h2>
        <p className="text-sm text-slate-400 mt-1">
          Persistent local SQLite audit log of previous CodeScope review runs. Select any session to inspect its findings.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800/80 bg-[#111722] overflow-hidden">
        {sessions.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-300">No review sessions persisted yet.</p>
            <p className="text-xs text-slate-500 mt-1">Run CodeScope Check to record your first review session.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800/80 text-slate-400 bg-[#0B0F17]/60">
                <tr>
                  <th className="py-3 px-5 font-medium">Timestamp</th>
                  <th className="py-3 px-5 font-medium">Project & Branch</th>
                  <th className="py-3 px-5 font-medium">Mode</th>
                  <th className="py-3 px-5 font-medium text-right">Files</th>
                  <th className="py-3 px-5 font-medium text-right">Critical</th>
                  <th className="py-3 px-5 font-medium text-right">High</th>
                  <th className="py-3 px-5 font-medium text-right">Total</th>
                  <th className="py-3 px-5 font-medium text-right">Duration</th>
                  <th className="py-3 px-5 font-medium">AI Provider / Model</th>
                  <th className="py-3 px-5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {sessions.map((s) => {
                  const isCurrent = s.id === activeSessionId;
                  return (
                    <tr
                      key={s.id}
                      className={`transition-colors ${isCurrent ? 'bg-[#1A2332]' : 'hover:bg-[#151D2B]'}`}
                    >
                      <td className="py-3 px-5 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-5 text-slate-100">
                        {s.projectName} · <span className="font-mono text-slate-400">{s.branch}</span>
                      </td>
                      <td className="py-3 px-5 font-mono text-slate-300">{s.mode}</td>
                      <td className="py-3 px-5 font-mono tabular-nums text-right text-slate-300">{s.totalFiles}</td>
                      <td className="py-3 px-5 font-mono tabular-nums text-right text-rose-400">{s.criticalCount}</td>
                      <td className="py-3 px-5 font-mono tabular-nums text-right text-orange-400">{s.highCount}</td>
                      <td className="py-3 px-5 font-mono tabular-nums text-right text-slate-100 font-medium">
                        {s.totalFindings}
                      </td>
                      <td className="py-3 px-5 font-mono tabular-nums text-right text-slate-400">
                        {s.durationMs}ms
                      </td>
                      <td className="py-3 px-5 text-slate-300">
                        {s.aiProvider} · <span className="font-mono text-slate-400">{s.aiModel}</span>
                      </td>
                      <td className="py-3 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectSession(s.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
                        >
                          {isCurrent ? 'Viewing' : 'Inspect'}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
