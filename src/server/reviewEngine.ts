import crypto from 'crypto';
import { resolveAIProvider } from './aiReviewer.ts';
import {
  collectGitChanges,
  getRepositoryInfo,
  resolveRepositoryRoot,
} from './gitService.ts';
import {
  buildOrRefreshProjectIndex,
  selectRelevantContextForChanges,
} from './projectIntelligence.ts';
import { runRoslynStyleAnalysis } from './roslynAnalyzer.ts';
import { storage } from './storage.ts';
import type { CheckMode, Finding, ReviewSession } from './types.ts';

export async function runCheckPipeline(options: {
  repoPath?: string;
  mode?: CheckMode;
  noAi?: boolean;
  baseBranch?: string;
  providerId?: string;
}): Promise<ReviewSession> {
  const startMs = Date.now();
  const mode: CheckMode = options.mode ?? 'changes';
  const noAi = Boolean(options.noAi);

  const repoRoot = await resolveRepositoryRoot(options.repoPath);
  const repoInfo = await getRepositoryInfo(repoRoot);

  const providers = storage.listProviderConfigs();
  const provider =
    (options.providerId ? providers.find((p) => p.id === options.providerId) : undefined) ??
    storage.getDefaultProvider();

  const excludedDirs = provider.excludedDirs;
  const index = await buildOrRefreshProjectIndex(repoRoot, repoInfo.branch, excludedDirs, false);
  const changes = await collectGitChanges(repoRoot, mode, excludedDirs, options.baseBranch ?? 'main');

  const sessionId = crypto.randomUUID();
  const staticFindings = runRoslynStyleAnalysis(sessionId, changes, index);
  const { contextBlocks, trace } = await selectRelevantContextForChanges(repoRoot, changes, index);

  let aiFindings: Finding[] = [];
  let aiSummary = 'Static Roslyn & architectural analysis completed (--no-ai mode).';
  let aiProviderLabel = noAi ? 'Disabled (--no-ai)' : provider.name;
  let aiModelLabel = noAi ? 'None' : provider.modelId;

  if (!noAi && changes.length > 0) {
    const adapter = resolveAIProvider(provider);
    const aiResult = await adapter.reviewChanges({
      sessionId,
      changes,
      index,
      contextBlocks,
      staticFindings,
      provider,
    });
    aiFindings = aiResult.findings;
    aiSummary = aiResult.summary;
    aiProviderLabel = aiResult.providerUsed;
    aiModelLabel = aiResult.modelUsed;
  } else if (changes.length === 0) {
    aiSummary = 'Working tree is clean for the selected scope. No modified files required AI review.';
  }

  const allFindings = [...staticFindings, ...aiFindings];
  const severityOrder: Record<Finding['severity'], number> = {
    Critical: 1,
    High: 2,
    Medium: 3,
    Low: 4,
    Suggestion: 5,
  };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const durationMs = Date.now() - startMs;

  const session: ReviewSession = {
    id: sessionId,
    projectId: index.projectId,
    projectName: index.name,
    rootPath: repoRoot,
    mode,
    noAi,
    branch: repoInfo.branch,
    totalFiles: changes.length,
    totalFindings: allFindings.length,
    criticalCount: allFindings.filter((f) => f.severity === 'Critical').length,
    highCount: allFindings.filter((f) => f.severity === 'High').length,
    mediumCount: allFindings.filter((f) => f.severity === 'Medium').length,
    lowCount: allFindings.filter((f) => f.severity === 'Low').length,
    suggestionCount: allFindings.filter((f) => f.severity === 'Suggestion').length,
    durationMs,
    aiProvider: aiProviderLabel,
    aiModel: aiModelLabel,
    summary: aiSummary,
    createdAt: new Date().toISOString(),
    changedFiles: changes,
    findings: allFindings,
    contextTrace: trace,
  };

  storage.saveReviewSession(session);
  return session;
}

export async function executeCliCommand(commandLine: string, repoPath?: string): Promise<{
  exitCode: number;
  lines: string[];
  sessionId?: string;
}> {
  const parts = commandLine.trim().split(/\s+/).filter(Boolean);
  const normalized = parts[0] === 'codescope' ? parts.slice(1) : parts;
  const sub = normalized[0] ?? 'check';
  const flags = new Set(normalized.slice(1));

  try {
    const repoRoot = await resolveRepositoryRoot(repoPath);
    const repoInfo = await getRepositoryInfo(repoRoot);
    const provider = storage.getDefaultProvider();

    if (sub === 'init' || sub === 'refresh') {
      const force = sub === 'init';
      const index = await buildOrRefreshProjectIndex(repoRoot, repoInfo.branch, provider.excludedDirs, force);
      return {
        exitCode: 0,
        lines: [
          `CodeScope ${sub === 'init' ? 'Initialization' : 'Index Refresh'}`,
          `Repository: ${repoRoot} (${repoInfo.branch} @ ${repoInfo.headCommit})`,
          `Solution: ${index.solutionFile ?? '(directory mode)'}`,
          `Projects discovered: ${new Set(index.projects.map((p) => p.sourceProject)).size}`,
          `Files scanned: ${index.incrementalStats?.scannedFiles ?? index.fileCount} (re-indexed: ${index.incrementalStats?.reindexedFiles ?? index.fileCount}, cached: ${index.incrementalStats?.cachedFiles ?? 0})`,
          `Symbols indexed in SQLite: ${index.symbolCount}`,
          `Status: Project intelligence index persisted to local SQLite store.`,
        ],
      };
    }

    if (sub === 'history') {
      const sessions = storage.listReviewSessions(10);
      if (sessions.length === 0) {
        return { exitCode: 0, lines: ['No review sessions recorded yet. Run `codescope check` first.'] };
      }
      return {
        exitCode: 0,
        lines: [
          'Recent CodeScope Review Sessions:',
          ...sessions.map(
            (s) =>
              `  ${s.createdAt.slice(0, 19).replace('T', ' ')}  [${s.mode}]  ${s.projectName} (${s.branch})  Files:${s.totalFiles}  Findings:${s.totalFindings} (C:${s.criticalCount} H:${s.highCount} M:${s.mediumCount})  ${s.durationMs}ms`
          ),
        ],
      };
    }

    if (sub === 'config') {
      const providers = storage.listProviderConfigs();
      return {
        exitCode: 0,
        lines: [
          'CodeScope Local Provider Configuration:',
          ...providers.map(
            (p) =>
              `  ${p.isDefault ? '*' : ' '} ${p.id.padEnd(18)} ${p.name} | Model: ${p.modelId} | Enabled: ${p.isEnabled} | Credential: ${p.hasServerCredential ? 'Configured (Env/Vault)' : 'Not configured'}`
          ),
          `Excluded directories: ${provider.excludedDirs.join(', ')}`,
        ],
      };
    }

    if (sub === 'check' || sub === 'review') {
      const mode: CheckMode = flags.has('--staged')
        ? 'staged'
        : flags.has('--all')
          ? 'all'
          : 'changes';
      const noAi = flags.has('--no-ai') && sub !== 'review';

      const session = await runCheckPipeline({ repoPath: repoRoot, mode, noAi });
      return {
        exitCode: 0,
        sessionId: session.id,
        lines: [
          `CodeScope Review Complete — ${session.projectName} (${session.branch})`,
          `Scope: ${mode} | AI: ${noAi ? 'Disabled (--no-ai)' : `${session.aiProvider} (${session.aiModel})`}`,
          `Files analyzed: ${session.totalFiles} | Duration: ${session.durationMs}ms`,
          `Findings: ${session.totalFindings} total (Critical: ${session.criticalCount}, High: ${session.highCount}, Medium: ${session.mediumCount}, Low: ${session.lowCount})`,
          `Summary: ${session.summary}`,
          `Dashboard updated with session ${session.id.slice(0, 8)}.`,
        ],
      };
    }

    return {
      exitCode: 1,
      lines: [
        `Unknown command "${sub}". Supported commands:`,
        '  codescope init',
        '  codescope check [--staged | --all | --no-ai]',
        '  codescope review',
        '  codescope refresh',
        '  codescope history',
        '  codescope config',
      ],
    };
  } catch (err) {
    return {
      exitCode: 1,
      lines: [`Error: ${err instanceof Error ? err.message : 'Command execution failed.'}`],
    };
  }
}
