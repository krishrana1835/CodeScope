import 'dotenv/config';
import express from 'express';
import JSZip from 'jszip';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { resolveAIProvider } from './src/server/aiReviewer.ts';
import { getDotNet8SolutionFiles } from './src/server/dotnetBlueprint.ts';
import {
  applySuggestionToFile,
  getRepositoryInfo,
  listBranches,
  resolveRepositoryRoot,
} from './src/server/gitService.ts';
import { buildOrRefreshProjectIndex } from './src/server/projectIntelligence.ts';
import { executeCliCommand, runCheckPipeline } from './src/server/reviewEngine.ts';
import { storage } from './src/server/storage.ts';
import type { CheckMode } from './src/server/types.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '5mb' }));

  // 1. Repository status & branches
  app.get('/api/repo/status', async (req, res) => {
    try {
      const repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath : undefined;
      const root = await resolveRepositoryRoot(repoPath);
      const info = await getRepositoryInfo(root);
      const branches = await listBranches(root);
      const provider = storage.getDefaultProvider();
      const index = await buildOrRefreshProjectIndex(root, info.branch, provider.excludedDirs, false);
      res.json({ info, branches, index });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to inspect repository.' });
    }
  });

  // 2. Initialize or refresh project intelligence index
  app.post('/api/init', async (req, res) => {
    try {
      const { repoPath, force } = (req.body ?? {}) as { repoPath?: string; force?: boolean };
      const root = await resolveRepositoryRoot(repoPath);
      const info = await getRepositoryInfo(root);
      const provider = storage.getDefaultProvider();
      const index = await buildOrRefreshProjectIndex(root, info.branch, provider.excludedDirs, Boolean(force));
      res.json({ info, index });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Initialization failed.' });
    }
  });

  // 3. Run CodeScope check pipeline
  app.post('/api/check', async (req, res) => {
    try {
      const { repoPath, mode, noAi, baseBranch, providerId } = (req.body ?? {}) as {
        repoPath?: string;
        mode?: CheckMode;
        noAi?: boolean;
        baseBranch?: string;
        providerId?: string;
      };
      const session = await runCheckPipeline({ repoPath, mode, noAi, baseBranch, providerId });
      res.json(session);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'CodeScope check failed.' });
    }
  });

  // 4. Review history
  app.get('/api/sessions', (_req, res) => {
    res.json(storage.listReviewSessions(30));
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = storage.getReviewSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Review session not found.' });
      return;
    }
    res.json(session);
  });

  // 5. Explicit Accept / Reject actions on findings
  app.post('/api/findings/:id/apply', async (req, res) => {
    try {
      const record = storage.getFindingById(req.params.id);
      if (!record) {
        res.status(404).json({ error: 'Finding not found.' });
        return;
      }
      const { finding, rootPath } = record;
      const result = await applySuggestionToFile(
        rootPath,
        finding.filePath,
        finding.originalCode,
        finding.suggestedCode,
        finding.lineNumber
      );
      storage.updateFindingStatus(finding.id, 'Accepted');
      res.json({ status: 'Accepted', ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to apply suggestion.' });
    }
  });

  app.post('/api/findings/:id/reject', (req, res) => {
    const record = storage.getFindingById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Finding not found.' });
      return;
    }
    storage.updateFindingStatus(req.params.id, 'Rejected');
    res.json({ status: 'Rejected', message: 'Suggestion rejected. Original source code preserved.' });
  });

  // 6. Project Intelligence Explorer
  app.get('/api/project-index', async (req, res) => {
    try {
      const repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath : undefined;
      const root = await resolveRepositoryRoot(repoPath);
      const info = await getRepositoryInfo(root);
      const provider = storage.getDefaultProvider();
      const index = await buildOrRefreshProjectIndex(root, info.branch, provider.excludedDirs, false);
      res.json(index);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load project index.' });
    }
  });

  // 7. Provider configuration (no API keys stored or exposed)
  app.get('/api/providers', (_req, res) => {
    res.json(storage.listProviderConfigs());
  });

  app.put('/api/providers/:id', (req, res) => {
    const updated = storage.updateProviderConfig({
      id: req.params.id,
      ...(req.body ?? {}),
    });
    res.json(updated);
  });

  app.post('/api/providers/:id/test', async (req, res) => {
    const providers = storage.listProviderConfigs();
    const target = providers.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ ok: false, latencyMs: 0, message: 'Provider not found.' });
      return;
    }
    const adapter = resolveAIProvider(target);
    const result = await adapter.testConnection(target);
    res.json(result);
  });

  // 8. CLI Runner
  app.post('/api/cli', async (req, res) => {
    const { command, repoPath } = (req.body ?? {}) as { command?: string; repoPath?: string };
    const result = await executeCliCommand(command ?? 'codescope check', repoPath);
    res.json(result);
  });

  // 9. .NET 8 Modular Solution Files & Zip Export
  app.get('/api/dotnet-solution', (_req, res) => {
    res.json(getDotNet8SolutionFiles());
  });

  app.get('/api/dotnet-solution/download', async (_req, res) => {
    const zip = new JSZip();
    for (const file of getDotNet8SolutionFiles()) {
      zip.file(file.path, file.content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CodeScope-DotNet8.zip"');
    res.send(buffer);
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CodeScope local server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CodeScope server:', err);
  process.exit(1);
});
