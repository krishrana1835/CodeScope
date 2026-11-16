import { DiffEditor, Editor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useEffect, useRef } from 'react';

// Configure Monaco locally so it never depends on an external CDN
if (typeof self !== 'undefined' && !(self as unknown as Record<string, unknown>).MonacoEnvironment) {
  (self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') return new jsonWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
}

loader.config({ monaco });

export function detectMonacoLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csproj') || lower.endsWith('.xml') || lower.endsWith('.config')) return 'xml';
  return 'plaintext';
}

interface MonacoDiffPaneProps {
  original: string;
  modified: string;
  filePath: string;
  height?: string;
  renderSideBySide?: boolean;
}

export function MonacoDiffPane({
  original,
  modified,
  filePath,
  height = '320px',
  renderSideBySide = true,
}: MonacoDiffPaneProps) {
  const language = detectMonacoLanguage(filePath);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-800 bg-[#1E1E1E]" style={{ height }}>
      <DiffEditor
        height={height}
        language={language}
        original={original}
        modified={modified}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12.5,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          lineNumbers: 'on',
          automaticLayout: true,
          diffWordWrap: 'on',
          renderOverviewRuler: false,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}

interface MonacoCodePaneProps {
  code: string;
  filePath: string;
  highlightLine?: number;
  height?: string;
  languageOverride?: string;
}

export function MonacoCodePane({
  code,
  filePath,
  highlightLine,
  height = '420px',
  languageOverride,
}: MonacoCodePaneProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !highlightLine || highlightLine < 1) return;
    editor.revealLineInCenter(highlightLine);
    editor.setPosition({ lineNumber: highlightLine, column: 1 });
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(highlightLine, 1, highlightLine, 1),
        options: {
          isWholeLine: true,
          className: 'bg-blue-500/15',
        },
      },
    ]);
  }, [highlightLine, code]);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-800 bg-[#1E1E1E]" style={{ height }}>
      <Editor
        height={height}
        language={languageOverride ?? detectMonacoLanguage(filePath)}
        value={code}
        theme="vs-dark"
        onMount={(editor) => {
          editorRef.current = editor;
          if (highlightLine && highlightLine > 0) {
            editor.revealLineInCenter(highlightLine);
            editor.setPosition({ lineNumber: highlightLine, column: 1 });
            decorationsRef.current = editor.createDecorationsCollection([
              {
                range: new monaco.Range(highlightLine, 1, highlightLine, 1),
                options: {
                  isWholeLine: true,
                  className: 'bg-blue-500/15',
                },
              },
            ]);
          }
        }}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12.5,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          lineNumbers: 'on',
          automaticLayout: true,
          wordWrap: 'on',
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
