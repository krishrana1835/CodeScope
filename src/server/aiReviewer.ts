import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import crypto from 'crypto';
import type {
  Finding,
  FindingCategory,
  GitChange,
  ProjectIndexSummary,
  ProviderConfig,
  ReviewContextArtifact,
  Severity,
} from './types.ts';

export interface AIReviewInput {
  sessionId: string;
  changes: GitChange[];
  index: ProjectIndexSummary;
  contextBlocks: Array<{ filePath: string; reason: string; content: string }>;
  staticFindings: Finding[];
  provider: ProviderConfig;
}

export interface AIReviewResult {
  summary: string;
  findings: Finding[];
  providerUsed: string;
  modelUsed: string;
  error?: string;
}

export interface IAIReviewProvider {
  readonly providerType: string;
  testConnection(config: ProviderConfig): Promise<{ ok: boolean; latencyMs: number; message: string }>;
  reviewChanges(input: AIReviewInput): Promise<AIReviewResult>;
}

const VALID_CATEGORIES = new Set<FindingCategory>([
  'Bug',
  'Architecture',
  'Security',
  'Performance',
  'Maintainability',
]);

const VALID_SEVERITIES = new Set<Severity>(['Critical', 'High', 'Medium', 'Low', 'Suggestion']);

function isPlausibleCode(code: string): boolean {
  if (!code || !code.trim()) return false;
  let braces = 0;
  let parens = 0;
  for (const ch of code) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    if (braces < -2 || parens < -2) return false;
  }
  return Math.abs(braces) <= 2 && Math.abs(parens) <= 2;
}

function validateAndDeduplicateFindings(
  sessionId: string,
  rawFindings: Array<Record<string, unknown>>,
  changes: GitChange[],
  staticFindings: Finding[]
): Finding[] {
  const changeByPath = new Map(changes.map((c) => [c.filePath, c]));
  const staticKeys = new Set(
    staticFindings.map((f) => `${f.filePath}:${Math.floor(f.lineNumber / 3)}:${f.category}`)
  );

  const validated: Finding[] = [];
  const seen = new Set<string>();

  for (const raw of rawFindings) {
    const filePath = String(raw.filePath ?? '').trim();
    const change = changeByPath.get(filePath);
    if (!change) continue; // Reject hallucinated file paths

    const totalLines = Math.max(1, change.modifiedContent.split(/\r?\n/).length);
    const lineNumber = Math.max(1, Math.min(totalLines, Math.round(Number(raw.lineNumber ?? 1))));
    const title = String(raw.title ?? '').trim();
    const description = String(raw.description ?? '').trim();
    const originalCode = String(raw.originalCode ?? '').trim();
    const suggestedCode = String(raw.suggestedCode ?? '').trim();
    const evidence = String(raw.evidence ?? '').trim();

    if (!title || !description || !evidence) continue;
    if (!suggestedCode || !isPlausibleCode(suggestedCode)) continue;
    if (originalCode && originalCode === suggestedCode) continue;

    const category: FindingCategory = VALID_CATEGORIES.has(raw.category as FindingCategory)
      ? (raw.category as FindingCategory)
      : 'Bug';
    const severity: Severity = VALID_SEVERITIES.has(raw.severity as Severity)
      ? (raw.severity as Severity)
      : 'Medium';

    const dedupKey = `${filePath}:${lineNumber}:${title.toLowerCase()}`;
    const staticOverlapKey = `${filePath}:${Math.floor(lineNumber / 3)}:${category}`;
    if (seen.has(dedupKey) || staticKeys.has(staticOverlapKey)) continue;
    seen.add(dedupKey);

    const confidenceNum = Number(raw.confidence ?? 0.82);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0.1, Math.min(0.99, confidenceNum)) : 0.82;

    validated.push({
      id: crypto.randomUUID(),
      sessionId,
      title,
      category,
      severity,
      filePath,
      lineNumber,
      endLineNumber: lineNumber,
      confidence,
      detectionSource: 'AI Review',
      ruleId: 'AI-CONTEXT-REVIEW',
      description,
      reason: String(raw.reason ?? description),
      conditions: String(raw.conditions ?? 'Occurs under matching runtime input or execution state.'),
      impact: String(raw.impact ?? 'May lead to incorrect business behavior or runtime failures.'),
      suggestion: String(raw.suggestion ?? 'Apply the suggested fix and verify with unit tests.'),
      originalCode: originalCode || (change.modifiedContent.split(/\r?\n/)[lineNumber - 1] ?? ''),
      suggestedCode,
      evidence,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    });
  }

  return validated;
}

export class GeminiReviewProvider implements IAIReviewProvider {
  public readonly providerType = 'gemini';

  private createClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Server-side GEMINI_API_KEY is not configured.');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async testConnection(config: ProviderConfig): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    try {
      const ai = this.createClient();
      const model = config.modelId || 'gemini-4-hydrogen';
      const response = await ai.models.generateContent({
        model,
        contents: 'Reply with OK.',
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const latencyMs = Date.now() - start;
      return {
        ok: Boolean(response.text),
        latencyMs,
        message: `Connected to Google Gemini (${model}) in ${latencyMs}ms.`,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : 'Unknown connection error';
      return { ok: false, latencyMs, message: msg };
    }
  }

  public async reviewChanges(input: AIReviewInput): Promise<AIReviewResult> {
    const model = input.provider.modelId || 'gemini-4-hydrogen';
    try {
      const ai = this.createClient();

      const changedPayload = input.changes
        .filter((c) => c.changeKind !== 'Deleted')
        .slice(0, 12)
        .map((c) => ({
          filePath: c.filePath,
          changeKind: c.changeKind,
          diff: c.diff.slice(0, 4500),
          modifiedContent: c.modifiedContent
            .split(/\r?\n/)
            .map((line, idx) => `${idx + 1}: ${line}`)
            .join('\n')
            .slice(0, 7000),
        }));

      const staticSummary = input.staticFindings.map((f) => ({
        ruleId: f.ruleId,
        filePath: f.filePath,
        lineNumber: f.lineNumber,
        title: f.title,
      }));

      const prompt = `Perform a high-precision, evidence-backed code review of these Git changes in the "${input.index.name}" solution.

Project Architecture Summary:
- Solution: ${input.index.solutionFile ?? input.index.name}
- Project References: ${JSON.stringify(input.index.projects)}

Static Diagnostics Already Detected (DO NOT duplicate these exact issues):
${JSON.stringify(staticSummary, null, 2)}

Retrieved Related Context Files (Interfaces, Contracts, Dependencies):
${JSON.stringify(input.contextBlocks, null, 2)}

Changed Files & Line-Numbered Modified Source:
${JSON.stringify(changedPayload, null, 2)}

Instructions:
1. Focus on cross-file reasoning, business logic bugs, domain invariant violations, financial/calculation edge cases (e.g. negative quantities, discount exceeding subtotal, negative totals), data consistency, missing cancellation propagation, and security or concurrency flaws not already covered by static diagnostics.
2. Every finding MUST reference an exact filePath from the changed files above, a real lineNumber, verbatim originalCode from the file, plausible compilable suggestedCode, and concrete evidence grounded in the code.
3. Never invent findings just to make the review longer. If no additional high-value findings exist beyond the static diagnostics, return an empty findings array with a concise summary.`;

      const thinkingLevel =
        input.provider.thinkingLevel === 'LOW'
          ? ThinkingLevel.LOW
          : input.provider.thinkingLevel === 'HIGH'
            ? ThinkingLevel.HIGH
            : ThinkingLevel.MEDIUM;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a Principal .NET and Distributed Systems Code Reviewer. Output strictly valid JSON conforming to the schema. Distinguish confirmed bugs from optional improvements and cite exact line numbers and code evidence.',
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Concise engineering summary of the reviewed changes and architectural risk.',
              },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    category: {
                      type: Type.STRING,
                      description: 'One of: Bug, Architecture, Security, Performance, Maintainability',
                    },
                    severity: {
                      type: Type.STRING,
                      description: 'One of: Critical, High, Medium, Low, Suggestion',
                    },
                    filePath: { type: Type.STRING },
                    lineNumber: { type: Type.INTEGER },
                    confidence: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    conditions: { type: Type.STRING },
                    impact: { type: Type.STRING },
                    suggestion: { type: Type.STRING },
                    originalCode: { type: Type.STRING },
                    suggestedCode: { type: Type.STRING },
                    evidence: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as { summary?: string; findings?: Array<Record<string, unknown>> };
      const validated = validateAndDeduplicateFindings(
        input.sessionId,
        Array.isArray(parsed.findings) ? parsed.findings : [],
        input.changes,
        input.staticFindings
      );

      return {
        summary: String(parsed.summary ?? 'AI contextual review completed.'),
        findings: validated,
        providerUsed: input.provider.name,
        modelUsed: model,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI provider invocation failed.';
      return {
        summary: `AI review skipped or degraded (${msg}). Showing verified static Roslyn/architectural findings.`,
        findings: [],
        providerUsed: input.provider.name,
        modelUsed: model,
        error: msg,
      };
    }
  }
}

export class OpenAICompatibleReviewProvider implements IAIReviewProvider {
  public readonly providerType = 'openai-compatible';

  public async testConnection(config: ProviderConfig): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - start;
      return {
        ok: res.ok,
        latencyMs,
        message: res.ok
          ? `Reached ${config.endpoint} (${res.status}) in ${latencyMs}ms.`
          : `Endpoint responded with HTTP ${res.status}.`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Endpoint unreachable.',
      };
    }
  }

  public async reviewChanges(input: AIReviewInput): Promise<AIReviewResult> {
    return {
      summary: `Configured endpoint (${input.provider.endpoint}) requires a running local/external OpenAI-compatible inference server. Showing verified static Roslyn diagnostics.`,
      findings: [],
      providerUsed: input.provider.name,
      modelUsed: input.provider.modelId,
      error: 'Local/custom OpenAI-compatible server is not running in this environment.',
    };
  }
}

export function resolveAIProvider(config: ProviderConfig): IAIReviewProvider {
  if (config.providerType === 'gemini') {
    return new GeminiReviewProvider();
  }
  return new OpenAICompatibleReviewProvider();
}
