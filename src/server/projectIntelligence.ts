import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { isExcludedPath } from './gitService.ts';
import { storage } from './storage.ts';
import type {
  ArchitecturalLayer,
  GitChange,
  ProjectIndexSummary,
  ProjectReferenceEdge,
  ProjectSymbol,
  ReviewContextArtifact,
} from './types.ts';

async function walkFiles(dir: string, root: string, excludedDirs: string[]): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (isExcludedPath(relPath, excludedDirs)) continue;

    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath, root, excludedDirs)));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function classifyLayer(filePath: string, namespace: string, symbolName: string, baseTypes: string[]): ArchitecturalLayer {
  const combined = `${filePath} ${namespace} ${symbolName} ${baseTypes.join(' ')}`.toLowerCase();
  if (combined.includes('test')) return 'Tests';
  if (combined.includes('controller') || combined.includes('.api')) return 'API';
  if (combined.includes('repository') || combined.includes('dataaccess') || combined.includes('dbcontext')) return 'DataAccess';
  if (combined.includes('contracts') || combined.includes('dto') || symbolName.startsWith('I') && /^I[A-Z]/.test(symbolName)) {
    return combined.includes('contracts') || combined.includes('dto') ? 'Contracts' : 'BusinessLogic';
  }
  if (combined.includes('businesslogic') || combined.includes('service')) return 'BusinessLogic';
  if (combined.includes('infrastructure')) return 'Infrastructure';
  return 'Unknown';
}

function extractCSharpSymbols(
  projectId: number,
  filePath: string,
  projectName: string,
  content: string,
  contentHash: string
): ProjectSymbol[] {
  const now = new Date().toISOString();
  const nsMatch = content.match(/namespace\s+([A-Za-z0-9_.]+)/);
  const namespace = nsMatch ? nsMatch[1] : projectName;

  const diRegistrations: string[] = [];
  const diRegex = /Add(?:Scoped|Transient|Singleton)\s*<([^>]+)>/g;
  let diMatch: RegExpExecArray | null;
  while ((diMatch = diRegex.exec(content)) !== null) {
    diRegistrations.push(diMatch[1].trim());
  }

  const typeRegex =
    /(?:public|internal|private|protected)?\s*(?:sealed|abstract|static|partial)?\s*(class|interface|record|struct|enum)\s+([A-Za-z0-9_]+)(?:\s*\([^)]*\))?(?:\s*:\s*([^{\n;]+))?/g;
  const symbols: ProjectSymbol[] = [];
  let match: RegExpExecArray | null;

  while ((match = typeRegex.exec(content)) !== null) {
    const symbolKind = match[1] as ProjectSymbol['symbolKind'];
    const symbolName = match[2];
    const baseClause = match[3] ?? '';
    const baseTypes = baseClause
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('where '));

    const ctorRegex = new RegExp(`public\\s+${symbolName}\\s*\\(([^)]*)\\)`, 'm');
    const ctorMatch = content.match(ctorRegex);
    const dependencies: string[] = [];
    if (ctorMatch && ctorMatch[1].trim()) {
      for (const param of ctorMatch[1].split(',')) {
        const tokens = param.trim().split(/\s+/);
        if (tokens.length >= 2) {
          dependencies.push(tokens[tokens.length - 2].replace(/\?$/, ''));
        }
      }
    }

    const methodRegex = /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?[A-Za-z0-9_<>,?\[\]\s]+\s+([A-Za-z0-9_]+)\s*\(/g;
    const methods: string[] = [];
    let mMatch: RegExpExecArray | null;
    while ((mMatch = methodRegex.exec(content)) !== null) {
      const mName = mMatch[1];
      if (mName !== symbolName && !['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using'].includes(mName)) {
        if (!methods.includes(mName)) methods.push(mName);
      }
    }

    symbols.push({
      projectId,
      filePath,
      projectName,
      namespace,
      symbolName,
      symbolKind,
      layer: classifyLayer(filePath, namespace, symbolName, baseTypes),
      baseTypes,
      dependencies,
      diRegistrations,
      methods: methods.slice(0, 20),
      contentHash,
      updatedAt: now,
    });
  }

  if (symbols.length === 0 && (diRegistrations.length > 0 || filePath.endsWith('Program.cs'))) {
    symbols.push({
      projectId,
      filePath,
      projectName,
      namespace,
      symbolName: path.basename(filePath, '.cs'),
      symbolKind: 'program',
      layer: classifyLayer(filePath, namespace, 'Program', []),
      baseTypes: [],
      dependencies: [],
      diRegistrations,
      methods: [],
      contentHash,
      updatedAt: now,
    });
  }

  return symbols;
}

function extractTsSymbols(
  projectId: number,
  filePath: string,
  projectName: string,
  content: string,
  contentHash: string
): ProjectSymbol[] {
  const now = new Date().toISOString();
  const symbols: ProjectSymbol[] = [];
  const regex = /export\s+(?:default\s+)?(?:async\s+)?(class|interface|function|type)\s+([A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const kind = match[1] === 'interface' ? 'interface' : 'class';
    symbols.push({
      projectId,
      filePath,
      projectName,
      namespace: path.dirname(filePath),
      symbolName: match[2],
      symbolKind: kind,
      layer: filePath.includes('server') ? 'API' : 'Infrastructure',
      baseTypes: [],
      dependencies: [],
      diRegistrations: [],
      methods: [],
      contentHash,
      updatedAt: now,
    });
  }
  return symbols;
}

export async function buildOrRefreshProjectIndex(
  repoRoot: string,
  branch: string,
  excludedDirs: string[],
  forceFull = false
): Promise<ProjectIndexSummary> {
  const allFiles = await walkFiles(repoRoot, repoRoot, excludedDirs);
  const slnFile = allFiles.find((f) => f.endsWith('.sln')) ?? null;
  const csprojFiles = allFiles.filter((f) => f.endsWith('.csproj'));
  const projectName = slnFile ? path.basename(slnFile, '.sln') : path.basename(repoRoot);

  const projectRecord = storage.upsertProject({
    name: projectName,
    rootPath: repoRoot,
    solutionFile: slnFile,
    branch,
    excludedDirs,
  });

  // Parse .csproj project references
  const projectEdges: ProjectReferenceEdge[] = [];
  const projectDirToName = new Map<string, string>();
  for (const csproj of csprojFiles) {
    const projName = path.basename(csproj, '.csproj');
    const projDir = path.dirname(csproj).replace(/\\/g, '/');
    projectDirToName.set(projDir, projName);

    const xml = await fs.readFile(path.join(repoRoot, csproj), 'utf8');
    const sdkMatch = xml.match(/Sdk="([^"]+)"/);
    const tfmMatch = xml.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    const sdk = sdkMatch ? sdkMatch[1] : 'Microsoft.NET.Sdk';
    const tfm = tfmMatch ? tfmMatch[1] : 'net8.0';

    const refRegex = /<ProjectReference\s+Include="([^"]+)"/g;
    let refMatch: RegExpExecArray | null;
    let hasRefs = false;
    while ((refMatch = refRegex.exec(xml)) !== null) {
      hasRefs = true;
      const targetName = path.basename(refMatch[1].replace(/\\/g, '/'), '.csproj');
      projectEdges.push({
        sourceProject: projName,
        targetProject: targetName,
        targetFramework: tfm,
        sdk,
      });
    }
    if (!hasRefs) {
      projectEdges.push({
        sourceProject: projName,
        targetProject: '(none)',
        targetFramework: tfm,
        sdk,
      });
    }
  }
  storage.replaceProjectReferences(projectRecord.id, projectEdges);

  const sourceFiles = allFiles.filter((f) => /\.(cs|ts|tsx)$/i.test(f));
  const existingSymbols = storage.getProjectSymbols(projectRecord.id);
  const existingHashesByFile = new Map<string, string>();
  for (const s of existingSymbols) {
    existingHashesByFile.set(s.filePath, s.contentHash);
  }

  const currentFileSet = new Set(sourceFiles);
  const removedFiles = Array.from(existingHashesByFile.keys()).filter((f) => !currentFileSet.has(f));

  const symbolsToInsert: ProjectSymbol[] = [];
  let reindexedFiles = 0;
  let cachedFiles = 0;

  for (const relPath of sourceFiles) {
    const content = await fs.readFile(path.join(repoRoot, relPath), 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (!forceFull && existingHashesByFile.get(relPath) === hash) {
      cachedFiles++;
      continue;
    }

    reindexedFiles++;
    let owningProject = projectName;
    for (const [dir, name] of projectDirToName.entries()) {
      if (relPath.startsWith(dir + '/')) {
        owningProject = name;
        break;
      }
    }

    if (relPath.endsWith('.cs')) {
      symbolsToInsert.push(...extractCSharpSymbols(projectRecord.id, relPath, owningProject, content, hash));
    } else {
      symbolsToInsert.push(...extractTsSymbols(projectRecord.id, relPath, owningProject, content, hash));
    }
  }

  if (removedFiles.length > 0 || symbolsToInsert.length > 0) {
    storage.syncFileSymbols(projectRecord.id, removedFiles, symbolsToInsert);
  }

  const finalSymbols = storage.getProjectSymbols(projectRecord.id);
  const uniqueFiles = new Set(finalSymbols.map((s) => s.filePath));

  return {
    projectId: projectRecord.id,
    name: projectRecord.name,
    rootPath: projectRecord.rootPath,
    solutionFile: projectRecord.solutionFile,
    branch: projectRecord.branch,
    lastIndexedAt: projectRecord.lastIndexedAt,
    excludedDirs: projectRecord.excludedDirs,
    symbolCount: finalSymbols.length,
    fileCount: uniqueFiles.size,
    projects: projectEdges,
    symbols: finalSymbols,
    incrementalStats: {
      scannedFiles: sourceFiles.length,
      reindexedFiles,
      cachedFiles,
      removedFiles: removedFiles.length,
    },
  };
}

export async function selectRelevantContextForChanges(
  repoRoot: string,
  changes: GitChange[],
  index: ProjectIndexSummary
): Promise<{
  contextBlocks: Array<{ filePath: string; reason: string; content: string }>;
  trace: ReviewContextArtifact[];
}> {
  const changedPaths = new Set(changes.map((c) => c.filePath));
  const symbolByName = new Map<string, ProjectSymbol[]>();
  for (const s of index.symbols) {
    const arr = symbolByName.get(s.symbolName) ?? [];
    arr.push(s);
    symbolByName.set(s.symbolName, arr);
  }

  const selectedContextPaths = new Map<string, string>();
  const trace: ReviewContextArtifact[] = [];

  for (const change of changes) {
    const fileSymbols = index.symbols.filter((s) => s.filePath === change.filePath);
    const relatedFiles = new Set<string>();
    const relatedSymbols = new Set<string>();

    for (const sym of fileSymbols) {
      // Include implemented interfaces / base classes
      for (const base of sym.baseTypes) {
        const cleanBase = base.split('<')[0].trim();
        for (const target of symbolByName.get(cleanBase) ?? []) {
          relatedSymbols.add(`${target.symbolName} (${target.layer})`);
          if (!changedPaths.has(target.filePath)) {
            relatedFiles.add(target.filePath);
            selectedContextPaths.set(target.filePath, `Base type / interface ${cleanBase} implemented by ${sym.symbolName}`);
          }
        }
      }

      // Include injected dependencies and their concrete implementations
      for (const dep of sym.dependencies) {
        const cleanDep = dep.split('<')[0].trim();
        for (const target of symbolByName.get(cleanDep) ?? []) {
          relatedSymbols.add(`${target.symbolName} (${target.layer})`);
          if (!changedPaths.has(target.filePath)) {
            relatedFiles.add(target.filePath);
            selectedContextPaths.set(target.filePath, `Injected dependency ${cleanDep} used by ${sym.symbolName}`);
          }
        }
        // Also find implementations of interface dependencies
        for (const candidate of index.symbols) {
          if (candidate.baseTypes.some((b) => b.includes(cleanDep))) {
            relatedSymbols.add(`${candidate.symbolName} implements ${cleanDep}`);
            if (!changedPaths.has(candidate.filePath)) {
              relatedFiles.add(candidate.filePath);
              selectedContextPaths.set(candidate.filePath, `Concrete implementation ${candidate.symbolName} of ${cleanDep}`);
            }
          }
        }
      }
    }

    // Also include DTO/Contract files referenced by parameter/return types in modified code
    for (const sym of index.symbols) {
      if (sym.layer === 'Contracts' && !changedPaths.has(sym.filePath)) {
        if (change.modifiedContent.includes(sym.symbolName)) {
          relatedSymbols.add(`${sym.symbolName} (Contracts)`);
          relatedFiles.add(sym.filePath);
          selectedContextPaths.set(sym.filePath, `Contract/DTO ${sym.symbolName} referenced in ${change.filePath}`);
        }
      }
    }

    trace.push({
      targetFile: change.filePath,
      relatedFiles: Array.from(relatedFiles),
      relatedSymbols: Array.from(relatedSymbols),
      architecturalRulesApplied: [
        'API Controllers must not directly reference DataAccess or concrete Repositories',
        'BusinessLogic services must depend on Contracts/Interfaces rather than concrete DataAccess',
        'All nullable repository return values must be guarded before property access',
      ],
    });
  }

  const contextBlocks: Array<{ filePath: string; reason: string; content: string }> = [];
  for (const [relPath, reason] of Array.from(selectedContextPaths.entries()).slice(0, 8)) {
    try {
      const content = await fs.readFile(path.join(repoRoot, relPath), 'utf8');
      contextBlocks.push({
        filePath: relPath,
        reason,
        content: content.slice(0, 6000),
      });
    } catch {
      // Skip unreadable file
    }
  }

  return { contextBlocks, trace };
}
