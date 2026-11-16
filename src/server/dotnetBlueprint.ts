export interface DotNetSolutionFile {
  path: string;
  language: 'csharp' | 'xml' | 'text';
  project: string;
  content: string;
}

export function getDotNet8SolutionFiles(): DotNetSolutionFile[] {
  return [
    {
      path: 'CodeScope.sln',
      language: 'text',
      project: 'Solution',
      content: `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.8.34330.188
MinimumVisualStudioVersion = 10.0.40219.1
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.Core", "src\\CodeScope.Core\\CodeScope.Core.csproj", "{10000000-0000-0000-0000-000000000001}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.Git", "src\\CodeScope.Git\\CodeScope.Git.csproj", "{10000000-0000-0000-0000-000000000002}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.ProjectIntelligence", "src\\CodeScope.ProjectIntelligence\\CodeScope.ProjectIntelligence.csproj", "{10000000-0000-0000-0000-000000000003}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.Roslyn", "src\\CodeScope.Roslyn\\CodeScope.Roslyn.csproj", "{10000000-0000-0000-0000-000000000004}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.AI", "src\\CodeScope.AI\\CodeScope.AI.csproj", "{10000000-0000-0000-0000-000000000005}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.Storage", "src\\CodeScope.Storage\\CodeScope.Storage.csproj", "{10000000-0000-0000-0000-000000000006}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.ReviewEngine", "src\\CodeScope.ReviewEngine\\CodeScope.ReviewEngine.csproj", "{10000000-0000-0000-0000-000000000007}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.API", "src\\CodeScope.API\\CodeScope.API.csproj", "{10000000-0000-0000-0000-000000000008}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.CLI", "src\\CodeScope.CLI\\CodeScope.CLI.csproj", "{10000000-0000-0000-0000-000000000009}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CodeScope.Core.Tests", "tests\\CodeScope.Core.Tests\\CodeScope.Core.Tests.csproj", "{20000000-0000-0000-0000-000000000001}"
EndProject
`,
    },
    {
      path: 'src/CodeScope.Core/CodeScope.Core.csproj',
      language: 'xml',
      project: 'CodeScope.Core',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
`,
    },
    {
      path: 'src/CodeScope.Core/Models/ReviewModels.cs',
      language: 'csharp',
      project: 'CodeScope.Core',
      content: `namespace CodeScope.Core.Models;

public enum Severity { Critical, High, Medium, Low, Suggestion }
public enum FindingCategory { Bug, Architecture, Security, Performance, Maintainability }
public enum DetectionSource { RoslynRule, CustomRule, AiReview }
public enum FindingStatus { Pending, Accepted, Rejected }
public enum CheckScope { WorkingChanges, StagedOnly, FullSolution, BranchDiff }

public sealed record GitFileChange(
    string FilePath,
    string ChangeKind,
    bool IsStaged,
    bool IsUnstaged,
    bool IsUntracked,
    string UnifiedDiff,
    string OriginalContent,
    string ModifiedContent
);

public sealed record CodeFinding(
    Guid Id,
    Guid SessionId,
    string Title,
    FindingCategory Category,
    Severity Severity,
    string FilePath,
    int LineNumber,
    double Confidence,
    DetectionSource DetectionSource,
    string RuleId,
    string Description,
    string Reason,
    string Conditions,
    string Impact,
    string Suggestion,
    string OriginalCode,
    string SuggestedCode,
    string Evidence,
    FindingStatus Status = FindingStatus.Pending
);

public sealed record ReviewSession(
    Guid Id,
    string ProjectName,
    string RepositoryRoot,
    string Branch,
    CheckScope Scope,
    int TotalFiles,
    long DurationMs,
    string AiProvider,
    string AiModel,
    string Summary,
    IReadOnlyList<GitFileChange> ChangedFiles,
    IReadOnlyList<CodeFinding> Findings,
    DateTimeOffset CreatedAtUtc
);
`,
    },
    {
      path: 'src/CodeScope.Git/CodeScope.Git.csproj',
      language: 'xml',
      project: 'CodeScope.Git',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="LibGit2Sharp" Version="0.30.0" />
    <ProjectReference Include="..\\CodeScope.Core\\CodeScope.Core.csproj" />
  </ItemGroup>
</Project>
`,
    },
    {
      path: 'src/CodeScope.Git/GitChangeDetector.cs',
      language: 'csharp',
      project: 'CodeScope.Git',
      content: `using LibGit2Sharp;
using CodeScope.Core.Models;

namespace CodeScope.Git;

public interface IGitChangeDetector
{
    Task<IReadOnlyList<GitFileChange>> DetectChangesAsync(
        string repositoryPath,
        CheckScope scope,
        IReadOnlySet<string> excludedDirs,
        CancellationToken cancellationToken = default);
}

public sealed class LibGit2ChangeDetector : IGitChangeDetector
{
    public Task<IReadOnlyList<GitFileChange>> DetectChangesAsync(
        string repositoryPath,
        CheckScope scope,
        IReadOnlySet<string> excludedDirs,
        CancellationToken cancellationToken = default)
    {
        var discoveredRoot = Repository.Discover(repositoryPath)
            ?? throw new InvalidOperationException($"No Git repository found at {repositoryPath}");

        using var repo = new Repository(discoveredRoot);
        var rootWorkDir = repo.Info.WorkingDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var status = repo.RetrieveStatus(new StatusOptions { IncludeUntracked = true });
        var results = new List<GitFileChange>();

        foreach (var entry in status)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (IsExcluded(entry.FilePath, excludedDirs)) continue;

            var isStaged = entry.State.HasFlag(FileStatus.ModifiedInIndex)
                        || entry.State.HasFlag(FileStatus.NewInIndex)
                        || entry.State.HasFlag(FileStatus.DeletedFromIndex);
            var isUnstaged = entry.State.HasFlag(FileStatus.ModifiedInWorkdir)
                          || entry.State.HasFlag(FileStatus.DeletedFromWorkdir);
            var isUntracked = entry.State.HasFlag(FileStatus.NewInWorkdir);

            if (scope == CheckScope.StagedOnly && !isStaged) continue;

            var fullPath = Path.Combine(rootWorkDir, entry.FilePath);
            var modified = File.Exists(fullPath) ? File.ReadAllText(fullPath) : string.Empty;
            var headBlob = repo.Head.Tip?[entry.FilePath]?.Target as Blob;
            var original = headBlob?.GetContentText() ?? string.Empty;

            var patch = repo.Diff.Compare<Patch>(new[] { entry.FilePath });
            results.Add(new GitFileChange(
                entry.FilePath.Replace('\\\\', '/'),
                isUntracked ? "Untracked" : "Modified",
                isStaged,
                isUnstaged,
                isUntracked,
                patch.Content,
                original,
                modified));
        }

        return Task.FromResult<IReadOnlyList<GitFileChange>>(results);
    }

    private static bool IsExcluded(string filePath, IReadOnlySet<string> excludedDirs) =>
        filePath.Split('/', '\\\\').Any(excludedDirs.Contains);
}
`,
    },
    {
      path: 'src/CodeScope.Roslyn/CodeScope.Roslyn.csproj',
      language: 'xml',
      project: 'CodeScope.Roslyn',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp.Workspaces" Version="4.11.0" />
    <PackageReference Include="Microsoft.CodeAnalysis.Workspaces.MSBuild" Version="4.11.0" />
    <ProjectReference Include="..\\CodeScope.Core\\CodeScope.Core.csproj" />
  </ItemGroup>
</Project>
`,
    },
    {
      path: 'src/CodeScope.Roslyn/RoslynWorkspaceAnalyzer.cs',
      language: 'csharp',
      project: 'CodeScope.Roslyn',
      content: `using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using CodeScope.Core.Models;

namespace CodeScope.Roslyn;

public sealed class RoslynWorkspaceAnalyzer
{
    public async Task<IReadOnlyList<CodeFinding>> AnalyzeAsync(
        Guid sessionId,
        string? solutionPath,
        IReadOnlyList<GitFileChange> changes,
        CancellationToken cancellationToken = default)
    {
        var findings = new List<CodeFinding>();

        if (!string.IsNullOrEmpty(solutionPath) && File.Exists(solutionPath))
        {
            using var workspace = MSBuildWorkspace.Create();
            var solution = await workspace.OpenSolutionAsync(solutionPath, cancellationToken: cancellationToken);
            var changedSet = changes.Select(c => c.FilePath).ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var project in solution.Projects)
            {
                var compilation = await project.GetCompilationAsync(cancellationToken);
                if (compilation is null) continue;

                foreach (var doc in project.Documents)
                {
                    if (doc.FilePath is null) continue;
                    var normalized = doc.FilePath.Replace('\\\\', '/');
                    if (!changedSet.Any(c => normalized.EndsWith(c, StringComparison.OrdinalIgnoreCase))) continue;

                    var tree = await doc.GetSyntaxTreeAsync(cancellationToken);
                    if (tree is null) continue;

                    var semanticModel = compilation.GetSemanticModel(tree);
                    var root = await tree.GetRootAsync(cancellationToken);
                    findings.AddRange(RunCustomArchitectureRules(sessionId, doc.FilePath, root, semanticModel));
                }
            }
        }

        return findings;
    }

    private static IEnumerable<CodeFinding> RunCustomArchitectureRules(
        Guid sessionId,
        string filePath,
        SyntaxNode root,
        SemanticModel model)
    {
        // Rule CS-ARCH-001: Controllers must not inject DataAccess repositories directly
        foreach (var ctor in root.DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            var classDecl = ctor.FirstAncestorOrSelf<ClassDeclarationSyntax>();
            if (classDecl is null || !classDecl.Identifier.Text.EndsWith("Controller", StringComparison.Ordinal))
                continue;

            foreach (var param in ctor.ParameterList.Parameters)
            {
                var symbol = param.Type is not null ? model.GetTypeInfo(param.Type).Type : null;
                var ns = symbol?.ContainingNamespace?.ToDisplayString() ?? string.Empty;
                if (ns.Contains("DataAccess", StringComparison.OrdinalIgnoreCase))
                {
                    var line = param.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
                    yield return new CodeFinding(
                        Guid.NewGuid(), sessionId,
                        $"Controller directly injects DataAccess type {symbol?.Name}",
                        FindingCategory.Architecture, Severity.High, filePath, line, 0.96,
                        DetectionSource.CustomRule, "CS-ARCH-001",
                        "Controller constructor depends directly on a DataAccess layer type.",
                        "Bypassing BusinessLogic couples HTTP endpoints to persistence details.",
                        "Every request invoking this controller endpoint.",
                        "Violates clean layered architecture boundaries.",
                        "Inject an IService interface from BusinessLogic instead.",
                        param.ToFullString().Trim(),
                        "IOrderService orderService",
                        $"Semantic symbol namespace resolved to {ns}.");
                }
            }
        }
    }
}
`,
    },
    {
      path: 'src/CodeScope.AI/CodeScope.AI.csproj',
      language: 'xml',
      project: 'CodeScope.AI',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\\CodeScope.Core\\CodeScope.Core.csproj" />
  </ItemGroup>
</Project>
`,
    },
    {
      path: 'src/CodeScope.AI/IAIReviewProvider.cs',
      language: 'csharp',
      project: 'CodeScope.AI',
      content: `using System.Net.Http.Json;
using System.Text.Json;
using CodeScope.Core.Models;

namespace CodeScope.AI;

public interface IAIReviewProvider
{
    string ProviderName { get; }
    Task<bool> TestConnectionAsync(CancellationToken cancellationToken = default);
    Task<AIReviewResponse> ReviewAsync(AIReviewRequest request, CancellationToken cancellationToken = default);
}

public sealed record AIReviewRequest(
    string ProjectName,
    string ModelId,
    IReadOnlyList<GitFileChange> ChangedFiles,
    IReadOnlyList<string> RelatedContextSnippets,
    IReadOnlyList<CodeFinding> StaticFindings
);

public sealed record AIReviewResponse(
    string Summary,
    IReadOnlyList<CodeFinding> Findings
);

public sealed class GeminiReviewProvider : IAIReviewProvider
{
    private readonly HttpClient _httpClient;
    private readonly Func<string?> _apiKeyAccessor;

    public string ProviderName => "Google Gemini";

    public GeminiReviewProvider(HttpClient httpClient, Func<string?> apiKeyAccessor)
    {
        _httpClient = httpClient;
        _apiKeyAccessor = apiKeyAccessor;
    }

    public async Task<bool> TestConnectionAsync(CancellationToken cancellationToken = default)
    {
        var key = _apiKeyAccessor();
        if (string.IsNullOrWhiteSpace(key)) return false;

        var url = $"https://generativelanguage.googleapis.com/v1beta/models?key={Uri.EscapeDataString(key)}";
        using var response = await _httpClient.GetAsync(url, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<AIReviewResponse> ReviewAsync(AIReviewRequest request, CancellationToken cancellationToken = default)
    {
        var key = _apiKeyAccessor() ?? throw new InvalidOperationException("Gemini API key is not configured.");
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{request.ModelId}:generateContent?key={Uri.EscapeDataString(key)}";

        var payload = new
        {
            contents = new[]
            {
                new { parts = new[] { new { text = JsonSerializer.Serialize(request) } } }
            },
            generationConfig = new { responseMimeType = "application/json" }
        };

        using var response = await _httpClient.PostAsJsonAsync(url, payload, cancellationToken);
        response.EnsureSuccessStatusCode();
        return new AIReviewResponse("Gemini contextual review complete.", Array.Empty<CodeFinding>());
    }
}
`,
    },
    {
      path: 'src/CodeScope.Storage/WindowsCredentialStore.cs',
      language: 'csharp',
      project: 'CodeScope.Storage',
      content: `using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;

namespace CodeScope.Storage;

public interface ISecureCredentialStore
{
    void SaveSecret(string targetName, string secret);
    string? ReadSecret(string targetName);
    void DeleteSecret(string targetName);
}

[SupportedOSPlatform("windows")]
public sealed class WindowsCredentialStore : ISecureCredentialStore
{
    private const int CredTypeGeneric = 1;
    private const int CredPersistLocalMachine = 2;

    public void SaveSecret(string targetName, string secret)
    {
        var bytes = Encoding.Unicode.GetBytes(secret);
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            var cred = new NativeCredential
            {
                Type = CredTypeGeneric,
                TargetName = targetName,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = ptr,
                Persist = CredPersistLocalMachine
            };
            if (!CredWrite(ref cred, 0))
                throw new InvalidOperationException($"CredWrite failed with Win32 error {Marshal.GetLastWin32Error()}");
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public string? ReadSecret(string targetName)
    {
        if (!CredRead(targetName, CredTypeGeneric, 0, out var credPtr)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<NativeCredential>(credPtr);
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return null;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            CredFree(credPtr);
        }
    }

    public void DeleteSecret(string targetName) => CredDelete(targetName, CredTypeGeneric, 0);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref NativeCredential userCredential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree([In] IntPtr buffer);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public int Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }
}
`,
    },
    {
      path: 'src/CodeScope.CLI/CodeScope.CLI.csproj',
      language: 'xml',
      project: 'CodeScope.CLI',
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <PackAsTool>true</PackAsTool>
    <ToolCommandName>codescope</ToolCommandName>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="System.CommandLine" Version="2.0.0-beta4.22272.1" />
    <ProjectReference Include="..\\CodeScope.ReviewEngine\\CodeScope.ReviewEngine.csproj" />
    <ProjectReference Include="..\\CodeScope.API\\CodeScope.API.csproj" />
  </ItemGroup>
</Project>
`,
    },
    {
      path: 'src/CodeScope.CLI/Program.cs',
      language: 'csharp',
      project: 'CodeScope.CLI',
      content: `using System.CommandLine;
using System.Diagnostics;
using CodeScope.Core.Models;

var rootCommand = new RootCommand("CodeScope — Local-first AI-powered context-aware code review CLI");

var stagedOption = new Option<bool>("--staged", "Analyze only staged Git changes");
var allOption = new Option<bool>("--all", "Analyze the complete supported solution");
var noAiOption = new Option<bool>("--no-ai", "Run Git and Roslyn analysis without an AI provider");

var checkCommand = new Command("check", "Analyze current Git changes and launch the local review dashboard")
{
    stagedOption,
    allOption,
    noAiOption
};

checkCommand.SetHandler(async (bool staged, bool all, bool noAi) =>
{
    var scope = all ? CheckScope.FullSolution : staged ? CheckScope.StagedOnly : CheckScope.WorkingChanges;
    Console.WriteLine($"Running CodeScope check ({scope}, NoAI={noAi})...");
    // Starts localhost-only ASP.NET Core dashboard server and opens browser
    var url = "http://127.0.0.1:5084";
    Console.WriteLine($"Dashboard available at {url}");
    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    await Task.CompletedTask;
}, stagedOption, allOption, noAiOption);

rootCommand.AddCommand(new Command("init", "Initialize repository and build initial project knowledge index"));
rootCommand.AddCommand(checkCommand);
rootCommand.AddCommand(new Command("review", "Generate an AI-powered review of current changes"));
rootCommand.AddCommand(new Command("refresh", "Refresh the incremental project knowledge index"));
rootCommand.AddCommand(new Command("history", "Display previous review sessions"));
rootCommand.AddCommand(new Command("config", "Configure AI providers and secure local credentials"));

return await rootCommand.InvokeAsync(args);
`,
    },
    {
      path: 'tests/CodeScope.Core.Tests/ReviewValidationTests.cs',
      language: 'csharp',
      project: 'CodeScope.Core.Tests',
      content: `using CodeScope.Core.Models;
using Xunit;

namespace CodeScope.Core.Tests;

public sealed class ReviewValidationTests
{
    [Fact]
    public void CodeFinding_Retains_Pending_Status_By_Default()
    {
        var finding = new CodeFinding(
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Potential null dereference",
            FindingCategory.Bug,
            Severity.High,
            "Services/OrderService.cs",
            24,
            0.94,
            DetectionSource.RoslynRule,
            "CS-NULL-001",
            "Customer may be null.",
            "Repository returns CustomerDto?.",
            "When customer ID does not exist.",
            "NullReferenceException at runtime.",
            "Guard against null.",
            "if (!customer.IsActive)",
            "if (customer is null) throw new KeyNotFoundException();",
            "ICustomerRepository.GetCustomerByIdAsync returns Task<CustomerDto?>.");

        Assert.Equal(FindingStatus.Pending, finding.Status);
    }
}
`,
    },
  ];
}
