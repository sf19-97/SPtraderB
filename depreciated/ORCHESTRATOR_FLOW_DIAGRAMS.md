# Orchestrator Flow Diagrams

## Signal Processing Flow

```mermaid
graph TD
    A[Market Data] --> B[Indicators]
    B --> C[Signal Components]
    C --> D{Signal Events}
    D --> E[Strategy Rules]
    E --> F{Entry Conditions Met?}
    F -->|Yes| G[Order Decision]
    F -->|No| H[Continue Monitoring]
    G --> I[Risk Manager]
    I --> J{Risk Limits OK?}
    J -->|Yes| K[Position Sizing]
    J -->|No| L[Reject Order]
    K --> M[Create Order]
    M --> N[Execute Order]
    N --> O[Update Portfolio]
    O --> P[Emit Updates]
```

## Backtest Execution Flow

```mermaid
sequenceDiagram
    participant UI
    participant Orchestrator
    participant Components
    participant Portfolio
    participant RiskManager
    
    UI->>Orchestrator: run_backtest()
    Orchestrator->>Orchestrator: Load strategy YAML
    Orchestrator->>Orchestrator: Load candle data
    
    loop For each candle
        Orchestrator->>Portfolio: Check position exits
        Orchestrator->>Components: Run indicators
        Components-->>Orchestrator: Indicator values
        Orchestrator->>Components: Run signals
        Components-->>Orchestrator: Signal events
        Orchestrator->>Orchestrator: Evaluate entry rules
        
        alt Signal triggers entry
            Orchestrator->>RiskManager: Check risk limits
            RiskManager-->>Orchestrator: Approved/Rejected
            
            alt Approved
                Orchestrator->>Orchestrator: Calculate position size
                Orchestrator->>Portfolio: Execute order
                Portfolio-->>Orchestrator: Updated state
            end
        end
        
        Orchestrator->>Portfolio: Update valuation
        Orchestrator->>UI: Emit logs
    end
    
    Orchestrator->>Orchestrator: Calculate metrics
    Orchestrator-->>UI: Return results
```

## Live Trading Flow

```mermaid
sequenceDiagram
    participant Signal Publisher
    participant Redis
    participant Orchestrator
    participant Portfolio
    participant UI
    participant Execution Engine
    
    Signal Publisher->>Redis: Publish signal
    
    loop Event Loop
        Orchestrator->>Redis: Poll for signals
        Redis-->>Orchestrator: Signal events
        
        alt Signal received
            Orchestrator->>Portfolio: Check exits
            Orchestrator->>Orchestrator: Evaluate entry
            
            alt Generate order
                Orchestrator->>Orchestrator: Risk checks
                Orchestrator->>Orchestrator: Size position
                Orchestrator->>Execution Engine: Send order
                Note right of Execution Engine: Currently simulated
                Orchestrator->>Portfolio: Update state
            end
        end
        
        Orchestrator->>UI: portfolio_update event
        UI->>UI: Update display
        
        alt Risk limit breach
            Orchestrator->>Orchestrator: Stop trading
            Orchestrator->>UI: Emit stop event
        end
    end
```

## Component Execution Flow

```mermaid
graph LR
    A[Environment Variables] --> B[Python Component]
    B --> C{Component Type}
    C -->|Indicator| D[Calculate Values]
    C -->|Signal| E[Detect Patterns]
    D --> F[Print Results]
    E --> G[Print Signal Events]
    G --> H{Live Mode?}
    H -->|Yes| I[Publish to Redis]
    H -->|No| J[End]
    F --> J
    I --> J
```

## Risk Management Decision Tree

```mermaid
graph TD
    A[Order Decision] --> B{Max Positions Check}
    B -->|Exceeded| C[Reject: Too Many Positions]
    B -->|OK| D{Drawdown Check}
    D -->|Exceeded| E[Reject: Max Drawdown]
    D -->|OK| F{Daily Loss Check}
    F -->|Exceeded| G[Reject: Daily Loss Limit]
    F -->|OK| H{Position Size Check}
    H -->|Too Large| I[Reduce Size]
    H -->|OK| J[Approve Order]
    I --> K[Apply Max Position Size]
    K --> J
```

## Data Source Selection

```mermaid
graph TD
    A[Data Source] --> B{Source Type}
    B -->|Live| C[PostgreSQL Query]
    B -->|Parquet| D[Load File]
    B -->|Realtime| E[Generate Window]
    C --> F[Set Env Vars]
    D --> F
    E --> F
    F --> G[Run Component]
    G --> H[Process Output]
```

## Portfolio State Machine

```mermaid
stateDiagram-v2
    [*] --> Initialized
    Initialized --> Trading: Start Trading
    Trading --> PositionOpen: Open Position
    PositionOpen --> Trading: Close Position
    PositionOpen --> RiskLimitHit: Risk Breach
    Trading --> RiskLimitHit: Risk Breach
    RiskLimitHit --> Stopped: Stop Trading
    Trading --> Stopped: Manual Stop
    Stopped --> [*]
```

## Order Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: Generate Order
    Created --> Validated: Risk Checks Pass
    Created --> Rejected: Risk Checks Fail
    Validated --> Submitted: Send to Broker
    Submitted --> Filled: Execution Complete
    Submitted --> PartiallyFilled: Partial Execution
    Submitted --> Cancelled: Cancel Request
    PartiallyFilled --> Filled: Complete Fill
    PartiallyFilled --> Cancelled: Cancel Remainder
    Filled --> [*]
    Rejected --> [*]
    Cancelled --> [*]
```

## Performance Tracking Flow

```mermaid
graph TD
    A[Trade Execution] --> B[Update Portfolio]
    B --> C[Calculate P&L]
    C --> D[Track Daily Return]
    D --> E[Update High Water Mark]
    E --> F{New High?}
    F -->|Yes| G[Reset Drawdown]
    F -->|No| H[Calculate Drawdown]
    G --> I[Store Metrics]
    H --> I
    I --> J[End of Backtest?]
    J -->|No| K[Continue]
    J -->|Yes| L[Calculate Sharpe]
    L --> M[Generate Report]
```

## Strategy Configuration Hierarchy

```mermaid
graph TD
    A[Strategy YAML] --> B[Dependencies]
    A --> C[Parameters]
    A --> D[Entry Rules]
    A --> E[Exit Rules]
    A --> F[Risk Limits]
    B --> G[Indicators List]
    B --> H[Signals List]
    C --> I[Position Size]
    C --> J[MA Periods]
    D --> K[Signal Conditions]
    D --> L[Action Types]
    E --> M[Stop Loss]
    E --> N[Take Profit]
    E --> O[Signal Exits]
    F --> P[Max Drawdown]
    F --> Q[Daily Loss]
    F --> R[Position Limits]
```

## Redis Stream Architecture

```mermaid
graph LR
    A[Python Components] --> B[Redis Publisher]
    B --> C[Redis Streams]
    C --> D[signals:live]
    C --> E[prices:live]
    D --> F[Consumer Group]
    F --> G[Orchestrator]
    E --> G
    G --> H[Portfolio Updates]
    H --> I[Tauri Events]
    I --> J[UI Updates]
```

## Error Handling Flow

```mermaid
graph TD
    A[Component Execution] --> B{Success?}
    B -->|Yes| C[Parse Output]
    B -->|No| D[Log Error]
    C --> E{Valid Format?}
    E -->|Yes| F[Process Data]
    E -->|No| G[Log Warning]
    D --> H[Continue]
    G --> H
    F --> I{Risk Check}
    I -->|Pass| J[Execute]
    I -->|Fail| K[Log Risk Event]
    K --> H
    J --> L[Update State]
    L --> H
```

These diagrams provide a visual representation of the orchestrator's various flows and decision points, making it easier to understand the system's behavior and integration points.