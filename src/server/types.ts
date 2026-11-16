export type ChangeKind = 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Untracked';

export type CheckMode = 'changes' | 'staged' | 'all' | 'branch';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Suggestion';

export type FindingCategory =
  | 'Bug'
  | 'Architecture'
  | 'Security'
  | 'Performance'
  | 'Maintainability';

export type DetectionSource = 'Roslyn Rule' | 'Custom Rule' | 'AI Review';

export type FindingStatus = 'Pending' | 'Accepted' | 'Rejected';

export type ArchitecturalLayer =
  | 'API'
  | 'BusinessLogic'
  | 'DataAccess'
  | 'Contracts'
  | 'Infrastructure'
  | 'Tests'
  | 'Unknown';

export interface GitChange {
  filePath: string;
  previousPath?: string;
  changeKind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  diff: string;
  originalContent: string;
  modifiedContent: string;
  lineCount: number;
  additions: number;
  deletions: number;
}

export interface GitRepositoryInfo {
  rootPath: string;
  branch: string;
  headCommit: string;
  headMessage: string;
  isClean: boolean;
}

export interface ProjectSymbol {
  id?: number;
  projectId: number;
  filePath: string;
  projectName: string;
  namespace: string;
  symbolName: string;
  symbolKind: 'class' | 'interface' | 'record' | 'struct' | 'enum' | 'program';
  layer: ArchitecturalLayer;
  baseTypes: string[];
  dependencies: string[];
  diRegistrations: string[];
  methods: string[];
  contentHash: string;
  updatedAt: string;
}

export interface ProjectReferenceEdge {
  sourceProject: string;
  targetProject: string;
  targetFramework: string;
  sdk: string;
}

export interface ProjectIndexSummary {
  projectId: number;
  name: string;
  rootPath: string;
  solutionFile: string | null;
  branch: string;
  lastIndexedAt: string;
  excludedDirs: string[];
  symbolCount: number;
  fileCount: number;
  projects: ProjectReferenceEdge[];
  symbols: ProjectSymbol[];
  incrementalStats?: {
    scannedFiles: number;
    reindexedFiles: number;
    cachedFiles: number;
    removedFiles: number;
  };
}

export interface Finding {
  id: string;
  sessionId: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  filePath: string;
  lineNumber: number;
  endLineNumber: number;
  confidence: number;
  detectionSource: DetectionSource;
  ruleId: string;
  description: string;
  reason: string;
  conditions: string;
  impact: string;
  suggestion: string;
  originalCode: string;
  suggestedCode: string;
  evidence: string;
  status: FindingStatus;
  createdAt: string;
}

export interface ReviewContextArtifact {
  targetFile: string;
  relatedFiles: string[];
  relatedSymbols: string[];
  architecturalRulesApplied: string[];
}

export interface ReviewSession {
  id: string;
  projectId: number;
  projectName: string;
  rootPath: string;
  mode: CheckMode;
  noAi: boolean;
  branch: string;
  totalFiles: number;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  suggestionCount: number;
  durationMs: number;
  aiProvider: string;
  aiModel: string;
  summary: string;
  createdAt: string;
  changedFiles: GitChange[];
  findings: Finding[];
  contextTrace: ReviewContextArtifact[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: 'gemini' | 'openai-compatible' | 'anthropic' | 'openrouter' | 'groq' | 'ollama';
  endpoint: string;
  modelId: string;
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  isDefault: boolean;
  isEnabled: boolean;
  hasServerCredential: boolean;
  excludedDirs: string[];
  updatedAt: string;
}

export interface CheckRunRequest {
  repoPath?: string;
  mode?: CheckMode;
  noAi?: boolean;
  baseBranch?: string;
  providerId?: string;
}
