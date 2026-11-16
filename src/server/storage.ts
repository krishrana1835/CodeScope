import Database from 'better-sqlite3';
import path from 'path';
import type {
  Finding,
  FindingStatus,
  GitChange,
  ProjectReferenceEdge,
  ProjectSymbol,
  ProviderConfig,
  ReviewContextArtifact,
  ReviewSession,
} from './types.ts';

const DB_PATH = path.resolve(process.cwd(), 'codescope.db');

export class CodeScopeStorage {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.seedDefaultProviders();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        solution_file TEXT,
        branch TEXT NOT NULL DEFAULT 'main',
        excluded_dirs_json TEXT NOT NULL DEFAULT '["bin","obj",".git","node_modules",".vs","dist"]',
        last_indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        source_project TEXT NOT NULL,
        target_project TEXT NOT NULL,
        target_framework TEXT NOT NULL DEFAULT 'net8.0',
        sdk TEXT NOT NULL DEFAULT 'Microsoft.NET.Sdk',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        namespace TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        symbol_kind TEXT NOT NULL,
        layer TEXT NOT NULL,
        base_types_json TEXT NOT NULL DEFAULT '[]',
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        di_registrations_json TEXT NOT NULL DEFAULT '[]',
        methods_json TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_project_file ON project_symbols(project_id, file_path);

      CREATE TABLE IF NOT EXISTS review_sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        no_ai INTEGER NOT NULL DEFAULT 0,
        branch TEXT NOT NULL,
        total_files INTEGER NOT NULL,
        total_findings INTEGER NOT NULL,
        critical_count INTEGER NOT NULL,
        high_count INTEGER NOT NULL,
        medium_count INTEGER NOT NULL,
        low_count INTEGER NOT NULL,
        suggestion_count INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        ai_provider TEXT NOT NULL,
        ai_model TEXT NOT NULL,
        summary TEXT NOT NULL,
        changed_files_json TEXT NOT NULL DEFAULT '[]',
        context_trace_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        end_line_number INTEGER NOT NULL,
        confidence REAL NOT NULL,
        detection_source TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        description TEXT NOT NULL,
        reason TEXT NOT NULL,
        conditions TEXT NOT NULL,
        impact TEXT NOT NULL,
        suggestion TEXT NOT NULL,
        original_code TEXT NOT NULL,
        suggested_code TEXT NOT NULL,
        evidence TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'MEDIUM',
        is_default INTEGER NOT NULL DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        excluded_dirs_json TEXT NOT NULL DEFAULT '["bin","obj",".git","node_modules",".vs","dist"]',
        updated_at TEXT NOT NULL
      );
    `);
  }

  private seedDefaultProviders(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM provider_configs').get() as { count: number };
    if (countRow.count > 0) return;

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO provider_configs (id, name, provider_type, endpoint, model_id, thinking_level, is_default, is_enabled, excluded_dirs_json, updated_at)
      VALUES (@id, @name, @provider_type, @endpoint, @model_id, @thinking_level, @is_default, @is_enabled, @excluded_dirs_json, @updated_at)
    `);

    const defaultExcluded = JSON.stringify(['bin', 'obj', '.git', 'node_modules', '.vs', 'dist']);

    insert.run({
      id: 'gemini-studio',
      name: 'Google Gemini (AI Studio)',
      provider_type: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com',
      model_id: 'gemini-4-hydrogen',
      thinking_level: 'MEDIUM',
      is_default: 1,
      is_enabled: 1,
      excluded_dirs_json: defaultExcluded,
      updated_at: now,
    });

    insert.run({
      id: 'ollama-local',
      name: 'Local Inference (OpenAI-Compatible)',
      provider_type: 'ollama',
      endpoint: 'http://localhost:11434/v1',
      model_id: 'qwen2.5-coder:14b',
      thinking_level: 'MEDIUM',
      is_default: 0,
      is_enabled: 0,
      excluded_dirs_json: defaultExcluded,
      updated_at: now,
    });

    insert.run({
      id: 'openai-compat',
      name: 'Custom OpenAI-Compatible Endpoint',
      provider_type: 'openai-compatible',
      endpoint: 'https://api.openai.com/v1',
      model_id: 'gpt-4.1',
      thinking_level: 'MEDIUM',
      is_default: 0,
      is_enabled: 0,
      excluded_dirs_json: defaultExcluded,
      updated_at: now,
    });
  }

  public upsertProject(input: {
    name: string;
    rootPath: string;
    solutionFile: string | null;
    branch: string;
    excludedDirs?: string[];
  }): { id: number; name: string; rootPath: string; solutionFile: string | null; branch: string; excludedDirs: string[]; lastIndexedAt: string } {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM projects WHERE root_path = ?').get(input.rootPath) as
      | { id: number; excluded_dirs_json: string }
      | undefined;

    const excludedDirs = input.excludedDirs ?? (existing ? JSON.parse(existing.excluded_dirs_json) : ['bin', 'obj', '.git', 'node_modules', '.vs', 'dist']);

    if (existing) {
      this.db
        .prepare(
          `UPDATE projects SET name = ?, solution_file = ?, branch = ?, excluded_dirs_json = ?, last_indexed_at = ? WHERE id = ?`
        )
        .run(input.name, input.solutionFile, input.branch, JSON.stringify(excludedDirs), now, existing.id);

      return {
        id: existing.id,
        name: input.name,
        rootPath: input.rootPath,
        solutionFile: input.solutionFile,
        branch: input.branch,
        excludedDirs,
        lastIndexedAt: now,
      };
    }

    const result = this.db
      .prepare(
        `INSERT INTO projects (name, root_path, solution_file, branch, excluded_dirs_json, last_indexed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.name, input.rootPath, input.solutionFile, input.branch, JSON.stringify(excludedDirs), now);

    return {
      id: Number(result.lastInsertRowid),
      name: input.name,
      rootPath: input.rootPath,
      solutionFile: input.solutionFile,
      branch: input.branch,
      excludedDirs,
      lastIndexedAt: now,
    };
  }

  public getProjectByRoot(rootPath: string) {
    const row = this.db.prepare('SELECT * FROM projects WHERE root_path = ?').get(rootPath) as
      | {
          id: number;
          name: string;
          root_path: string;
          solution_file: string | null;
          branch: string;
          excluded_dirs_json: string;
          last_indexed_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      solutionFile: row.solution_file,
      branch: row.branch,
      excludedDirs: JSON.parse(row.excluded_dirs_json) as string[],
      lastIndexedAt: row.last_indexed_at,
    };
  }

  public replaceProjectReferences(projectId: number, edges: ProjectReferenceEdge[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM project_references WHERE project_id = ?').run(projectId);
      const stmt = this.db.prepare(
        `INSERT INTO project_references (project_id, source_project, target_project, target_framework, sdk)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const edge of edges) {
        stmt.run(projectId, edge.sourceProject, edge.targetProject, edge.targetFramework, edge.sdk);
      }
    });
    tx();
  }

  public getProjectReferences(projectId: number): ProjectReferenceEdge[] {
    const rows = this.db.prepare('SELECT * FROM project_references WHERE project_id = ?').all(projectId) as Array<{
      source_project: string;
      target_project: string;
      target_framework: string;
      sdk: string;
    }>;
    return rows.map((r) => ({
      sourceProject: r.source_project,
      targetProject: r.target_project,
      targetFramework: r.target_framework,
      sdk: r.sdk,
    }));
  }

  public getProjectSymbols(projectId: number): ProjectSymbol[] {
    const rows = this.db.prepare('SELECT * FROM project_symbols WHERE project_id = ? ORDER BY file_path, symbol_name').all(projectId) as Array<{
      id: number;
      project_id: number;
      file_path: string;
      project_name: string;
      namespace: string;
      symbol_name: string;
      symbol_kind: ProjectSymbol['symbolKind'];
      layer: ProjectSymbol['layer'];
      base_types_json: string;
      dependencies_json: string;
      di_registrations_json: string;
      methods_json: string;
      content_hash: string;
      updated_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      filePath: r.file_path,
      projectName: r.project_name,
      namespace: r.namespace,
      symbolName: r.symbol_name,
      symbolKind: r.symbol_kind,
      layer: r.layer,
      baseTypes: JSON.parse(r.base_types_json),
      dependencies: JSON.parse(r.dependencies_json),
      diRegistrations: JSON.parse(r.di_registrations_json),
      methods: JSON.parse(r.methods_json),
      contentHash: r.content_hash,
      updatedAt: r.updated_at,
    }));
  }

  public syncFileSymbols(projectId: number, removedFiles: string[], symbolsToInsert: ProjectSymbol[]): void {
    const tx = this.db.transaction(() => {
      const del = this.db.prepare('DELETE FROM project_symbols WHERE project_id = ? AND file_path = ?');
      const touchedFiles = new Set<string>([...removedFiles, ...symbolsToInsert.map((s) => s.filePath)]);
      for (const filePath of touchedFiles) {
        del.run(projectId, filePath);
      }

      const ins = this.db.prepare(`
        INSERT INTO project_symbols (
          project_id, file_path, project_name, namespace, symbol_name, symbol_kind,
          layer, base_types_json, dependencies_json, di_registrations_json, methods_json,
          content_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const s of symbolsToInsert) {
        ins.run(
          projectId,
          s.filePath,
          s.projectName,
          s.namespace,
          s.symbolName,
          s.symbolKind,
          s.layer,
          JSON.stringify(s.baseTypes),
          JSON.stringify(s.dependencies),
          JSON.stringify(s.diRegistrations),
          JSON.stringify(s.methods),
          s.contentHash,
          s.updatedAt
        );
      }
    });
    tx();
  }

  public saveReviewSession(session: ReviewSession): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO review_sessions (
            id, project_id, project_name, root_path, mode, no_ai, branch,
            total_files, total_findings, critical_count, high_count, medium_count,
            low_count, suggestion_count, duration_ms, ai_provider, ai_model,
            summary, changed_files_json, context_trace_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          session.id,
          session.projectId,
          session.projectName,
          session.rootPath,
          session.mode,
          session.noAi ? 1 : 0,
          session.branch,
          session.totalFiles,
          session.totalFindings,
          session.criticalCount,
          session.highCount,
          session.mediumCount,
          session.lowCount,
          session.suggestionCount,
          session.durationMs,
          session.aiProvider,
          session.aiModel,
          session.summary,
          JSON.stringify(session.changedFiles),
          JSON.stringify(session.contextTrace),
          session.createdAt
        );

      const insFinding = this.db.prepare(
        `INSERT INTO findings (
          id, session_id, title, category, severity, file_path, line_number,
          end_line_number, confidence, detection_source, rule_id, description,
          reason, conditions, impact, suggestion, original_code, suggested_code,
          evidence, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const f of session.findings) {
        insFinding.run(
          f.id,
          session.id,
          f.title,
          f.category,
          f.severity,
          f.filePath,
          f.lineNumber,
          f.endLineNumber,
          f.confidence,
          f.detectionSource,
          f.ruleId,
          f.description,
          f.reason,
          f.conditions,
          f.impact,
          f.suggestion,
          f.originalCode,
          f.suggestedCode,
          f.evidence,
          f.status,
          f.createdAt
        );
      }
    });
    tx();
  }

  public listReviewSessions(limit = 30): Array<Omit<ReviewSession, 'changedFiles' | 'findings' | 'contextTrace'>> {
    const rows = this.db
      .prepare('SELECT * FROM review_sessions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      projectId: Number(r.project_id),
      projectName: String(r.project_name),
      rootPath: String(r.root_path),
      mode: r.mode as ReviewSession['mode'],
      noAi: Boolean(r.no_ai),
      branch: String(r.branch),
      totalFiles: Number(r.total_files),
      totalFindings: Number(r.total_findings),
      criticalCount: Number(r.critical_count),
      highCount: Number(r.high_count),
      mediumCount: Number(r.medium_count),
      lowCount: Number(r.low_count),
      suggestionCount: Number(r.suggestion_count),
      durationMs: Number(r.duration_ms),
      aiProvider: String(r.ai_provider),
      aiModel: String(r.ai_model),
      summary: String(r.summary),
      createdAt: String(r.created_at),
    }));
  }

  public getReviewSession(sessionId: string): ReviewSession | null {
    const r = this.db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;

    const findingRows = this.db
      .prepare('SELECT * FROM findings WHERE session_id = ? ORDER BY CASE severity WHEN \'Critical\' THEN 1 WHEN \'High\' THEN 2 WHEN \'Medium\' THEN 3 WHEN \'Low\' THEN 4 ELSE 5 END, file_path, line_number')
      .all(sessionId) as Array<Record<string, unknown>>;

    const findings: Finding[] = findingRows.map((f) => ({
      id: String(f.id),
      sessionId: String(f.session_id),
      title: String(f.title),
      category: f.category as Finding['category'],
      severity: f.severity as Finding['severity'],
      filePath: String(f.file_path),
      lineNumber: Number(f.line_number),
      endLineNumber: Number(f.end_line_number),
      confidence: Number(f.confidence),
      detectionSource: f.detection_source as Finding['detectionSource'],
      ruleId: String(f.rule_id),
      description: String(f.description),
      reason: String(f.reason),
      conditions: String(f.conditions),
      impact: String(f.impact),
      suggestion: String(f.suggestion),
      originalCode: String(f.original_code),
      suggestedCode: String(f.suggested_code),
      evidence: String(f.evidence),
      status: f.status as FindingStatus,
      createdAt: String(f.created_at),
    }));

    return {
      id: String(r.id),
      projectId: Number(r.project_id),
      projectName: String(r.project_name),
      rootPath: String(r.root_path),
      mode: r.mode as ReviewSession['mode'],
      noAi: Boolean(r.no_ai),
      branch: String(r.branch),
      totalFiles: Number(r.total_files),
      totalFindings: Number(r.total_findings),
      criticalCount: Number(r.critical_count),
      highCount: Number(r.high_count),
      mediumCount: Number(r.medium_count),
      lowCount: Number(r.low_count),
      suggestionCount: Number(r.suggestion_count),
      durationMs: Number(r.duration_ms),
      aiProvider: String(r.ai_provider),
      aiModel: String(r.ai_model),
      summary: String(r.summary),
      createdAt: String(r.created_at),
      changedFiles: JSON.parse(String(r.changed_files_json)) as GitChange[],
      contextTrace: JSON.parse(String(r.context_trace_json)) as ReviewContextArtifact[],
      findings,
    };
  }

  public getFindingById(findingId: string): { finding: Finding; rootPath: string } | null {
    const f = this.db
      .prepare(
        `SELECT findings.*, review_sessions.root_path FROM findings
         JOIN review_sessions ON review_sessions.id = findings.session_id
         WHERE findings.id = ?`
      )
      .get(findingId) as Record<string, unknown> | undefined;
    if (!f) return null;

    return {
      rootPath: String(f.root_path),
      finding: {
        id: String(f.id),
        sessionId: String(f.session_id),
        title: String(f.title),
        category: f.category as Finding['category'],
        severity: f.severity as Finding['severity'],
        filePath: String(f.file_path),
        lineNumber: Number(f.line_number),
        endLineNumber: Number(f.end_line_number),
        confidence: Number(f.confidence),
        detectionSource: f.detection_source as Finding['detectionSource'],
        ruleId: String(f.rule_id),
        description: String(f.description),
        reason: String(f.reason),
        conditions: String(f.conditions),
        impact: String(f.impact),
        suggestion: String(f.suggestion),
        originalCode: String(f.original_code),
        suggestedCode: String(f.suggested_code),
        evidence: String(f.evidence),
        status: f.status as FindingStatus,
        createdAt: String(f.created_at),
      },
    };
  }

  public updateFindingStatus(findingId: string, status: FindingStatus): void {
    this.db.prepare('UPDATE findings SET status = ? WHERE id = ?').run(status, findingId);
  }

  public listProviderConfigs(): ProviderConfig[] {
    const rows = this.db.prepare('SELECT * FROM provider_configs ORDER BY is_default DESC, name ASC').all() as Array<Record<string, unknown>>;
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      providerType: r.provider_type as ProviderConfig['providerType'],
      endpoint: String(r.endpoint),
      modelId: String(r.model_id),
      thinkingLevel: (String(r.thinking_level) as ProviderConfig['thinkingLevel']) || 'MEDIUM',
      isDefault: Boolean(r.is_default),
      isEnabled: Boolean(r.is_enabled),
      hasServerCredential: r.provider_type === 'gemini' ? hasGeminiKey : false,
      excludedDirs: JSON.parse(String(r.excluded_dirs_json)) as string[],
      updatedAt: String(r.updated_at),
    }));
  }

  public getDefaultProvider(): ProviderConfig {
    const providers = this.listProviderConfigs();
    return providers.find((p) => p.isDefault && p.isEnabled) ?? providers.find((p) => p.isDefault) ?? providers[0];
  }

  public updateProviderConfig(input: {
    id: string;
    endpoint?: string;
    modelId?: string;
    thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    isDefault?: boolean;
    isEnabled?: boolean;
    excludedDirs?: string[];
  }): ProviderConfig[] {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (input.isDefault) {
        this.db.prepare('UPDATE provider_configs SET is_default = 0').run();
      }
      const existing = this.db.prepare('SELECT * FROM provider_configs WHERE id = ?').get(input.id) as
        | Record<string, unknown>
        | undefined;
      if (!existing) return;

      this.db
        .prepare(
          `UPDATE provider_configs
           SET endpoint = ?, model_id = ?, thinking_level = ?, is_default = ?, is_enabled = ?, excluded_dirs_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.endpoint ?? String(existing.endpoint),
          input.modelId ?? String(existing.model_id),
          input.thinkingLevel ?? String(existing.thinking_level),
          input.isDefault !== undefined ? (input.isDefault ? 1 : 0) : Number(existing.is_default),
          input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : Number(existing.is_enabled),
          input.excludedDirs ? JSON.stringify(input.excludedDirs) : String(existing.excluded_dirs_json),
          now,
          input.id
        );
    });
    tx();
    return this.listProviderConfigs();
  }
}

export const storage = new CodeScopeStorage();
