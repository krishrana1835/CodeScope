import { AlertCircle, AlertTriangle, Info, ShieldAlert, Sparkles } from 'lucide-react';
import type { Severity } from '../types.ts';

export function SeverityLabel({ severity }: { severity: Severity }) {
  switch (severity) {
    case 'Critical':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap shrink-0">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          Critical
        </span>
      );
    case 'High':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          High
        </span>
      );
    case 'Medium':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 whitespace-nowrap shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Medium
        </span>
      );
    case 'Low':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 whitespace-nowrap shrink-0">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Low
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          Suggestion
        </span>
      );
  }
}
