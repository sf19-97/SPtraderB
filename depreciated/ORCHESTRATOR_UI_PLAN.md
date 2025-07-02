# SPtraderB Orchestrator UI Implementation Plan

## Overview
This document outlines the phased implementation plan for the SPtraderB Orchestrator UI, which will provide a unified interface for backtesting, paper trading, and live trading operations.

## UI Architecture Principles
- **Single Page Application**: Orchestrator as a dedicated route in the existing React app
- **State Management**: Use existing BuildContext pattern, extended for orchestrator needs
- **Component Library**: Continue using Mantine UI for consistency
- **Real-time Updates**: WebSocket/Tauri events for live data
- **Progressive Enhancement**: Start with core features, add advanced features iteratively

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
**Goal**: Establish foundation and basic functionality

#### 1.1 Route Setup
- [ ] Create `/orchestrator` route in App.tsx
- [ ] Create OrchestratorPage.tsx main component
- [ ] Setup OrchestratorContext for state management
- [ ] Add navigation from main app

#### 1.2 Layout Structure
- [ ] Header with mode selector and connection status
- [ ] Sidebar for strategy selection
- [ ] Main content area with tabs
- [ ] Status bar for system messages

#### 1.3 Strategy Management
- [ ] Strategy list component with YAML loading
- [ ] Strategy detail viewer
- [ ] Basic strategy selector
- [ ] Strategy validation display

**Deliverables**: Basic page with strategy browsing

### Phase 2: Backtest Interface (Week 3-4)
**Goal**: Complete backtesting functionality

#### 2.1 Backtest Configuration
- [ ] Date range picker component
- [ ] Data source selector (DB/Parquet)
- [ ] Symbol and timeframe selectors
- [ ] Initial capital input

#### 2.2 Backtest Execution
- [ ] Run backtest button with progress indicator
- [ ] Real-time log streaming
- [ ] Cancel functionality
- [ ] Results storage

#### 2.3 Results Display
- [ ] Portfolio summary card
- [ ] Equity curve chart
- [ ] Trade history table
- [ ] Basic metrics (Sharpe, drawdown)

**Deliverables**: Fully functional backtesting

### Phase 3: Performance Analytics (Week 5-6)
**Goal**: Rich performance visualization and analysis

#### 3.1 Advanced Metrics
- [ ] Comprehensive metrics dashboard
- [ ] Monthly returns heatmap
- [ ] Trade distribution charts
- [ ] Risk-adjusted returns

#### 3.2 Trade Analysis
- [ ] Individual trade details
- [ ] Entry/exit visualization on charts
- [ ] Signal attribution
- [ ] Slippage analysis

#### 3.3 Comparison Tools
- [ ] Multiple backtest comparison
- [ ] Strategy A/B testing
- [ ] Parameter optimization results
- [ ] Export functionality

**Deliverables**: Professional-grade analytics

### Phase 4: Live Trading Core (Week 7-8)
**Goal**: Basic live trading functionality

#### 4.1 Mode Switching
- [ ] Backtest/Paper/Live mode selector
- [ ] Safety confirmations and warnings
- [ ] Mode-specific UI adaptations
- [ ] Emergency stop button

#### 4.2 Live Portfolio Display
- [ ] Real-time portfolio updates via Tauri events
- [ ] Position management table
- [ ] Open P&L tracking
- [ ] Cash balance sync

#### 4.3 Redis Integration
- [ ] Redis connection status
- [ ] Signal feed display
- [ ] Signal filtering controls
- [ ] Manual signal publishing (dev mode)

**Deliverables**: Basic live trading capability

### Phase 5: Risk Management (Week 9-10)
**Goal**: Comprehensive risk controls and monitoring

#### 5.1 Risk Configuration
- [ ] Risk limits setting panel
- [ ] Per-strategy risk allocation
- [ ] Position sizing calculator
- [ ] Drawdown controls

#### 5.2 Risk Monitoring
- [ ] Real-time exposure tracking
- [ ] Risk limit usage bars
- [ ] Correlation matrix
- [ ] Risk alerts system

#### 5.3 Manual Overrides
- [ ] Position adjustment controls
- [ ] Order cancellation
- [ ] Force close positions
- [ ] Risk limit overrides (with auth)

**Deliverables**: Production-ready risk management

### Phase 6: Order Management (Week 11-12)
**Goal**: Full order lifecycle management

#### 6.1 Order Display
- [ ] Pending orders queue
- [ ] Order history table
- [ ] Order status tracking
- [ ] Fill information display

#### 6.2 Order Controls
- [ ] Modify pending orders
- [ ] Cancel orders
- [ ] Order routing selection
- [ ] Execution algo selection

#### 6.3 Broker Integration
- [ ] Broker connection management
- [ ] Account selection
- [ ] Balance synchronization
- [ ] API health monitoring

**Deliverables**: Complete order management

### Phase 7: Production Features (Week 13-14)
**Goal**: Production deployment readiness

#### 7.1 System Monitoring
- [ ] Component health dashboard
- [ ] Performance metrics (latency, CPU)
- [ ] Error tracking and alerts
- [ ] Audit logging

#### 7.2 Advanced Features
- [ ] Strategy scheduling
- [ ] Automated reporting
- [ ] Multi-account support
- [ ] Strategy versioning

#### 7.3 User Experience
- [ ] Customizable layouts
- [ ] Keyboard shortcuts
- [ ] Help system integration
- [ ] Onboarding flow

**Deliverables**: Production-ready system

## Component Hierarchy

```
OrchestratorPage
├── OrchestratorHeader
│   ├── ModeSelector
│   ├── ConnectionStatus
│   └── EmergencyControls
├── OrchestratorSidebar
│   ├── StrategyList
│   ├── StrategyFilter
│   └── StrategyActions
├── OrchestratorContent
│   ├── BacktestTab
│   │   ├── BacktestConfig
│   │   ├── BacktestResults
│   │   └── BacktestChart
│   ├── LiveTradingTab
│   │   ├── PortfolioDisplay
│   │   ├── PositionsTable
│   │   └── SignalMonitor
│   ├── PerformanceTab
│   │   ├── MetricsDashboard
│   │   ├── TradeHistory
│   │   └── AnalyticsCharts
│   ├── RiskTab
│   │   ├── RiskConfig
│   │   ├── ExposureMonitor
│   │   └── RiskAlerts
│   └── OrdersTab
│       ├── OrderQueue
│       ├── OrderHistory
│       └── OrderControls
└── OrchestratorStatusBar
    ├── SystemLogs
    └── NotificationCenter
```

## State Management Architecture

### OrchestratorContext
```typescript
interface OrchestratorState {
  // Mode
  mode: 'backtest' | 'paper' | 'live';
  
  // Strategy
  selectedStrategy: Strategy | null;
  availableStrategies: Strategy[];
  
  // Backtest
  backtestConfig: BacktestConfig;
  backtestResults: BacktestResults | null;
  backtestProgress: number;
  
  // Live Trading
  portfolio: Portfolio;
  positions: Position[];
  signals: SignalEvent[];
  orders: Order[];
  
  // Risk
  riskLimits: RiskLimits;
  riskMetrics: RiskMetrics;
  
  // System
  connectionStatus: ConnectionStatus;
  logs: LogEntry[];
  alerts: Alert[];
}
```

## Technical Implementation Notes

### 1. Tauri Commands Needed
```rust
// Strategy Management
#[tauri::command]
async fn list_strategies() -> Result<Vec<Strategy>>;
async fn load_strategy(path: String) -> Result<Strategy>;
async fn save_strategy(strategy: Strategy) -> Result<()>;

// Backtest
#[tauri::command] 
async fn run_backtest(config: BacktestConfig) -> Result<BacktestHandle>;
async fn get_backtest_progress(handle: String) -> Result<f32>;
async fn cancel_backtest(handle: String) -> Result<()>;

// Live Trading
#[tauri::command]
async fn start_live_trading(strategy: String) -> Result<()>;
async fn stop_live_trading() -> Result<()>;
async fn get_portfolio_state() -> Result<Portfolio>;

// Risk Management
#[tauri::command]
async fn update_risk_limits(limits: RiskLimits) -> Result<()>;
async fn force_close_position(id: String) -> Result<()>;
```

### 2. Event System
```typescript
// Listen for real-time updates
listen('portfolio_update', (event) => {
  updatePortfolio(event.payload);
});

listen('signal_received', (event) => {
  addSignal(event.payload);
});

listen('order_update', (event) => {
  updateOrder(event.payload);
});
```

### 3. Component Integration Points
- **With BuildContext**: Share selected symbols, timeframes
- **With ChartStore**: Display trades on charts
- **With MonacoIDE**: Edit strategies directly
- **With DataIngestion**: Trigger data updates

## Testing Strategy

### Unit Tests
- Component rendering tests
- State management logic
- Utility functions
- Event handlers

### Integration Tests
- Tauri command communication
- Event system reliability
- State synchronization
- Error handling

### E2E Tests
- Full backtest workflow
- Live trading simulation
- Risk limit enforcement
- Emergency procedures

## Performance Considerations

### Optimization Points
- Virtual scrolling for large tables
- Chart data decimation for long backtests
- Debounced state updates
- Lazy loading of historical data
- Web Workers for heavy calculations

### Memory Management
- Limit in-memory trade history
- Pagination for large result sets
- Clear old backtest results
- Stream logs vs storing all

## Security Considerations

### Access Control
- Mode switching requires confirmation
- Live trading requires additional auth
- Risk overrides need special permissions
- Audit all manual interventions

### Data Protection
- Encrypt broker credentials
- Secure WebSocket connections
- Validate all user inputs
- Sanitize strategy code execution

## Migration Path

### From Test Page
1. Move working components from OrchestratorTestPage
2. Refactor into production components
3. Add proper error handling
4. Implement missing features

### Incremental Rollout
1. Start with read-only backtest viewer
2. Add backtest execution
3. Enable paper trading
4. Finally enable live trading

## Success Metrics

### Phase 1-3 (Backtest)
- Run backtest from UI successfully
- View all results without console
- Export results to CSV

### Phase 4-5 (Live Core)
- Connect to Redis and receive signals
- Display real-time portfolio updates
- Execute risk checks properly

### Phase 6-7 (Production)
- Handle disconnections gracefully
- Maintain state across refreshes
- Support multiple concurrent users

## Dependencies

### External Libraries
- Mantine UI components
- Recharts/Lightweight Charts
- React Query for data fetching
- Zod for validation

### Internal Systems
- Orchestrator Rust module
- Redis for live signals
- PostgreSQL for data
- Tauri event system

## Timeline Summary

**Total Duration**: 14 weeks

- **Weeks 1-2**: Core Infrastructure
- **Weeks 3-4**: Backtest Interface  
- **Weeks 5-6**: Performance Analytics
- **Weeks 7-8**: Live Trading Core
- **Weeks 9-10**: Risk Management
- **Weeks 11-12**: Order Management
- **Weeks 13-14**: Production Features

## Next Steps

1. Review and approve this plan
2. Set up UI development environment
3. Create component templates
4. Begin Phase 1 implementation
5. Establish testing procedures

---

This plan provides a structured approach to building a professional-grade trading interface while maintaining flexibility for adjustments based on user feedback and technical discoveries.