# SPtraderB Orchestrator Documentation Index

## Overview
The SPtraderB Orchestrator is a unified trading system that handles both backtesting and live trading. It processes market data through indicators and signals, evaluates trading strategies, manages risk, and executes orders.

## Documentation Structure

### 📊 Core Documentation

1. **[Implementation Status](./ORCHESTRATOR_STATUS.md)**
   - Current development status
   - Completed features checklist
   - Technical notes from each implementation phase
   - Known limitations and future work

2. **[Complete Pipeline Guide](./ORCHESTRATOR_COMPLETE_PIPELINE.md)**
   - Comprehensive system overview
   - Detailed architecture explanation
   - Full API reference
   - Integration points
   - Testing procedures

3. **[Flow Diagrams](./ORCHESTRATOR_FLOW_DIAGRAMS.md)**
   - Visual system flows
   - Mermaid diagrams for all processes
   - State machines
   - Decision trees

4. **[Quick Reference](./ORCHESTRATOR_QUICK_REFERENCE.md)**
   - Common commands
   - Code snippets
   - Troubleshooting guide
   - Component templates

5. **[UI Implementation Plan](./ORCHESTRATOR_UI_PLAN.md)** 🆕
   - 14-week phased implementation roadmap
   - Component hierarchy and architecture
   - State management design
   - Technical specifications
   - Production deployment strategy

### 🔧 Implementation Phases

#### Phase 1-3: Foundation ✅
- Basic orchestrator structure
- Strategy YAML loading
- Component execution framework
- Data source configuration

#### Phase 4: Signal Processing ✅
- Signal event parsing
- Strategy rule evaluation
- Entry condition matching
- Order decision generation

#### Phase 5: Risk Management ✅
- Portfolio tracking
- Position sizing algorithms
- Risk limit enforcement
- Order creation with stops

#### Phase 6: Performance Tracking ✅
- Chronological processing
- Trade lifecycle management
- P&L calculation
- Sharpe ratio computation

#### Phase 7: Live Mode ✅
- Redis stream integration
- Real-time signal processing
- Portfolio state broadcasting
- Python signal publisher

#### Phase 8: Production UI 🔄
- Unified interface design
- Strategy management
- Performance dashboards
- Real-time monitoring
- **[→ See detailed UI plan](./ORCHESTRATOR_UI_PLAN.md)**

### 📁 Related Files

#### Rust Implementation
- `/src-tauri/src/orchestrator/mod.rs` - Main orchestrator code
- `/src-tauri/src/orders/mod.rs` - Order structures
- `/src-tauri/src/main.rs` - Tauri commands

#### Python Components
- `/workspace/core/indicators/` - Technical indicators
- `/workspace/core/signals/` - Trading signals
- `/workspace/core/data/loader.py` - Data loading utilities
- `/workspace/core/data/signal_publisher.py` - Live signal publishing

#### Strategy Configuration
- `/workspace/strategies/*.yaml` - Strategy definitions
- Example: `ma_crossover_strategy.yaml`

#### UI Components
- `/src/pages/OrchestratorTestPage.tsx` - Test interface
- Displays all orchestrator functionality
- Includes backtest and live mode testing

### 🚀 Getting Started

1. **Run a Backtest**
   ```bash
   # Navigate to test page
   http://localhost:1420/orchestrator-test
   
   # Load strategy and run backtest
   ```

2. **Start Live Trading**
   ```bash
   # Start Redis
   redis-server
   
   # Use UI to start live mode
   # Publish test signals with Python
   ```

3. **Create Components**
   - Use templates in Quick Reference
   - Follow metadata specifications
   - Test with provided datasets

### 📈 Key Concepts

- **Unified Architecture**: Same logic for backtest and live
- **Component Pipeline**: Indicators → Signals → Strategies → Orders
- **Risk First**: All trades pass through risk management
- **Performance Metrics**: Comprehensive tracking and analysis
- **Real-time Updates**: Live portfolio state via events

### 🔍 Where to Look

| Task | Documentation |
|------|--------------|
| Understanding the system | [Complete Pipeline](./ORCHESTRATOR_COMPLETE_PIPELINE.md) |
| Checking implementation status | [Status Document](./ORCHESTRATOR_STATUS.md) |
| Visual understanding | [Flow Diagrams](./ORCHESTRATOR_FLOW_DIAGRAMS.md) |
| Quick tasks | [Quick Reference](./ORCHESTRATOR_QUICK_REFERENCE.md) |
| Creating components | [Quick Reference - Component Development](./ORCHESTRATOR_QUICK_REFERENCE.md#component-development) |
| Troubleshooting | [Pipeline - Troubleshooting](./ORCHESTRATOR_COMPLETE_PIPELINE.md#troubleshooting) |
| Building the UI | [UI Implementation Plan](./ORCHESTRATOR_UI_PLAN.md) |

### 📝 Version History

- **January 2025**: Complete implementation of Phases 1-7
- **Architecture Decision**: Removed Orders IDE in favor of orchestrator
- **Key Achievement**: Unified backtest and live trading pipeline
- **Latest Addition**: Live mode with Redis signal streaming

---

For the main project documentation, see [/CLAUDE.md](/CLAUDE.md)