# Terminal Logger Implementation Progress

## Completed Work (Phases 1-2)

### Phase 1: Frontend Layout & Visual Structure ✅
**Technical Implementation:**

1. **Layout Restructuring**
   - Removed `Container size="md"` constraint from DataIngestionPage
   - Implemented flexbox layout with 60/40 split using `display: flex`
   - Left panel (`flex: 0 0 60%`) contains all original UI elements
   - Right panel (`flex: 0 0 40%`) contains new terminal logger

2. **TerminalLogger Component Created**
   ```typescript
   // New component: src/components/TerminalLogger.tsx
   interface LogEntry {
     id: number;
     timestamp: string;
     type: 'info' | 'success' | 'warn' | 'error' | 'debug' | 'python' | 'db' | 'candles' | 'perf' | 'user';
     prefix: string;
     message: string;
     color: string;
   }
   ```

3. **Terminal UI Features**
   - Black terminal background (`background: #000`)
   - Terminal header with icon and "ingestion.log" title
   - Scrollable log area with monospace font
   - Status bar showing line count and auto-scroll indicator
   - Color-coded log types with specific colors for each type

4. **Message Redirection**
   - Removed Alert component for status messages
   - Commented out Progress bar component
   - All UI messages now route through `addLog()` function
   - No duplicate messages outside terminal

### Phase 2: Frontend Log Management ✅
**Technical Implementation:**

1. **State Management**
   ```typescript
   const [terminalLogs, setTerminalLogs] = useState<LogEntry[]>([...]);
   const [showDebug, setShowDebug] = useState(false);
   const [autoScroll, setAutoScroll] = useState(true);
   ```

2. **Log Features Implemented**
   - **FIFO Buffer**: 1000 line limit with automatic oldest log removal
   - **Auto-scroll**: Uses `scrollIntoView()` with smooth behavior
   - **Scroll Detection**: `handleScroll()` detects user interaction
   - **Debug Toggle**: Filters logs with `logs.filter(log => showDebug || log.type !== 'debug')`
   - **Clear Function**: Resets logs with "Console cleared" message

3. **Dynamic Currency Pairs**
   ```typescript
   // Extracts unique symbols from database
   const uniqueSymbols = [...new Set(data.map(d => d.symbol))];
   const allPairs = [...new Set([...uniqueSymbols, ...DEFAULT_CURRENCY_PAIRS])];
   setAvailablePairs(allPairs.sort());
   ```

4. **Process Status Indicator**
   - Added `isProcessRunning` prop to TerminalLogger
   - Shows spinner and "RUNNING" text when active
   - Triggered by `isIngesting || refreshingSymbol !== null`

5. **Event Listeners Updated**
   - All Tauri event listeners now call `addLog()` instead of `setStatus()`
   - Progress events captured (ready for backend implementation)
   - User actions logged (download start/stop, candle generation, etc.)

## Architecture & Design Principles

### Core Concepts
1. **No Core Functionality Changes**: The terminal logger is purely additive - it observes and reports without modifying any existing behavior
2. **Event-Driven Logging**: Uses Tauri's event system to stream logs from Rust backend to React frontend
3. **FIFO Buffer Management**: Maintains last 1000 logs in memory to prevent unbounded growth
4. **Multi-Source Integration**: Captures logs from Rust backend, Python subprocess, database operations, and user actions

### Component Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     DataIngestionPage                       │
├─────────────────────────┬───────────────────────────────────┤
│     Main UI (60%)       │    TerminalLogger (40%)          │
│  ┌─────────────────┐    │  ┌────────────────────────────┐  │
│  │ Download Form   │    │  │ Header: ingestion.log     │  │
│  │ Available Data  │    │  ├────────────────────────────┤  │
│  │ Controls        │    │  │ Log Stream:               │  │
│  └─────────────────┘    │  │ [INFO] Starting...        │  │
│                         │  │ [PYTHON] Downloading...   │  │
│                         │  │ [DB] Query completed...   │  │
│                         │  └────────────────────────────┘  │
└─────────────────────────┴───────────────────────────────────┘
```

### Do's and Don'ts

**DO:**
- ✅ Always preserve existing functionality when adding logging
- ✅ Use appropriate log levels (info, warn, error, debug)
- ✅ Include timestamps and context in log messages
- ✅ Handle edge cases gracefully (broken pipes, process deaths)
- ✅ Test with long-running processes to ensure stability
- ✅ Use debouncing for rapid log updates to prevent UI freezing

**DON'T:**
- ❌ Remove or modify existing println! statements in Rust
- ❌ Block on log emission - use .ok() to ignore errors
- ❌ Store unlimited logs - enforce the 1000 line limit
- ❌ Parse structured data in log messages - keep it simple
- ❌ Emit sensitive information in logs (passwords, keys)

## Current Phase 3 Progress

### Completed in Phase 3:
1. **Added LogEvent Structure** ✅
   ```rust
   #[derive(Clone, Debug, Serialize)]
   struct LogEvent {
       timestamp: String,
       level: String,
       message: String,
   }
   ```

2. **Created emit_log Helper** ✅
   ```rust
   fn emit_log(window: &impl Emitter, level: &str, message: &str) {
       let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
       let event = LogEvent {
           timestamp,
           level: level.to_string(),
           message: message.to_string(),
       };
       println!("[{}] {}", level, message);
       window.emit("backend-log", &event).ok();
   }
   ```

3. **Updated start_data_ingestion** ✅
   - Added window parameter
   - Replaced first println! with emit_log
   - Maintained all existing functionality

### Still TODO in Phase 3:

1. **Update Remaining println! Statements**
   - Need to add window parameter to all commands that log
   - Update all println! to also emit_log
   - Map log levels: INFO, ERROR, WARN, DEBUG

2. **Frontend Listener Implementation**
   ```typescript
   // In DataIngestionPage useEffect:
   const unlistenBackendLog = listen<{ timestamp: string; level: string; message: string }>('backend-log', (event) => {
     const logType = mapBackendLevel(event.payload.level);
     addLog(logType, event.payload.message);
   });
   ```

3. **Commands Needing Updates**:
   - [x] start_data_ingestion - PARTIAL (only first emit_log added)
   - [ ] fetch_candles
   - [ ] fetch_candles_v2  
   - [ ] check_database_connection
   - [ ] cancel_ingestion
   - [ ] get_available_data
   - [ ] delete_data_range
   - [ ] refresh_candles
   - [ ] get_symbol_metadata

### Phase 4: Python Process Output Streaming
**Technical Requirements:**

1. **Capture Python stdout/stderr**
   - Already have `cmd.stdout(Stdio::piped()).stderr(Stdio::piped())`
   - Need to add stream reading in the monitor task

2. **Stream Processing**
   ```rust
   // In the monitoring task
   let stdout = child_process.stdout.take().unwrap();
   let reader = BufReader::new(stdout);
   
   for line in reader.lines() {
       if let Ok(line) = line {
           // Parse Python output (handle tqdm progress bars specially)
           emit_log(&app_handle, "PYTHON", &line);
       }
   }
   ```

3. **Progress Bar Parsing**
   - Detect tqdm format: `Downloading USDJPY: 27%|██▋ | 47/172 [12:34<33:26, 16.05s/it]`
   - Extract percentage for progress events
   - Handle carriage returns (`\r`) for updating same line

### Phase 5: Database & Performance Logging
**Technical Requirements:**

1. **Database Operation Timing**
   ```rust
   let start = Instant::now();
   let result = sqlx::query(&query).execute(&*pool).await;
   let elapsed = start.elapsed();
   emit_log(&window, "DB", &format!("Query completed in {}ms", elapsed.as_millis()));
   ```

2. **Performance Metrics**
   - Add system info collection (memory, CPU)
   - Track active DB connections
   - Calculate processing rates

3. **Candle Generation Details**
   - Already have progress events
   - Need to emit each stage as log

### Phase 6: Polish & Error Handling
**Technical Requirements:**

1. **Graceful Error Handling**
   - Handle broken pipe when process dies
   - Catch and log panics
   - Network timeout recovery

2. **Performance Optimization**
   - Debounce rapid log updates
   - Virtual scrolling for 1000+ logs
   - Efficient re-rendering

3. **Debug Toggle Persistence**
   - Store preference in localStorage
   - Apply on component mount

## Current State Summary

### Working ✅
- Full-width terminal logger UI
- All frontend messages redirected to terminal
- Log management with FIFO, auto-scroll, clear
- Debug toggle for filtering
- Dynamic currency pair loading
- Process running indicator
- User action logging

### Not Yet Implemented ❌
- Backend Rust log streaming
- Python process output capture
- Real-time progress updates
- Database operation logs
- Performance metrics
- Error recovery handling

## Next Steps

### Immediate (Phase 3 Completion):
1. Add window parameter to all Tauri commands
2. Update remaining println! statements to emit_log
3. Add frontend listener for 'backend-log' events
4. Test basic backend → frontend log flow

### Phase 4: Python Output Streaming
1. Modify process spawning to capture stdout/stderr
2. Add BufReader to stream output line-by-line
3. Parse tqdm progress bars for progress events
4. Handle Python tracebacks and errors

### Phase 5: Database & Performance
1. Time all database operations
2. Log candle generation stages
3. Add memory/CPU tracking
4. Show active connection counts

### Phase 6: Polish
1. Add debug toggle persistence
2. Implement log search/filter
3. Add export functionality
4. Performance optimize for 1000+ logs

## Testing Strategy

### Unit Testing:
- Test log FIFO behavior at exactly 1000 logs
- Test auto-scroll enable/disable logic
- Test log filtering with debug toggle

### Integration Testing:
- Run full download → verify all stages logged
- Cancel mid-download → verify graceful handling
- Generate candles → verify detailed progress
- Simulate errors → verify full context captured

### Performance Testing:
- Generate 100 logs/second for 60 seconds
- Verify UI remains responsive
- Check memory usage stays bounded
- Test with multiple concurrent processes