# Phase 2 Implementation Plan: Enhanced Development Features

## Overview

Phase 2 focuses on developer productivity and code quality features for the SPtraderB IDE. Building on the solid foundation of Phase 1 (file management, execution, and preview), we'll add Python-specific development tools.

## Architecture Principles

### 1. Separation of Concerns
- **Rust Backend**: Handles Python tooling, external processes, and file analysis
- **React Frontend**: Manages UI, user interactions, and Monaco editor enhancements
- **Tauri Bridge**: Clean command interface between frontend and backend

### 2. Performance First
- Cache all analysis results to avoid redundant processing
- Debounce real-time features (300ms for typing, immediate for save)
- Use Web Workers for heavy client-side parsing
- Incremental updates rather than full re-analysis

### 3. Progressive Enhancement
- Each feature works independently
- Graceful degradation if tools are unavailable
- User preferences to enable/disable features
- No breaking changes to existing functionality

## Feature 2.1: Python Linting Integration

### Goal
Provide real-time Python code quality feedback directly in the Monaco editor.

### Technical Design

#### Backend (Rust)
```rust
// src-tauri/src/python_tools.rs
pub struct PythonLinter {
    tool: LintTool,  // Ruff, Pylint, or Flake8
    cache: HashMap<PathBuf, LintResult>,
}

#[tauri::command]
pub async fn lint_python_file(
    file_path: String,
    content: String,
    on_save: bool
) -> Result<Vec<Diagnostic>, String> {
    // 1. Check cache if content hasn't changed
    // 2. Run linter in subprocess
    // 3. Parse output to Monaco format
    // 4. Cache results
    // 5. Return diagnostics
}
```

#### Frontend Integration
```typescript
// src/components/MonacoEnhancements/PythonLinter.tsx
export const usePythonLinter = (editor: monaco.editor.IStandaloneCodeEditor) => {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  
  // Debounced lint on type
  const debouncedLint = useMemo(
    () => debounce(async (content: string) => {
      const results = await invoke('lint_python_file', {
        filePath: currentFile,
        content,
        onSave: false
      });
      updateMarkers(results);
    }, 300),
    [currentFile]
  );
  
  // Immediate lint on save
  const lintOnSave = async () => {
    const results = await invoke('lint_python_file', {
      filePath: currentFile,
      content: editor.getValue(),
      onSave: true
    });
    updateMarkers(results);
  };
};
```

#### Diagnostic Format
```typescript
interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  code?: string;  // E.g., "E501" for line too long
  source: string; // "ruff", "pylint", etc.
}
```

### Implementation Steps
1. Add `ruff` to Rust dependencies (fastest Python linter)
2. Create `python_tools.rs` module
3. Implement subprocess execution with timeout
4. Parse linter output format
5. Add Monaco marker management
6. Create settings UI for linter preferences

## Feature 2.2: Auto-completion for Imports

### Goal
Provide intelligent import suggestions for workspace modules and common libraries.

### Technical Design

#### Workspace Indexing
```rust
// src-tauri/src/workspace_index.rs
pub struct WorkspaceIndex {
    modules: HashMap<String, ModuleInfo>,
    symbols: HashMap<String, Vec<SymbolLocation>>,
    import_graph: DirectedGraph<String>,
}

pub struct ModuleInfo {
    path: PathBuf,
    exports: Vec<Symbol>,
    imports: Vec<ImportStatement>,
    last_modified: SystemTime,
}

#[tauri::command]
pub async fn get_import_suggestions(
    partial_import: String,
    current_file: String
) -> Result<Vec<CompletionItem>, String> {
    // 1. Match partial against indexed modules
    // 2. Consider import distance (prefer local modules)
    // 3. Include common patterns from workspace
    // 4. Return completion items
}
```

#### Frontend Completion Provider
```typescript
// src/components/MonacoEnhancements/ImportCompleter.tsx
export const registerImportCompletion = (monaco: Monaco) => {
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: [' ', '.'],
    
    async provideCompletionItems(model, position) {
      const lineContent = model.getLineContent(position.lineNumber);
      
      // Detect import context
      if (lineContent.match(/^from\s+(\S*)?$/)) {
        return provideModuleCompletions(position);
      }
      
      if (lineContent.match(/^import\s+(\S*)?$/)) {
        return provideDirectImports(position);
      }
      
      // Auto-import for undefined names
      const word = model.getWordAtPosition(position);
      if (word && !isDefinedInScope(word.word)) {
        return provideAutoImportSuggestions(word.word);
      }
    }
  });
};
```

#### Completion Items
```typescript
interface ImportCompletion extends monaco.languages.CompletionItem {
  kind: monaco.languages.CompletionItemKind.Module;
  insertText: string;  // "from core.indicators.momentum import rsi"
  documentation?: string;  // Module docstring
  additionalTextEdits?: TextEdit[];  // Add import at top
}
```

### Smart Features
1. **Auto-import**: Suggest imports for undefined names
2. **Import organization**: Sort and group imports
3. **Relative import conversion**: Convert between absolute/relative
4. **Popular imports**: Learn from workspace patterns

### Implementation Steps
1. Create workspace indexer in Rust
2. Parse Python files for exports using regex (fast) or AST (accurate)
3. Build module dependency graph
4. Register Monaco completion provider
5. Add quick-fix actions for missing imports
6. Cache index with file watching for updates

## Feature 2.3: Inline Metadata Validation

### Goal
Validate component metadata in real-time with helpful error messages and quick fixes.

### Technical Design

#### Metadata Schema
```typescript
// src/schemas/component-metadata.schema.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]*$",
      "description": "Component identifier (snake_case)"
    },
    "category": {
      "type": "string",
      "enum": ["momentum", "trend", "volatility", "volume", "microstructure"]
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "status": {
      "type": "string",
      "enum": ["prototype", "in_progress", "ready"]
    },
    "parameters": {
      "type": "object",
      "patternProperties": {
        "^[a-z_]+$": {
          "type": "object",
          "required": ["type", "default"],
          "properties": {
            "type": { "enum": ["int", "float", "str", "bool"] },
            "default": {},
            "min": { "type": "number" },
            "max": { "type": "number" }
          }
        }
      }
    }
  },
  "required": ["name", "category", "version"]
}
```

#### Validation Engine
```typescript
// src/components/MonacoEnhancements/MetadataValidator.tsx
export const useMetadataValidation = (editor: monaco.editor.IStandaloneCodeEditor) => {
  const validateMetadata = async (content: string) => {
    // 1. Extract __metadata__ dict using regex
    const metadataMatch = content.match(/__metadata__\s*=\s*({[\s\S]*?})\n/);
    if (!metadataMatch) return;
    
    // 2. Parse as JSON (with Python to JSON conversion)
    const metadata = pythonDictToJson(metadataMatch[1]);
    
    // 3. Validate against schema
    const errors = validateAgainstSchema(metadata, componentSchema);
    
    // 4. Create Monaco markers for errors
    const markers = errors.map(error => ({
      severity: monaco.MarkerSeverity.Warning,
      startLineNumber: getLineNumber(error.path),
      startColumn: getColumnNumber(error.path),
      endLineNumber: getLineNumber(error.path),
      endColumn: getColumnNumber(error.path) + error.property.length,
      message: error.message,
      source: 'metadata-validator'
    }));
    
    monaco.editor.setModelMarkers(editor.getModel(), 'metadata', markers);
  };
};
```

#### Quick Fixes
```typescript
// Provide code actions for common issues
monaco.languages.registerCodeActionProvider('python', {
  provideCodeActions(model, range, context) {
    const actions = [];
    
    // Fix missing required fields
    if (context.markers.some(m => m.message.includes('required'))) {
      actions.push({
        title: 'Add missing metadata fields',
        kind: 'quickfix',
        edit: generateMissingFieldsEdit()
      });
    }
    
    // Fix invalid version format
    if (context.markers.some(m => m.message.includes('version'))) {
      actions.push({
        title: 'Fix version format (use semantic versioning)',
        kind: 'quickfix',
        edit: fixVersionFormat()
      });
    }
    
    return actions;
  }
});
```

### Implementation Steps
1. Define JSON schemas for each component type
2. Create Python dict to JSON parser (handle single quotes, True/False, etc.)
3. Integrate AJV or similar for JSON schema validation
4. Map validation errors to source positions
5. Register code action provider for quick fixes
6. Add hover provider for metadata field documentation

## Feature 2.4: Git Integration (Bonus)

### Goal
Show file changes and git status directly in the IDE.

### Technical Design
```rust
#[tauri::command]
pub async fn get_file_diff(file_path: String) -> Result<DiffInfo, String> {
    // Use git2 crate to get unstaged changes
    let repo = Repository::open(&workspace_path)?;
    let diff = repo.diff_index_to_workdir(None, None)?;
    // Return line-by-line diff
}
```

## Implementation Timeline

### Week 1: Python Linting
- Days 1-2: Rust backend implementation
- Days 3-4: Frontend integration
- Day 5: Testing and settings UI

### Week 2: Import Auto-completion
- Days 1-2: Workspace indexer
- Days 3-4: Completion provider
- Day 5: Quick fixes and optimization

### Week 3: Metadata Validation
- Days 1-2: Schema definition and validator
- Days 3-4: Error display and quick fixes
- Day 5: Documentation and polish

## Testing Strategy

### Unit Tests
- Linter output parsing
- Import suggestion logic
- Metadata validation rules

### Integration Tests
- Full linting workflow
- Import completion scenarios
- Metadata validation with quick fixes

### Performance Tests
- Linting large files
- Workspace indexing speed
- Validation responsiveness

## Success Metrics

1. **Linting**: < 100ms for average file
2. **Import suggestions**: < 50ms response time
3. **Metadata validation**: Real-time with < 10ms delay
4. **User satisfaction**: Reduced errors, faster development

## Risk Mitigation

1. **External tool availability**: Graceful fallback if ruff/pylint not installed
2. **Performance impact**: Careful debouncing and caching
3. **Parser accuracy**: Start with regex, upgrade to AST if needed
4. **User experience**: Settings to disable features if unwanted

## Future Enhancements

1. **Type checking**: Integrate mypy for type annotations
2. **Docstring generation**: AI-powered documentation
3. **Refactoring tools**: Rename, extract method, etc.
4. **Test integration**: Run tests inline with coverage
5. **Performance profiling**: Show execution hotspots

This plan builds on the excellent foundation of Phase 1 and the Component Metadata Architecture, providing a professional Python development experience within SPtraderB.