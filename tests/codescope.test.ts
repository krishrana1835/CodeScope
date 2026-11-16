import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { collectGitChanges, getRepositoryInfo, resolveRepositoryRoot } from '../src/server/gitService.ts';
import { buildOrRefreshProjectIndex, selectRelevantContextForChanges } from '../src/server/projectIntelligence.ts';
import { runRoslynStyleAnalysis } from '../src/server/roslynAnalyzer.ts';
import { CodeScopeStorage } from '../src/server/storage.ts';

test('Git change detector identifies staged, unstaged, and untracked files in OrderFlow.Net8', async () => {
  const root = await resolveRepositoryRoot(path.resolve(process.cwd(), 'samples/OrderFlow.Net8'));
  const info = await getRepositoryInfo(root);
  assert.equal(info.branch, 'feat/promo-bulk-checkout');
  assert.equal(info.isClean, false);

  const changes = await collectGitChanges(root, 'changes', ['bin', 'obj', '.git']);
  assert.ok(changes.length >= 3, 'Expected at least 3 modified/staged/untracked files');

  const stagedOnly = await collectGitChanges(root, 'staged', ['bin', 'obj', '.git']);
  assert.ok(stagedOnly.some((c) => c.filePath.endsWith('OrderService.cs') && c.staged));
  assert.ok(!stagedOnly.some((c) => c.filePath.endsWith('PromoValidationClient.cs')));
});

test('Project Intelligence Engine indexes .sln/.csproj and retrieves relevant context', async () => {
  const root = await resolveRepositoryRoot(path.resolve(process.cwd(), 'samples/OrderFlow.Net8'));
  const index = await buildOrRefreshProjectIndex(root, 'feat/promo-bulk-checkout', ['bin', 'obj', '.git'], true);

  assert.equal(index.solutionFile, 'OrderFlow.sln');
  assert.ok(index.projects.length >= 4);
  assert.ok(index.symbols.some((s) => s.symbolName === 'OrderService' && s.layer === 'BusinessLogic'));
  assert.ok(index.symbols.some((s) => s.symbolName === 'OrdersController' && s.layer === 'API'));

  const changes = await collectGitChanges(root, 'changes', ['bin', 'obj', '.git']);
  const { contextBlocks, trace } = await selectRelevantContextForChanges(root, changes, index);
  assert.ok(contextBlocks.length > 0, 'Expected retrieved interface/DTO context blocks');
  assert.ok(trace.length > 0);

  // Verify incremental refresh hits cache
  const incremental = await buildOrRefreshProjectIndex(root, 'feat/promo-bulk-checkout', ['bin', 'obj', '.git'], false);
  assert.equal(incremental.incrementalStats?.reindexedFiles, 0);
});

test('Roslyn-style analyzer detects null risks, async blocking, SQLi, resource leaks, and architecture violations', async () => {
  const root = await resolveRepositoryRoot(path.resolve(process.cwd(), 'samples/OrderFlow.Net8'));
  const index = await buildOrRefreshProjectIndex(root, 'feat/promo-bulk-checkout', ['bin', 'obj', '.git'], false);
  const changes = await collectGitChanges(root, 'changes', ['bin', 'obj', '.git']);

  const findings = runRoslynStyleAnalysis('test-session-1', changes, index);
  const ruleIds = new Set(findings.map((f) => f.ruleId));

  assert.ok(ruleIds.has('CS-ARCH-001'), 'Expected Controller->DataAccess architectural rule violation');
  assert.ok(ruleIds.has('CS-NULL-001'), 'Expected null dereference diagnostic');
  assert.ok(ruleIds.has('CS-ASYNC-001'), 'Expected async blocking diagnostic');
  assert.ok(ruleIds.has('CS-RES-001'), 'Expected HttpClient resource leak diagnostic');
  assert.ok(ruleIds.has('CS-SEC-001'), 'Expected SQL interpolation injection diagnostic');
  assert.ok(ruleIds.has('CS-PERF-001'), 'Expected LINQ Count() > 0 diagnostic');
});

test('SQLite storage persists review sessions and never exposes API keys', () => {
  const memDb = new CodeScopeStorage(':memory:');
  const providers = memDb.listProviderConfigs();
  assert.ok(providers.length >= 2);
  for (const p of providers) {
    assert.equal('apiKey' in p, false);
  }

  const proj = memDb.upsertProject({
    name: 'TestProject',
    rootPath: '/tmp/test-repo',
    solutionFile: 'Test.sln',
    branch: 'main',
  });

  memDb.saveReviewSession({
    id: 'sess-1',
    projectId: proj.id,
    projectName: 'TestProject',
    rootPath: '/tmp/test-repo',
    mode: 'changes',
    noAi: true,
    branch: 'main',
    totalFiles: 1,
    totalFindings: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    suggestionCount: 0,
    durationMs: 42,
    aiProvider: 'Disabled (--no-ai)',
    aiModel: 'None',
    summary: 'Clean',
    createdAt: new Date().toISOString(),
    changedFiles: [],
    findings: [],
    contextTrace: [],
  });

  const sessions = memDb.listReviewSessions(10);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'sess-1');
});
