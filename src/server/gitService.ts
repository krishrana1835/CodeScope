import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { ChangeKind, CheckMode, GitChange, GitRepositoryInfo } from './types.ts';

const execFileAsync = promisify(execFile);

const DEFAULT_EXCLUDED = new Set(['bin', 'obj', '.git', 'node_modules', '.vs', 'dist', 'packages']);

export function isExcludedPath(relPath: string, excludedDirs: string[]): boolean {
  const parts = relPath.replace(/\\/g, '/').split('/');
  const merged = new Set([...DEFAULT_EXCLUDED, ...excludedDirs]);
  return parts.some((p) => merged.has(p));
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
    maxBuffer: 15 * 1024 * 1024,
  });
  return stdout;
}

async function safeRunGit(repoPath: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const stdout = await runGit(repoPath, args);
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

export async function resolveRepositoryRoot(requestedPath?: string): Promise<string> {
  const defaultSample = path.resolve(process.cwd(), 'samples/OrderFlow.Net8');
  const candidate = requestedPath && requestedPath.trim().length > 0 ? path.resolve(requestedPath.trim()) : defaultSample;

  const { ok, stdout } = await safeRunGit(candidate, ['rev-parse', '--show-toplevel']);
  if (!ok) {
    throw new Error(`Directory "${candidate}" is not a valid Git repository.`);
  }
  return stdout.trim();
}

export async function getRepositoryInfo(repoRoot: string): Promise<GitRepositoryInfo> {
  const branchRes = await safeRunGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitRes = await safeRunGit(repoRoot, ['rev-parse', '--short', 'HEAD']);
  const msgRes = await safeRunGit(repoRoot, ['log', '-1', '--pretty=%s']);
  const statusRes = await safeRunGit(repoRoot, ['status', '--porcelain=v1']);

  return {
    rootPath: repoRoot,
    branch: branchRes.ok ? branchRes.stdout.trim() : 'HEAD',
    headCommit: commitRes.ok ? commitRes.stdout.trim() : 'uncommitted',
    headMessage: msgRes.ok ? msgRes.stdout.trim() : '',
    isClean: statusRes.ok ? statusRes.stdout.trim().length === 0 : true,
  };
}

export async function listBranches(repoRoot: string): Promise<string[]> {
  const res = await safeRunGit(repoRoot, ['branch', '--format=%(refname:short)']);
  if (!res.ok) return ['main'];
  return res.stdout
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

async function readHeadContent(repoRoot: string, filePath: string): Promise<string> {
  const res = await safeRunGit(repoRoot, ['show', `HEAD:${filePath}`]);
  return res.ok ? res.stdout : '';
}

async function readStagedContent(repoRoot: string, filePath: string): Promise<string> {
  const res = await safeRunGit(repoRoot, ['show', `:${filePath}`]);
  return res.ok ? res.stdout : '';
}

async function readWorkingFile(repoRoot: string, filePath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(repoRoot, filePath), 'utf8');
  } catch {
    return '';
  }
}

function buildSynthesizedAddedDiff(filePath: string, content: string): string {
  const lines = content.split(/\r?\n/);
  const body = lines.map((l) => `+${l}`).join('\n');
  return `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

export async function collectGitChanges(
  repoRoot: string,
  mode: CheckMode,
  excludedDirs: string[],
  baseBranch = 'main'
): Promise<GitChange[]> {
  if (mode === 'all') {
    const trackedOut = await safeRunGit(repoRoot, ['ls-files', '-z']);
    const untrackedOut = await safeRunGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
    const allPaths = Array.from(
      new Set([
        ...trackedOut.stdout.split('\0').filter(Boolean),
        ...untrackedOut.stdout.split('\0').filter(Boolean),
      ])
    ).filter(
      (p) =>
        !isExcludedPath(p, excludedDirs) &&
        /\.(cs|csproj|sln|ts|tsx|js|json|config)$/i.test(p)
    );

    const statusChanges = await collectGitChanges(repoRoot, 'changes', excludedDirs, baseBranch);
    const statusMap = new Map(statusChanges.map((c) => [c.filePath, c]));

    const results: GitChange[] = [];
    for (const filePath of allPaths) {
      const existing = statusMap.get(filePath);
      if (existing) {
        results.push(existing);
        continue;
      }
      const content = await readWorkingFile(repoRoot, filePath);
      results.push({
        filePath,
        changeKind: 'Modified',
        staged: false,
        unstaged: false,
        untracked: false,
        diff: '',
        originalContent: content,
        modifiedContent: content,
        lineCount: content.split(/\r?\n/).length,
        additions: 0,
        deletions: 0,
      });
    }
    return results;
  }

  if (mode === 'branch') {
    const diffNames = await safeRunGit(repoRoot, ['diff', '--name-status', `${baseBranch}...HEAD`]);
    const lines = diffNames.stdout.split(/\r?\n/).filter(Boolean);
    const changes: GitChange[] = [];
    for (const line of lines) {
      const parts = line.split('\t');
      const code = parts[0];
      const filePath = parts[parts.length - 1];
      if (!filePath || isExcludedPath(filePath, excludedDirs)) continue;
      const diffRes = await safeRunGit(repoRoot, ['diff', `${baseBranch}...HEAD`, '--', filePath]);
      const originalContent = (await safeRunGit(repoRoot, ['show', `${baseBranch}:${filePath}`])).stdout;
      const modifiedContent = await readWorkingFile(repoRoot, filePath);
      const { additions, deletions } = countDiffStats(diffRes.stdout);
      const changeKind: ChangeKind = code.startsWith('A')
        ? 'Added'
        : code.startsWith('D')
          ? 'Deleted'
          : code.startsWith('R')
            ? 'Renamed'
            : 'Modified';
      changes.push({
        filePath,
        changeKind,
        staged: false,
        unstaged: false,
        untracked: false,
        diff: diffRes.stdout,
        originalContent,
        modifiedContent,
        lineCount: modifiedContent.split(/\r?\n/).length,
        additions,
        deletions,
      });
    }
    return changes;
  }

  const porcelain = await runGit(repoRoot, ['status', '--porcelain=v1', '-z']);
  const tokens = porcelain.split('\0').filter((t) => t.length > 0);
  const changes: GitChange[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    let filePath = entry.slice(3);
    let previousPath: string | undefined;

    if (x === 'R' || y === 'R') {
      previousPath = tokens[i + 1];
      i++;
    }

    if (isExcludedPath(filePath, excludedDirs)) continue;

    const isUntracked = x === '?' && y === '?';
    const isStaged = x !== ' ' && x !== '?';
    const isUnstaged = y !== ' ' && y !== '?';

    if (mode === 'staged' && !isStaged) continue;

    let changeKind: ChangeKind = 'Modified';
    if (isUntracked) changeKind = 'Untracked';
    else if (x === 'A' || y === 'A') changeKind = 'Added';
    else if (x === 'D' || y === 'D') changeKind = 'Deleted';
    else if (x === 'R' || y === 'R') changeKind = 'Renamed';

    let diff = '';
    let originalContent = '';
    let modifiedContent = '';

    if (isUntracked) {
      modifiedContent = await readWorkingFile(repoRoot, filePath);
      diff = buildSynthesizedAddedDiff(filePath, modifiedContent);
    } else if (mode === 'staged') {
      originalContent = await readHeadContent(repoRoot, previousPath ?? filePath);
      modifiedContent = await readStagedContent(repoRoot, filePath);
      diff = (await safeRunGit(repoRoot, ['diff', '--cached', '--', filePath])).stdout;
    } else {
      originalContent = await readHeadContent(repoRoot, previousPath ?? filePath);
      modifiedContent = changeKind === 'Deleted' ? '' : await readWorkingFile(repoRoot, filePath);
      const stagedDiff = isStaged ? (await safeRunGit(repoRoot, ['diff', '--cached', '--', filePath])).stdout : '';
      const unstagedDiff = isUnstaged ? (await safeRunGit(repoRoot, ['diff', '--', filePath])).stdout : '';
      diff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n');
    }

    const stats = countDiffStats(diff);
    changes.push({
      filePath,
      previousPath,
      changeKind,
      staged: isStaged,
      unstaged: isUnstaged,
      untracked: isUntracked,
      diff,
      originalContent,
      modifiedContent,
      lineCount: modifiedContent ? modifiedContent.split(/\r?\n/).length : 0,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  return changes;
}

export async function applySuggestionToFile(
  repoRoot: string,
  filePath: string,
  originalCode: string,
  suggestedCode: string,
  lineNumber: number
): Promise<{ applied: boolean; updatedContent: string; message: string }> {
  const resolvedRoot = path.resolve(repoRoot);
  const fullPath = path.resolve(resolvedRoot, filePath);
  if (!fullPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Invalid file path outside repository root.');
  }

  const currentContent = await fs.readFile(fullPath, 'utf8');
  const trimmedOrig = originalCode.trim();

  if (trimmedOrig.length > 0 && currentContent.includes(trimmedOrig)) {
    const updatedContent = currentContent.replace(trimmedOrig, suggestedCode.trim());
    await fs.writeFile(fullPath, updatedContent, 'utf8');
    return { applied: true, updatedContent, message: `Applied suggested fix to ${filePath}.` };
  }

  const lines = currentContent.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
  const origLines = trimmedOrig.split(/\r?\n/);
  const targetLine = lines[idx] ?? '';
  if (origLines.length === 1 && targetLine.includes(trimmedOrig)) {
    lines[idx] = targetLine.replace(trimmedOrig, suggestedCode.trim());
    const updatedContent = lines.join('\n');
    await fs.writeFile(fullPath, updatedContent, 'utf8');
    return { applied: true, updatedContent, message: `Applied line-level fix at ${filePath}:${lineNumber}.` };
  }

  throw new Error(
    `Could not safely locate exact original code block in ${filePath} around line ${lineNumber}. The file may have been edited since analysis.`
  );
}
