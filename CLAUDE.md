# SPtraderB Project Context

## Project Overview
SPtraderB is a desktop trading application built with Tauri v2 that implements a fractal candlestick charting system. The application automatically adjusts chart timeframes based on zoom levels, providing a seamless multi-resolution viewing experience for forex trading data.

## Technology Stack
- **Frontend**: React + TypeScript with TradingView Lightweight Charts v5
- **Backend**: Rust + Tauri v2
- **Database**: PostgreSQL 17 with TimescaleDB extension
- **Data Source**: Dukascopy historical forex tick data
- **Data Ingestion**: Python script for downloading and processing tick data

## Key Features
1. **Fractal Zoom System**: Automatically switches between timeframes (5m, 15m, 1h, 4h, 12h) based on candle width
2. **Matrix-themed Login**: Falling green characters with "redpill" password access
3. **State Machine**: Prevents race conditions during timeframe transitions
4. **Performance Optimized**: Smart data loading with TimescaleDB continuous aggregates

## Project Structure
- `/src/` - React/TypeScript frontend code
  - `App.tsx` - Main trading interface
  - `components/AdaptiveChart.tsx` - Fractal chart component
  - `components/MatrixLogin.tsx` - Matrix-themed login screen
- `/src-tauri/` - Rust/Tauri backend code
  - Database queries and data serving
- `/data-ingestion/` - Python scripts for data ingestion
  - `dukascopy_ingester.py` - Downloads forex tick data

## Development Commands
```bash
# Start development server
npm run dev

# Run Tauri in development mode
npm run tauri dev

# Build for production
npm run tauri build

# Lint and type checking (if available)
npm run lint
npm run typecheck
```

## Database Setup
The project requires PostgreSQL 17 with TimescaleDB extension. The database contains:
- Tick data table (forex_ticks)
- Continuous aggregates for 5m, 15m, 1h, 4h, 12h timeframes
- Currently loaded with 5 months of EURUSD data (Jan 2 - May 31, 2024)
- **IMPORTANT**: The "volume" field in candles represents tick count (number of price updates), NOT traded volume
- Candles use bid prices only for OHLC calculations
- See `/docs/DATABASE_SCHEMA.md` for complete schema documentation

## Important Notes
- The Matrix login uses "redpill" as the password
- The fractal zoom switches timeframes when:
  - Candle width < 5 pixels: Switch to higher timeframe (zoom out)
  - Candle width > 30 pixels: Switch to lower timeframe (zoom in)
- State machine prevents concurrent transitions to avoid oscillation

## AdaptiveChart.tsx∙LatestCopyPublish🐛 
Bug Fix: React Closure Issue in Adaptive Chart
Problem:
The adaptive timeframe switching feature was failing after the first transition due to a React closure bug. The setInterval callback was capturing the initial state value and never seeing updates.
Root Cause

setInterval in useEffect with empty dependency array creates a closure
The interval callback always saw currentTimeframe as its initial value
Even after state updates, the interval logic used stale data

Solution
Implemented useRef to mirror the state value:

currentTimeframeRef maintains the current timeframe value
All interval logic now uses currentTimeframeRef.current
Both state and ref are updated together to keep them in sync

Changes Made

Added currentTimeframeRef to track current timeframe in real-time
Updated all interval logic to use the ref instead of state
Modified switchTimeframe to pass previousTimeframe for correct bar spacing calculations
Fixed comparison logic in loadDataAndMaintainView

Testing

✅ Zoom in from 1h → switches to 15m
✅ Zoom out from 15m → switches back to 1h
✅ Multiple zoom transitions work correctly
✅ Manual timeframe selection still works

Lessons Learned
This is a common React pattern that developers should watch for:

Any callback in useEffect with [] dependencies will capture initial state
Use useRef for values that need to be accessed in long-lived callbacks
This applies to: intervals, timers, event listeners, WebSocket handlers

## Recent Updates Log

### Currency Pair Selection & USDJPY Integration
**Date**: January 2025

#### Problem
The trading interface only supported EURUSD. We needed to add support for multiple currency pairs, starting with USDJPY which had been recently ingested.

#### Key Discoveries
1. **USDJPY Decimal Scaling Issue**: The Python ingester was dividing all forex prices by 100,000, which is correct for EUR pairs (5 decimal places) but wrong for JPY pairs which only use 3 decimal places. JPY pairs should be divided by 1,000.
   - Fixed existing USDJPY data in database: `UPDATE forex_ticks SET bid = bid * 100, ask = ask * 100 WHERE symbol = 'USDJPY'`
   - Updated ingester to check for JPY in symbol name

2. **Data Ingestion Process Management**: Implemented cancel functionality for long-running downloads by tracking Python subprocess PIDs in Rust backend state.

#### Implementation
1. Created `PairSelector` component using Mantine Select
2. Added to `MarketDataBar` for easy access
3. Connected to `TradingContext` for state management
4. Updated `AdaptiveChart` to react to symbol changes and reload data

#### Debug Logging Enhancement
Added comprehensive logging to track timeframe changes from the ResolutionTracker:
- All resolution/timeframe logs now prefixed with `[ResolutionTracker]`
- Tracks actual current timeframe using `currentTimeframeRef.current` instead of initial prop
- Provides clear visibility into automatic timeframe transitions based on zoom level

#### Technical Notes
- EURUSD: 5 decimal places (divide by 100,000)
- USDJPY: 3 decimal places (divide by 1,000)
- Download process tracking using HashMap<String, Child> in Rust AppState
- Continuous aggregates must be manually refreshed after bulk data inserts

### Data Pipeline & Chart Improvements
**Date**: January 15, 2025

#### Major Fixes
1. **Chunked Candle Generation**: Fixed "refresh window too small" TimescaleDB error by processing large date ranges in monthly chunks
2. **Process Monitoring**: Added background task to monitor data ingestion completion with event emission
3. **Chart Dynamic Date Loading**: Restored ability to fetch date ranges from database instead of hardcoded values
4. **5m Candles Integration**: 
   - Added 5m candles to UI count display (they were being generated but not shown)
   - Note: 5m candles are generated in the data pipeline but NOT available for chart display (intentional)
   - Chart timeframes remain: 15m, 1h, 4h, 12h only

#### Technical Improvements
- Fixed React closure issues in AdaptiveChart by using refs for stable references
- Maintained smooth fade animations during timeframe transitions
- Added caching for symbol date ranges to reduce API calls
- Fixed useEffect dependency issue in DataIngestionPage causing infinite re-renders

#### Known Issues
- Data Manager query is slow (~13 seconds) due to multiple COUNT(*) operations on large tables
- Suggested optimization: Use PostgreSQL statistics for approximate counts with exact date ranges

## Data Ingestion Pipeline Fix
**Date**: June 15, 2025

### Critical Bugs Fixed

1. **Arc<Mutex> Process Tracking Issue**
   - **Problem**: Process spawning used different Arc references for storage vs retrieval
   - **Root Cause**: Stored process in `state.ingestion_processes` but tried to retrieve from cloned `ingestion_processes`
   - **Fix**: Changed line 328 to use the cloned Arc consistently
   ```rust
   // Before (wrong):
   let mut processes = state.ingestion_processes.lock().await;
   // After (correct):
   let mut processes = ingestion_processes.lock().await;
   ```

2. **"Refresh Window Too Small" Error**
   - **Problem**: TimescaleDB error when generating candles for USDJPY
   - **Root Cause**: Stale metadata created invalid date ranges (refresh_start > refresh_end)
   - **Fix**: Added validation to detect and correct invalid ranges
   ```rust
   let refresh_start = if refresh_start > refresh_end {
       oldest_tick  // Reset to full range if metadata is inconsistent
   } else {
       refresh_start
   };
   ```

3. **Missing Process Completion Events**
   - **Problem**: Downloads appeared frozen at 0% even when working
   - **Fix**: Process monitoring now properly tracks completion and emits events

### Successful Test Results
- Downloaded USDJPY data from July 12, 2024 to December 31, 2024
- 23.7M new ticks added (77.9M total)
- All timeframe candles generated without duplicates
- Weekend gaps handled correctly (no Saturday data, minimal Sunday data)
- Both EURUSD and USDJPY now have complete data through end of 2024

### Pipeline Architecture
1. **Download**: Python script downloads tick data in hourly chunks with 0.1s delays
2. **Storage**: PostgreSQL with ON CONFLICT upsert to handle duplicates
3. **Candle Generation**: TimescaleDB continuous aggregates cascade from ticks → 5m → 15m → 1h → 4h → 12h
4. **Metadata Tracking**: Stores last refresh and tick timestamps to enable incremental updates

### TODO
- Implement auto-generate candles after download completion (currently manual)
- Add pause/resume functionality for downloads
- Optimize Data Manager query performance

## Component Metadata Architecture (Planned)

A comprehensive metadata system where **code is the single source of truth** has been designed and documented in `/docs/COMPONENT_METADATA_ARCHITECTURE.md`. This architecture will:

### Key Features
- **Metadata in Code**: Components define their metadata using Python `__metadata__` dictionaries
- **AST Parsing**: Extract metadata without executing code using Python AST parser
- **SQLite Cache**: Fast queries for UI while maintaining code as truth
- **Live Updates**: File watcher detects changes and updates metadata in real-time
- **Component Discovery**: SQL queries to find components by performance, category, tags, etc.

### Implementation Overview
1. **Python Base Classes**: Components inherit from base classes with metadata validation
2. **Rust Backend**: File watcher + AST parser + SQLite cache for performance
3. **Frontend Integration**: Build page reads from cache with live updates
4. **Developer Workflow**: Templates include metadata, IDE validates on save

### Benefits
- Cannot desync (metadata travels with code through git)
- Enables powerful discovery ("find all fast momentum indicators")
- Tracks real performance metrics, not estimates
- Scales from 10 to 10,000 components

**Status**: Architecture fully designed and ready for implementation when requested.

## Build Center & IDE Implementation (June 2025)

### Overview
Implemented a complete component development environment with a Build Center for browsing trading components and a Monaco-based IDE for editing them.

### Architecture Patterns

#### 1. **Context-Based State Management**
- **BuildContext** (`/src/contexts/BuildContext.tsx`): Maintains UI state across navigation
  - Search terms, selected categories, scroll position persist
  - LocalStorage integration for cross-session persistence
  - Pattern: Similar to TradingContext, wraps components needing shared state

#### 2. **File System Integration Pattern**
```
Frontend (React) → Tauri Command (invoke) → Rust Backend → File System
                                          ↓
                                    Response → Update UI
```
- Commands: `get_workspace_tree`, `read_component_file`, `save_component_file`
- Security: Path validation prevents directory traversal
- All file ops go through Rust for safety

#### 3. **Component Visibility Architecture**
Enforced in `renderFileTree` function:
```typescript
const allowedPaths: Record<string, string[]> = {
  indicator: ['core/indicators'],
  signal: ['core/indicators', 'core/signals'],
  order: ['core/orders', 'core/signals'],
  strategy: ['core', 'strategies']
};
```

### Key Components

1. **BuildPage** (`/src/pages/BuildPage.tsx`)
   - Component library with search/filter
   - Launches IDE with component context
   - Uses BuildContext for state persistence

2. **MonacoIDE** (`/src/components/MonacoIDE.tsx`)
   - Full VS Code-like editing experience
   - File tree with visibility filtering
   - Save functionality integrated with Rust backend
   - Terminal output panel (currently mock data)

3. **IDEHelpModal** (`/src/components/IDEHelpModal.tsx`)
   - Architecture documentation in-app
   - Shows dependency rules per component type
   - Best practices and tips

4. **Workspace Module** (`/src-tauri/src/workspace.rs`)
   - Rust backend for file operations
   - Path security validation
   - Template generation for new components

### Maintenance Guidelines

#### Adding New Component Types
1. Update `allowedPaths` in MonacoIDE.tsx
2. Add template in workspace.rs `create_component_file`
3. Update IDEHelpModal with new type info
4. Add to BuildPage component lists

#### Debugging Common Issues
1. **"Failed to load workspace"**: Check if running from `src-tauri` directory
2. **Save not working**: Verify file permissions in workspace directory
3. **File tree empty**: Ensure `.py` and `.yaml` files exist in workspace

#### State Management Rules
- Use contexts for cross-component state
- Local state for component-specific UI
- Persist important state to localStorage
- Clean up event listeners in useEffect

### Current Status

#### ✅ Completed
- Build Center with component browsing
- IDE with real file loading/saving
- State persistence across navigation
- Architecture documentation modal
- Component visibility enforcement

#### ✅ Recently Completed
1. **Run/Test Functionality**
   - Execute Python code via Tauri command
   - Capture stdout/stderr
   - Display in terminal panel
   - Measure execution time

2. **Create New File**
   - Wire up the "+" button
   - Generate from templates
   - Add to file tree dynamically
   - Support custom categories for indicators

3. **IDE Enhancements**
   - Resizable terminal (drag to adjust height)
   - Resizable file tree (drag to adjust width)
   - Interactive chart with time axis and hover tooltips
   - Flat disk reading with Parquet export/import

#### 📋 Future Phases

**Phase 1: Core IDE Features** ✅ COMPLETE!
- ✅ File browsing/editing
- ✅ Save functionality
- ✅ Run/test execution
- ✅ New file creation

**Phase 2: Enhanced Development**
- Python linting integration
- Auto-completion for imports
- Inline metadata validation
- Git integration (diff view)

**Phase 3: Live Preview**
- Indicator chart visualization
- Signal trigger display
- Order execution simulation
- Mini backtest results

**Phase 4: Component Metadata** (Designed, not implemented)
- See `/docs/COMPONENT_METADATA_ARCHITECTURE.md`
- AST parsing for metadata extraction
- SQLite cache for fast queries
- Component discovery features

### Debugging Tips

1. **Check Browser Console**: Most errors appear here first
2. **Check Terminal**: Rust/Tauri errors show in terminal
3. **Verify Paths**: Use `pwd` in Rust to check working directory
4. **Hot Reload Issues**: Restart dev server if imports fail
5. **State Issues**: Check React DevTools for context values

### Code Organization
```
/src/
  /components/
    MonacoIDE.tsx       # Main IDE component
    IDEHelpModal.tsx    # Architecture help
  /contexts/
    BuildContext.tsx    # State management
  /pages/
    BuildPage.tsx       # Component library
    
/src-tauri/src/
  workspace.rs          # File operations
  main.rs              # Command registration

/workspace/             # User components live here
  /core/
    /indicators/
    /signals/
    /orders/
    /data/              # Data utilities
      loader.py         # Parquet/CSV data loader
      csv_to_parquet.py # CSV to Parquet converter
      export_utils.py   # Export helper functions
  /strategies/
  /data/                # Exported test datasets
```

## Flat Disk Reading Solution for IDE Preview (June 2025)

### Overview
Implemented a complete data export and loading system that allows components to test on real market data exported from the database. This enables rapid iteration without database dependencies.

### Architecture
1. **Database → Parquet Export Pipeline**
   - `export_test_data` function in main.rs exports data directly to Parquet format
   - Uses Arrow 54.2+ to avoid Chrono conflicts
   - Exports to `/workspace/data/` directory
   - Automatic filename generation: `symbol_timeframe_startdate_enddate.parquet`

2. **Python Data Loader**
   - `loader.py` handles Parquet and CSV file loading
   - Automatically sets time column as DataFrame index
   - Lists available datasets with metadata
   - Falls back to sample data if no exports exist

3. **IDE Integration**
   - Database icon (📊) in preview panel opens export modal
   - Export modal allows selection of:
     - Symbol (EURUSD, USDJPY, etc.)
     - Timeframe (5m, 15m, 1h, 4h, 12h)
     - Date range with date pickers
     - Optional custom filename
   - Terminal shows export progress and success

4. **Dataset Selection and Visualization**
   - Dropdown shows all available Parquet files from `/workspace/data/`
   - Selecting a dataset loads OHLC data into preview chart
   - Chart displays candlesticks with proper scaling
   - Components receive selected dataset via `TEST_DATASET` environment variable

### Key Implementation Details

#### Rust Commands
- `export_test_data`: Exports from PostgreSQL to Parquet
- `list_test_datasets`: Lists all .parquet files in workspace/data
- `load_parquet_data`: Reads Parquet and returns chart-compatible format
- Fixed timestamp type mismatch by using `DateTime<Utc>` instead of `NaiveDateTime`
- Fixed volume field mapping to use `tick_count` from database
- Resolved Arrow-Chrono conflict by upgrading to Arrow 54.2

#### Python Components
- Components can load test data with: `data = load_test_data('filename.parquet')`
- Without arguments, loads first available dataset or creates sample data
- Proper datetime indexing for time series operations
- Environment variable `TEST_DATASET` automatically selects dataset in IDE

### Usage Flow
1. **Export Data**:
   - Click database icon in preview panel
   - Select symbol, timeframe, date range
   - Click "Export Data"
   - Creates Parquet file in `/workspace/data/`

2. **Select Dataset**:
   - Dropdown populates with available Parquet files
   - Select dataset to load into chart
   - Chart displays real OHLC candlesticks

3. **Run Component**:
   - Click Run button with dataset selected
   - Component receives dataset name via environment
   - Loads data and performs calculations
   - Results display in terminal

### Testing Results
Successfully tested end-to-end with SMA indicator:
- Exported 476 rows of EURUSD 1h data
- Parquet file size: ~32KB (vs ~300KB for CSV)
- Chart renders candlesticks correctly
- Component loads data and calculates SMA values
- Dataset dropdown works after fixing path resolution

### Implementation Fixes
- Fixed dataset dropdown not responding by creating dedicated `list_test_datasets` command
- Added refresh button for dataset list
- Debug output shows dataset count
- Proper z-index and portal rendering for dropdown

### Features Completed
- ✅ Connect dataset dropdown to component execution
- ✅ Add chart visualization in preview panel with full interactivity
- ✅ Fixed dropdown responsiveness issue
- ✅ Display real component output values (last value, signal, execution time, data points)
- ✅ Parse component output for live updates and indicator overlays
- ✅ Interactive chart with time axis labels and hover tooltips showing OHLC + indicator values
- ✅ Resizable terminal (drag top edge) and file tree (drag right edge)

### Bug Fixes
- Fixed React Hooks order error in PreviewChart (useCallback after early return)
- Fixed invalid DOM props (withinPortal, zIndex) in dataset selector

## Project Organization

### Active Scripts
- `/data-ingestion/dukascopy_ingester.py` - Main forex data download script
- `/data-ingestion/test_data.py` - Database verification tool

### Deprecated Scripts
Moved to `/depreciated/` folder:
- Candle alignment check scripts (used during development for verification)
- Old AdaptiveChart versions

### Component Backups
- `/src/components/backups/` - Working versions of components saved during major changes

## Important Tauri-Specific Considerations

### Browser API Limitations in Tauri
**Date**: January 2025

#### window.confirm() and window.alert() Don't Work
- **Problem**: `window.confirm()`, `window.alert()`, and `window.prompt()` don't display dialogs in Tauri applications - they return default values without showing anything
- **Solution**: Always use proper UI components (e.g., Mantine Modal) for user confirmations and alerts
- **Example**: The file deletion confirmation was fixed by replacing `window.confirm()` with a Mantine Modal component

#### Implementation Pattern for Confirmations
Instead of:
```javascript
const confirmed = window.confirm("Are you sure?");
if (confirmed) { /* proceed */ }
```

Use:
```javascript
// 1. Add state for modal
const [deleteModalOpened, setDeleteModalOpened] = useState(false);
const [itemToDelete, setItemToDelete] = useState(null);

// 2. Show modal instead of confirm
setItemToDelete(item);
setDeleteModalOpened(true);

// 3. Use Mantine Modal component
<Modal opened={deleteModalOpened} onClose={() => setDeleteModalOpened(false)}>
  <Text>Are you sure you want to delete {itemToDelete?.name}?</Text>
  <Button onClick={handleDelete}>Delete</Button>
</Modal>
```

This ensures proper user interaction in the Tauri desktop environment.