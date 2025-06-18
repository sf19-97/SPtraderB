# Terminal Logger Implementation - Detailed Execution Plan

## Overview
Add a professional terminal-style logger to the Data Ingestion page to display all backend activity in real-time without modifying any existing functionality.

## Phase 1: Frontend Layout & Basic Terminal Component
**Goal**: Create the visual structure without any backend integration

### Steps:
1. **Modify DataIngestionPage layout**
   - Remove `Container size="md"` → full width
   - Add flex container with 60/40 split
   - Move existing content to left panel

2. **Create TerminalLogger component**
   - Terminal header with icon and "ingestion.log" 
   - Black background scrollable area
   - Status bar with line counter
   - Mock data for testing appearance

### Test Plan #1:
- [ ] Page fills entire viewport
- [ ] Left panel (60%) contains all existing UI
- [ ] Right panel (40%) shows terminal with black background
- [ ] Terminal has header, body, and status bar
- [ ] Mock logs display with proper colors
- [ ] Scrolling works in terminal area

---

## Phase 2: Frontend Log Management & Features
**Goal**: Add log handling logic without backend connection

### Steps:
1. **Add log state management**
   ```typescript
   interface LogEntry {
     id: number;
     timestamp: string;
     type: 'info' | 'success' | 'warn' | 'error' | 'debug';
     prefix: string;
     message: string;
   }
   ```

2. **Implement log features**
   - Auto-scroll to bottom on new logs
   - Stop auto-scroll when user scrolls up
   - Clear logs button functionality
   - 1000 line limit with FIFO removal

3. **Add manual log triggers**
   - Log user actions (start download, stop, etc.)
   - Log state changes

### Test Plan #2:
- [ ] Click "Start Download" → logs the action
- [ ] Add 20+ logs → auto-scrolls to bottom
- [ ] Scroll up manually → auto-scroll stops
- [ ] Click clear → logs reset with "Console cleared" message
- [ ] Add 1000+ logs → oldest logs removed automatically

---

## Phase 3: Backend Log Capture Infrastructure
**Goal**: Capture existing logs without changing functionality

### Steps:
1. **Add log event to Tauri commands**
   ```rust
   #[derive(Clone, Serialize)]
   struct LogEvent {
       timestamp: String,
       level: String,
       message: String,
   }
   ```

2. **Create log emitter helper**
   ```rust
   fn emit_log(window: &Window, level: &str, message: &str) {
       // Emit to frontend
       // Also still println! for debugging
   }
   ```

3. **Update existing println! statements**
   - Add emit_log alongside each println!
   - Don't remove println! - just supplement

### Test Plan #3:
- [ ] Start download → see "[INFO] Starting ingestion..." in terminal
- [ ] Backend errors → appear as [ERROR] in red
- [ ] All existing console logs still work
- [ ] No functionality broken

---

## Phase 4: Python Process Output Streaming
**Goal**: Stream Python script output in real-time

### Steps:
1. **Modify process spawning to capture output**
   ```rust
   cmd.stdout(Stdio::piped())
      .stderr(Stdio::piped());
   ```

2. **Add output streaming in monitor task**
   - Read stdout/stderr line by line
   - Emit each line as log event
   - Parse progress bars specially

3. **Handle Python output formats**
   - Regular print statements
   - tqdm progress bars
   - Error tracebacks

### Test Plan #4:
- [ ] Start download → see Python "Starting download..." message
- [ ] Progress updates → "Downloading USDJPY: 27%|██▋ | 47/172"
- [ ] Python errors → full traceback in terminal
- [ ] Download completes → "Data ingestion complete!"

---

## Phase 5: Database & Performance Logging
**Goal**: Add detailed operational logging

### Steps:
1. **Add DB operation logging**
   - Log connection establishment
   - Log major queries with timing
   - Log row counts

2. **Add performance metrics**
   - Memory usage tracking
   - Processing rate calculations
   - Connection pool status

3. **Add candle generation detailed logs**
   - Each refresh stage
   - Progress percentages
   - Chunk processing

### Test Plan #5:
- [ ] Generate candles → see all stages logged
- [ ] See "Processing 5 minute candles... (20% complete)"
- [ ] Database operations show timing
- [ ] Memory usage updates periodically

---

## Phase 6: Polish & Error Handling
**Goal**: Handle edge cases and improve UX

### Steps:
1. **Add error recovery**
   - Handle disconnected processes
   - Graceful error messages
   - Network timeout handling

2. **Optimize performance**
   - Debounce rapid log updates
   - Efficient rendering for 1000 lines
   - Memory cleanup

3. **Add debug toggle**
   - Hide/show DEBUG level logs
   - Persist preference

### Test Plan #6:
- [ ] Kill process externally → error logged gracefully
- [ ] Spam logs rapidly → no UI freezing
- [ ] Toggle debug → DEBUG logs appear/disappear
- [ ] Long running process → memory stable

---

## Integration Testing Checklist:
- [ ] Download EURUSD data while watching logs
- [ ] Cancel mid-download → see cancellation logged
- [ ] Generate candles → watch full process
- [ ] Trigger an error → see full error details
- [ ] Let it run for 30+ minutes → verify stability
- [ ] Test with both EURUSD and USDJPY

## Success Criteria:
✅ No existing functionality broken  
✅ All backend activity visible in real-time  
✅ Professional terminal appearance  
✅ Helpful for debugging issues  
✅ Performance remains smooth

## Log Categories to Implement:

### Process Lifecycle
```
[INFO] Starting ingestion for USDJPY from 2024-07-12 to 2024-12-31
[INFO] Script path: /Users/sebastian/Projects/SPtraderB/data-ingestion/dukascopy_ingester.py
[INFO] Spawning process... (PID: 66990)
[SUCCESS] Process started successfully
[WARN] Process terminated by user
[ERROR] Process failed with exit code 1
[SUCCESS] Process completed successfully
```

### Python Script Output
```
[PYTHON] Starting download of USDJPY from 2024-07-12 to 2024-12-31
[PYTHON] Downloading USDJPY: 27%|██▋       | 47/172 [12:34<33:26, 16.05s/it]
[PYTHON] Processing USDJPY for 2024-07-12
[PYTHON] Upserted 165,057 ticks for 2024-07-12
[PYTHON] Data ingestion complete!
```

### Database Operations
```
[DB] Connecting to PostgreSQL...
[DB] Connection pool established (10 connections)
[DB] Executing bulk insert: 3,847 rows
[DB] Query completed in 234ms
[DB] Transaction committed
```

### Candle Generation
```
[CANDLES] Starting smart refresh for USDJPY
[CANDLES] Processing 5 minute candles in chunks...
[CANDLES] Chunk 1/24: 2023-01-01 to 2023-01-31
[SUCCESS] All candles generated successfully
```

### Performance Metrics
```
[PERF] Memory usage: 342 MB / 1024 MB
[PERF] Processing rate: 68,234 ticks/second
[PERF] Active DB connections: 8/10
```

### User Actions
```
[USER] Download started by user
[USER] Download cancelled
[USER] Candle generation triggered manually
[USER] Auto-generate candles enabled
```