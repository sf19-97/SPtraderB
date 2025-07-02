# Prompt for Implementing Orchestrator UI Phases 1-2

## Context
You are implementing the UI for the SPtraderB Orchestrator, a unified trading system that handles both backtesting and live trading. The full implementation plan is in `/docs/ORCHESTRATOR_UI_PLAN.md`. This prompt covers Phases 1 and 2.

## Your Task
Implement Phase 1 (Core Infrastructure) and Phase 2 (Backtest Interface) of the Orchestrator UI according to the plan.

## Existing Codebase Context
- The app uses React + TypeScript with Mantine UI components
- Tauri v2 for desktop integration
- Existing patterns: BuildContext for state management, similar to TradingContext
- The test implementation is in `/src/pages/OrchestratorTestPage.tsx` - use this as reference
- Rust backend orchestrator is in `/src-tauri/src/orchestrator/mod.rs`

## Phase 1: Core Infrastructure (Priority: HIGH)

### 1.1 Route Setup
Create the following files:

1. **Update `/src/App.tsx`**:
   - Add route for `/orchestrator`
   - Import and render OrchestratorPage component

2. **Create `/src/pages/OrchestratorPage.tsx`**:
   ```typescript
   // Main orchestrator page component
   // Should have header, sidebar, main content area, status bar
   // Use Mantine AppShell component for layout
   ```

3. **Create `/src/contexts/OrchestratorContext.tsx`**:
   ```typescript
   // Follow the pattern from BuildContext.tsx
   // Include state for: mode, strategies, backtest config/results, logs
   // Persist selected strategy and mode to localStorage
   ```

### 1.2 Layout Structure
In `OrchestratorPage.tsx`, implement:
- **Header**: Mode selector (Backtest/Paper/Live), connection status indicator
- **Sidebar**: Strategy list with search/filter
- **Main Area**: Tabs for different functions (Backtest, Performance, Risk, etc.)
- **Status Bar**: System logs and notifications

### 1.3 Strategy Management
Create these components in `/src/components/orchestrator/`:

1. **StrategyList.tsx**:
   - List all YAML files from `/workspace/strategies/`
   - Use existing `get_workspace_tree` Tauri command
   - Show strategy name, description from metadata
   - Selection handling

2. **StrategyDetails.tsx**:
   - Display selected strategy's YAML content
   - Parse and show: signals, parameters, risk settings
   - Use Monaco editor in read-only mode for syntax highlighting

3. **StrategySelector.tsx**:
   - Dropdown or list for quick strategy switching
   - Update OrchestratorContext on selection

## Phase 2: Backtest Interface (Priority: HIGH)

### 2.1 Backtest Configuration
Create `/src/components/orchestrator/backtest/`:

1. **BacktestConfig.tsx**:
   ```typescript
   // Form with:
   // - Date range picker (use Mantine DatePickerInput)
   // - Data source selector (Database/Parquet radio buttons)
   // - If Database: Symbol and Timeframe dropdowns
   // - If Parquet: File selector (list from /workspace/data/)
   // - Initial capital input (default: 100000)
   // - Slippage/commission inputs (optional)
   ```

2. **DataSourceSelector.tsx**:
   - Radio group for Database vs Parquet
   - Conditional rendering of relevant options
   - Use existing `list_test_datasets` command for Parquet files

### 2.2 Backtest Execution
1. **Create Tauri command wrapper**:
   ```typescript
   // In /src/lib/orchestrator.ts
   async function runBacktest(config: BacktestConfig): Promise<string> {
     return await invoke('run_orchestrator_backtest', { config });
   }
   ```

2. **BacktestRunner.tsx**:
   - Run button with loading state
   - Progress indicator (if possible)
   - Cancel button
   - Real-time log display (use Mantine ScrollArea)

### 2.3 Results Display
Create components for results:

1. **BacktestResults.tsx**:
   - Portfolio summary card showing:
     - Final value, Total return %, Sharpe ratio
     - Max drawdown, Win rate
   - Use Mantine Stats component

2. **EquityCurve.tsx**:
   - Line chart of portfolio value over time
   - Use Recharts or lightweight-charts
   - Show drawdown periods in red

3. **TradeHistory.tsx**:
   - Table with columns: Entry Time, Exit Time, Symbol, Side, Quantity, P&L
   - Use Mantine Table with sorting
   - Export to CSV button

## Implementation Requirements

### State Management
The OrchestratorContext should handle:
```typescript
interface OrchestratorState {
  // Core
  mode: 'backtest' | 'paper' | 'live';
  isConnected: boolean;
  
  // Strategies
  strategies: StrategyInfo[];
  selectedStrategy: StrategyInfo | null;
  
  // Backtest
  backtestConfig: {
    startDate: Date;
    endDate: Date;
    dataSource: 'database' | 'parquet';
    symbol?: string;
    timeframe?: string;
    parquetFile?: string;
    initialCapital: number;
  };
  backtestResults: BacktestResults | null;
  isBacktestRunning: boolean;
  backtestLogs: string[];
}
```

### Tauri Integration
You'll need to use these existing commands:
- `get_workspace_tree` - List strategy files
- `read_component_file` - Read strategy YAML
- `list_test_datasets` - List Parquet files
- `run_orchestrator_backtest` - Execute backtest (may need to be created)

### UI/UX Guidelines
1. Use Mantine components consistently
2. Show loading states for all async operations
3. Display errors in Mantine notifications
4. Persist user preferences to localStorage
5. Make the UI responsive (test at different screen sizes)

### Testing Your Implementation
1. Create a test strategy if none exist
2. Run a backtest with sample data
3. Verify results display correctly
4. Test error cases (invalid dates, missing data)

## Deliverables Checklist

### Phase 1:
- [ ] `/orchestrator` route working
- [ ] OrchestratorPage with proper layout
- [ ] OrchestratorContext managing state
- [ ] Strategy list loading from filesystem
- [ ] Strategy selection and viewing

### Phase 2:
- [ ] Backtest configuration form
- [ ] Data source selection (DB/Parquet)
- [ ] Backtest execution with progress
- [ ] Results display with metrics
- [ ] Equity curve chart
- [ ] Trade history table

## References
- Full plan: `/docs/ORCHESTRATOR_UI_PLAN.md`
- Test implementation: `/src/pages/OrchestratorTestPage.tsx`
- Orchestrator backend: `/src-tauri/src/orchestrator/mod.rs`
- Similar patterns: BuildContext, DataIngestionPage

## Notes
- Start with Phase 1.1 (route setup) and work sequentially
- Test each component as you build it
- Reuse existing Tauri commands where possible
- Ask for clarification if any requirements are unclear
- Focus on functionality first, polish later