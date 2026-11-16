import crypto from 'crypto';
import type {
  DetectionSource,
  Finding,
  FindingCategory,
  GitChange,
  ProjectIndexSummary,
  Severity,
} from './types.ts';

function makeFinding(
  sessionId: string,
  params: {
    title: string;
    category: FindingCategory;
    severity: Severity;
    filePath: string;
    lineNumber: number;
    endLineNumber?: number;
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
  }
): Finding {
  return {
    id: crypto.randomUUID(),
    sessionId,
    title: params.title,
    category: params.category,
    severity: params.severity,
    filePath: params.filePath,
    lineNumber: params.lineNumber,
    endLineNumber: params.endLineNumber ?? params.lineNumber,
    confidence: params.confidence,
    detectionSource: params.detectionSource,
    ruleId: params.ruleId,
    description: params.description,
    reason: params.reason,
    conditions: params.conditions,
    impact: params.impact,
    suggestion: params.suggestion,
    originalCode: params.originalCode,
    suggestedCode: params.suggestedCode,
    evidence: params.evidence,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };
}

function getLineSnippet(lines: string[], startIdx: number, count = 1): string {
  return lines.slice(Math.max(0, startIdx), Math.min(lines.length, startIdx + count)).join('\n');
}

export function runRoslynStyleAnalysis(
  sessionId: string,
  changes: GitChange[],
  index: ProjectIndexSummary
): Finding[] {
  const findings: Finding[] = [];
  const symbolsByName = new Map(index.symbols.map((s) => [s.symbolName, s]));

  for (const change of changes) {
    if (change.changeKind === 'Deleted') continue;
    if (!change.filePath.endsWith('.cs')) continue;

    const code = change.modifiedContent;
    if (!code.trim()) continue;
    const lines = code.split(/\r?\n/);

    // 1. Custom Project-Aware Architectural Rule: Controller directly using DataAccess / Repository / DbContext
    const fileSymbols = index.symbols.filter((s) => s.filePath === change.filePath);
    for (const sym of fileSymbols) {
      if (sym.layer === 'API') {
        for (const dep of sym.dependencies) {
          const cleanDep = dep.split('<')[0].trim();
          const depSym = symbolsByName.get(cleanDep);
          const looksLikeDataAccess =
            (depSym && depSym.layer === 'DataAccess') ||
            /Repository$|DbContext$/i.test(cleanDep) ||
            code.includes('DataAccess.Repositories');

          if (looksLikeDataAccess) {
            const lineIdx = lines.findIndex((l) => l.includes(cleanDep) && (l.includes('private readonly') || l.includes(sym.symbolName)));
            const ln = lineIdx >= 0 ? lineIdx + 1 : 1;
            const snippet = getLineSnippet(lines, Math.max(0, ln - 1), 1);
            findings.push(
              makeFinding(sessionId, {
                title: `Controller directly depends on DataAccess type "${cleanDep}"`,
                category: 'Architecture',
                severity: 'High',
                filePath: change.filePath,
                lineNumber: ln,
                confidence: 0.96,
                detectionSource: 'Custom Rule',
                ruleId: 'CS-ARCH-001',
                description: `${sym.symbolName} in the API layer injects ${cleanDep} directly instead of delegating through a BusinessLogic service interface.`,
                reason:
                  'Controllers bypassing the BusinessLogic layer couple HTTP endpoints directly to persistence models and skip domain validation, authorization checks, and transaction boundaries.',
                conditions: `Any request hitting endpoints in ${sym.symbolName} that invoke _${cleanDep[0].toLowerCase()}${cleanDep.slice(1)} directly.`,
                impact:
                  'Breaks layered architecture boundaries, duplicates business rules across controllers, and complicates unit testing and database refactoring.',
                suggestion: `Remove the direct dependency on ${cleanDep} from ${sym.symbolName} and expose the required query through an IOrderService / BusinessLogic contract.`,
                originalCode: snippet,
                suggestedCode: `// Delegate via BusinessLogic service interface instead of ${cleanDep}\nprivate readonly IOrderService _orderService;`,
                evidence: `${sym.symbolName} (Layer: API) constructor declares parameter of type ${cleanDep} (Layer: DataAccess).`,
              })
            );
          }
        }
      }
    }

    // 2. Line-by-line C# semantic & structural pattern diagnostics
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;
      const lineNum = i + 1;

      // CS-ASYNC-001: Blocking async calls (.Result, .Wait(), .GetAwaiter().GetResult())
      if (/(\.GetAwaiter\(\)\.GetResult\(\)|\.Result\b|\.Wait\(\))/.test(trimmed) && !trimmed.includes('Task.FromResult')) {
        const isAwaitableReturn = trimmed.includes('Async(') || trimmed.includes('_') || trimmed.includes('task');
        if (isAwaitableReturn) {
          const suggested = trimmed
            .replace(/\.GetAwaiter\(\)\.GetResult\(\)/g, '')
            .replace(/\.Result\b/g, '')
            .replace(/\.Wait\(\)/g, '');
          const needsAwaitPrefix = !suggested.trimStart().startsWith('await ');
          const fixedLine = needsAwaitPrefix
            ? line.replace(trimmed, trimmed.includes('var ') ? trimmed.replace('= ', '= await ').replace(/\.GetAwaiter\(\)\.GetResult\(\)|\.Result\b|\.Wait\(\)/g, '') : `await ${suggested}`)
            : line.replace(/\.GetAwaiter\(\)\.GetResult\(\)|\.Result\b|\.Wait\(\)/g, '');

          findings.push(
            makeFinding(sessionId, {
              title: 'Synchronous blocking on asynchronous Task (.Result / GetResult)',
              category: 'Performance',
              severity: 'High',
              filePath: change.filePath,
              lineNumber: lineNum,
              confidence: 0.95,
              detectionSource: 'Roslyn Rule',
              ruleId: 'CS-ASYNC-001',
              description: 'Blocking synchronously on a Task inside an ASP.NET Core or async call path.',
              reason:
                'Calling .Result, .Wait(), or .GetAwaiter().GetResult() blocks the calling thread pool thread until I/O completes, risking thread-pool starvation under concurrent traffic and deadlocks in SynchronizationContext environments.',
              conditions: 'Occurs whenever this code path executes under concurrent HTTP load or with a captured SynchronizationContext.',
              impact: 'Severe throughput degradation, increased tail latency, and potential request thread-pool exhaustion.',
              suggestion: 'Make the enclosing method async Task / async Task<T> and await the asynchronous operation.',
              originalCode: line,
              suggestedCode: fixedLine,
              evidence: `Detected synchronous Task wait operator at line ${lineNum}: "${trimmed}".`,
            })
          );
        }
      }

      // CS-ASYNC-002: async void outside event handlers
      if (/\basync\s+void\b/.test(trimmed) && !trimmed.includes('EventArgs')) {
        findings.push(
          makeFinding(sessionId, {
            title: 'Avoid "async void" methods outside event handlers',
            category: 'Bug',
            severity: 'High',
            filePath: change.filePath,
            lineNumber: lineNum,
            confidence: 0.94,
            detectionSource: 'Roslyn Rule',
            ruleId: 'CS-ASYNC-002',
            description: 'Method is declared as async void, preventing callers from awaiting completion or catching thrown exceptions.',
            reason: 'Exceptions thrown inside an async void method cannot be caught by the caller and will crash the .NET host process.',
            conditions: 'Any unhandled exception thrown after the first suspension point.',
            impact: 'Unhandled process crash and race conditions because callers cannot await completion.',
            suggestion: 'Change the return type from async void to async Task.',
            originalCode: line,
            suggestedCode: line.replace(/\basync\s+void\b/, 'async Task'),
            evidence: `Method signature at line ${lineNum} uses "async void".`,
          })
        );
      }

      // CS-RES-001: new HttpClient() instantiated directly inside a method
      if (/new\s+HttpClient\s*\(/.test(trimmed) && !trimmed.startsWith('using ')) {
        findings.push(
          makeFinding(sessionId, {
            title: 'Direct HttpClient instantiation risks socket exhaustion',
            category: 'Performance',
            severity: 'High',
            filePath: change.filePath,
            lineNumber: lineNum,
            confidence: 0.93,
            detectionSource: 'Roslyn Rule',
            ruleId: 'CS-RES-001',
            description: 'A new HttpClient instance is allocated directly without IHttpClientFactory or even a using block.',
            reason:
              'HttpClient implements IDisposable and holds underlying OS sockets in TIME_WAIT after disposal. Creating one per call leaks handles and exhausts ephemeral ports under load.',
            conditions: 'Repeated invocations of this method in production traffic.',
            impact: 'SocketException / port exhaustion and DNS staleness across the host service.',
            suggestion: 'Inject IHttpClientFactory (or typed HttpClient via AddHttpClient<T>) via constructor dependency injection.',
            originalCode: line,
            suggestedCode: `// Inject IHttpClientFactory via constructor and call:\nusing var client = _httpClientFactory.CreateClient();`,
            evidence: `Direct "new HttpClient()" allocation at line ${lineNum} without IHttpClientFactory or using statement.`,
          })
        );
      }

      // CS-RES-002: SqlConnection / StreamReader / MemoryStream without using
      if (/=\s*new\s+(SqlConnection|NpgsqlConnection|StreamReader|StreamWriter|MemoryStream|FileStream)\s*\(/.test(trimmed) && !trimmed.startsWith('using ')) {
        findings.push(
          makeFinding(sessionId, {
            title: 'IDisposable resource allocated without "using" declaration',
            category: 'Bug',
            severity: 'Medium',
            filePath: change.filePath,
            lineNumber: lineNum,
            confidence: 0.91,
            detectionSource: 'Roslyn Rule',
            ruleId: 'CS-RES-002',
            description: 'An unmanaged or pooled IDisposable resource is constructed without a deterministic using block or declaration.',
            reason: 'If an exception occurs or scope exits without Dispose(), native file/database handles remain open until garbage collection finalization.',
            conditions: 'Every execution path, especially when exceptions occur before manual disposal.',
            impact: 'Connection pool exhaustion, file locking errors, and memory leaks.',
            suggestion: 'Prefix the variable declaration with "using" so Dispose() runs deterministically at scope exit.',
            originalCode: line,
            suggestedCode: line.replace(/^(\s*)(var|[A-Za-z0-9_]+)\s+/, '$1using $2 '),
            evidence: `IDisposable constructor call without "using" at line ${lineNum}.`,
          })
        );
      }

      // CS-SEC-001: SQL string interpolation / concatenation
      if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(trimmed) && (trimmed.includes('$"') || trimmed.includes('$@"'))) {
        findings.push(
          makeFinding(sessionId, {
            title: 'Potential SQL injection via interpolated SQL query string',
            category: 'Security',
            severity: 'Critical',
            filePath: change.filePath,
            lineNumber: lineNum,
            confidence: 0.95,
            detectionSource: 'Roslyn Rule',
            ruleId: 'CS-SEC-001',
            description: 'A SQL statement is constructed using C# string interpolation ($"...{var}...").',
            reason: 'Interpolating user-controlled or external strings directly into SQL allows attackers to alter query syntax and execute arbitrary SQL commands.',
            conditions: 'Whenever the interpolated argument originates from an API request, header, or unvalidated input.',
            impact: 'Unauthorized data exfiltration, record tampering, or full database compromise.',
            suggestion: 'Use parameterized SQL queries (e.g. SqlParameter / Dapper anonymous parameters / EF Core FormattableString).',
            originalCode: line,
            suggestedCode: `const string sql = "SELECT * FROM PromoAudit WHERE Code = @PromoCode ORDER BY CreatedAtUtc DESC";\n// Pass new { PromoCode = promoCode } as SQL parameters`,
            evidence: `Interpolated SQL literal detected at line ${lineNum}: "${trimmed}".`,
          })
        );
      }

      // CS-EXC-001: Swallowed exception in catch block
      if (/^catch\s*(\([^)]*\))?\s*$/.test(trimmed)) {
        const nextFew = lines.slice(i + 1, i + 7).join('\n');
        if (nextFew.includes('return null;') || /\{\s*\}/.test(nextFew)) {
          findings.push(
            makeFinding(sessionId, {
              title: 'Exception caught and silently swallowed',
              category: 'Bug',
              severity: 'Medium',
              filePath: change.filePath,
              lineNumber: lineNum,
              endLineNumber: Math.min(lines.length, lineNum + 4),
              confidence: 0.89,
              detectionSource: 'Roslyn Rule',
              ruleId: 'CS-EXC-001',
              description: 'Catch block catches broad System.Exception and returns null / ignores the error without logging or rethrowing.',
              reason: 'Swallowing all exceptions masks database outages, cancellation errors, and programming bugs as "not found" states.',
              conditions: 'Any transient failure, timeout, or invalid operation inside the try block.',
              impact: 'Silent data failures, impossible production debugging, and misleading HTTP 404 responses on server faults.',
              suggestion: 'Log the exception via ILogger with structured context and rethrow or handle specific expected exception types only.',
              originalCode: getLineSnippet(lines, i, 5),
              suggestedCode: `catch (OperationCanceledException)\n{\n    throw;\n}\ncatch (Exception ex)\n{\n    _logger.LogError(ex, "Failed to retrieve order summary for {OrderId}", orderId);\n    throw;\n}`,
              evidence: `Broad catch block at line ${lineNum} returns null without logging or filtering OperationCanceledException.`,
            })
          );
        }
      }

      // CS-PERF-001: .Count() > 0 instead of .Any()
      if (/\.Count\(\)\s*>\s*0/.test(trimmed)) {
        findings.push(
          makeFinding(sessionId, {
            title: 'Use Enumerable.Any() instead of Count() > 0',
            category: 'Performance',
            severity: 'Low',
            filePath: change.filePath,
            lineNumber: lineNum,
            confidence: 0.96,
            detectionSource: 'Roslyn Rule',
            ruleId: 'CS-PERF-001',
            description: 'Checking sequence non-emptiness via .Count() > 0.',
            reason: 'For non-ICollection sequences, Count() enumerates every element instead of stopping at the first item; Any() expresses intent clearly in O(1).',
            conditions: 'Every execution of this conditional check.',
            impact: 'Unnecessary sequence enumeration and degraded code clarity.',
            suggestion: 'Replace .Count() > 0 with .Any().',
            originalCode: line,
            suggestedCode: line.replace(/\.Count\(\)\s*>\s*0/g, '.Any()'),
            evidence: `Expression ".Count() > 0" found at line ${lineNum}.`,
          })
        );
      }

      // CS-NULL-001: Nullable repository/lookup result dereferenced without null check
      const assignMatch = trimmed.match(/^(?:var|[A-Za-z0-9_?]+)\s+([a-zA-Z0-9_]+)\s*=\s*(?:await\s+)?[A-Za-z0-9_.]*(?:Get[A-Za-z0-9_]*Async|FirstOrDefault|SingleOrDefault|FindAsync)\s*\(/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const lookahead = lines.slice(i + 1, Math.min(lines.length, i + 10));
        const hasNullCheck = lookahead.some((l) =>
          new RegExp(`\\b${varName}\\s*(==|!=|is\\s+null|is\\s+not\\s+null|\\?\\.)`).test(l)
        );
        const derefIdx = lookahead.findIndex((l) => !l.trim().startsWith('//') && new RegExp(`\\b${varName}\\.[A-Za-z0-9_]+`).test(l));
        if (!hasNullCheck && derefIdx >= 0) {
          const derefLineNum = lineNum + 1 + derefIdx;
          const derefLine = lines[derefLineNum - 1];
          findings.push(
            makeFinding(sessionId, {
              title: `Potential NullReferenceException dereferencing "${varName}"`,
              category: 'Bug',
              severity: 'Critical',
              filePath: change.filePath,
              lineNumber: derefLineNum,
              confidence: 0.94,
              detectionSource: 'Roslyn Rule',
              ruleId: 'CS-NULL-001',
              description: `Variable "${varName}" is assigned from a nullable lookup method and dereferenced without a null check.`,
              reason:
                'Methods returning Task<T?> (such as GetCustomerByIdAsync or FirstOrDefault) return null when no matching record exists. Accessing members directly throws NullReferenceException.',
              conditions: `Occurs whenever the queried record (${varName}) does not exist in the data store.`,
              impact: 'Unhandled 500 Internal Server Error / NullReferenceException in production order creation flow.',
              suggestion: `Guard "${varName} is null" immediately after the lookup and throw a domain-specific exception or return early.`,
              originalCode: `${line}\n${derefLine}`,
              suggestedCode: `${line}\nif (${varName} is null)\n{\n    throw new KeyNotFoundException($"Record for ${varName} was not found.");\n}\n${derefLine}`,
              evidence: `"${varName}" assigned from nullable lookup on line ${lineNum} and accessed on line ${derefLineNum} without null guard.`,
            })
          );
        }
      }
    }

    // 3. CS-VAL-001: Missing request null guard in CreateOrderAsync / public service entrypoints
    const methodMatch = code.match(/public\s+async\s+Task<[^>]+>\s+([A-Za-z0-9_]+)\s*\(([A-Za-z0-9_]+)\s+([a-z][A-Za-z0-9_]*)/);
    if (methodMatch && !code.includes(`ArgumentNullException.ThrowIfNull(${methodMatch[3]})`) && !code.includes(`${methodMatch[3]} is null`)) {
      const mLineIdx = lines.findIndex((l) => l.includes(methodMatch[0]));
      if (mLineIdx >= 0) {
        findings.push(
          makeFinding(sessionId, {
            title: `Missing null validation for parameter "${methodMatch[3]}" in ${methodMatch[1]}`,
            category: 'Maintainability',
            severity: 'Medium',
            filePath: change.filePath,
            lineNumber: mLineIdx + 1,
            confidence: 0.87,
            detectionSource: 'Custom Rule',
            ruleId: 'CS-VAL-001',
            description: `Public service method ${methodMatch[1]} accepts reference type "${methodMatch[3]}" without validating ArgumentNullException.ThrowIfNull.`,
            reason: 'Previously guarded public service entrypoints should fail fast with ArgumentNullException rather than crashing mid-execution.',
            conditions: `When an internal caller or test invokes ${methodMatch[1]} with null.`,
            impact: 'Delayed NullReferenceException deep inside business logic instead of clear contract validation.',
            suggestion: `Restore ArgumentNullException.ThrowIfNull(${methodMatch[3]}); at the start of ${methodMatch[1]}.`,
            originalCode: getLineSnippet(lines, mLineIdx, 3),
            suggestedCode: `${lines[mLineIdx]}\n    {\n        ArgumentNullException.ThrowIfNull(${methodMatch[3]});`,
            evidence: `Public method ${methodMatch[1]}(${methodMatch[2]} ${methodMatch[3]}) lacks ArgumentNullException.ThrowIfNull(${methodMatch[3]}).`,
          })
        );
      }
    }
  }

  return findings;
}
