# SPtraderB - AI-Powered Trading Platform

## Overview
SPtraderB is a modern algorithmic trading platform that combines AI-powered strategies with real-time market data visualization. Built with a React/TypeScript frontend and Rust backend, it provides comprehensive trading tools including backtesting, strategy development, and live trading capabilities.

**Version**: 0.1.0
**Last Updated**: 2025-11-30

## Recent Updates (2025-11-30)

### Major Directory Restructuring
- **Frontend**: Moved all React/Vite code to `frontend/` directory
- **Backend**: Relocated Rust API from `api/` to `backend/`
- **Benefits**: Cleaner separation of concerns, easier deployment configuration

### Chart Library Enhancements
- Updated sptrader-chart-lib from 2.0.15 to 2.0.20
- Added `preloadAdjacentTimeframes` for smoother timeframe switching
- Fixed localStorage key conflicts (now using 'sptraderb-trading-storage')
- Removed duplicate MarketChartPage, consolidated into TradingPage

### Performance Improvements
- Synchronous chart library initialization at module level
- Background app loading during Matrix login screen
- Optimized component preloading strategy

## Architecture

### Project Structure
```
SPtraderB/
├── frontend/                 # React/TypeScript web application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/          # Route pages
│   │   ├── stores/         # Zustand state management
│   │   ├── lib/            # Utility libraries
│   │   └── api/            # API client code
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
│
├── backend/                  # Rust API server
│   ├── src/
│   │   ├── orchestrator/   # Backtesting engine
│   │   ├── workspace/      # Project management
│   │   ├── database/       # PostgreSQL integration
│   │   └── orders/         # Order management
│   ├── workspace/           # Python strategy components
│   ├── Cargo.toml
│   └── fly.toml            # Fly.io deployment config
│
└── Configuration Files
    ├── vercel.json          # Frontend deployment (rootDirectory: frontend)
    ├── .gitignore
    └── .vercelignore
```

### System Components

#### Frontend (Vercel)
- **Framework**: React 18 + TypeScript + Vite
- **State Management**: Zustand with localStorage persistence
- **UI Library**: Mantine v8
- **Charts**: sptrader-chart-lib v2.0.20 with TradingView's lightweight-charts
- **Deployment**: Vercel with automatic GitHub integration

#### Backend API (Fly.io)
- **Framework**: Axum (Rust)
- **Database**: PostgreSQL with TimescaleDB
- **Features**: Backtesting, workspace management, strategy execution
- **Deployment**: fly.io at sptraderb-api.fly.dev

#### Market Data Server (Separate)
- **URL**: ws-market-data-server.fly.dev
- **Protocol**: WebSocket
- **Features**: Real-time market data, broker connections
- **Initialization**: Must be configured at app startup

## Setup & Installation

### Frontend Development

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment Variables
Create `frontend/.env.local`:
```env
VITE_MARKET_DATA_API_URL=https://ws-market-data-server.fly.dev
VITE_API_URL=https://sptraderb-api.fly.dev
```

### Backend Development

```bash
# Navigate to backend directory
cd backend

# Run development server
cargo run

# Run tests
cargo test
```

## Development Workflow

### Running the Application
1. **Frontend**: `cd frontend && npm run dev` (runs on port 1420)
2. **Backend**: `cd backend && cargo run` (runs on port 3000)

### Key npm Scripts (in frontend/)
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Run ESLint
- `npm run deploy` - Update chart lib and deploy

### Git Workflow
The project uses a single main branch with automatic Vercel deployments on push.

### Deployment
- **Frontend**: Automatic via Vercel on git push
- **Backend**: Manual via `fly deploy` from backend directory

## Key Features

### Trading Interface (`/trading`)
- Real-time market data visualization
- Integrated with sptrader-chart-lib
- Adjacent timeframe preloading for smooth transitions
- Custom pair selector with catalog fetching

### Build/Strategy Development (`/build`)
- Monaco editor integration
- Python strategy development
- YAML strategy configuration

### Orchestrator (`/orchestrator`)
- Backtesting engine
- Strategy execution simulation
- Performance metrics calculation

### Market Data (`/market-data`)
- Historical data visualization
- Data source management

## API Documentation

### Backend API Endpoints

#### Health & Status
- `GET /health` - Health check

#### Backtesting
- `POST /api/backtest/run` - Start backtest
- `GET /api/backtest/:id/status` - Get backtest status
- `GET /api/backtest/:id/results` - Get backtest results
- `POST /api/backtest/:id/cancel` - Cancel backtest
- `WS /ws/backtest/:id` - Real-time backtest updates

#### Workspace
- `GET /api/workspace` - List workspaces
- `POST /api/workspace` - Create workspace
- `GET /api/workspace/:id` - Get workspace
- `DELETE /api/workspace/:id` - Delete workspace

#### Strategies
- `GET /api/strategies` - List strategies
- `GET /api/strategies/:name` - Get strategy
- `POST /api/strategies/:name` - Save strategy

## Important Notes

### Chart Library Integration
The sptrader-chart-lib must be initialized synchronously at module load:
```typescript
// In App.tsx - BEFORE component definitions
getHTTPDataProvider({
  baseUrl: apiUrl,
  timeout: 60000  // 60s for cold starts
});
chartDataCoordinator.enableHTTP(true);
```

### localStorage Keys
- App trading state: `sptraderb-trading-storage`
- Chart library uses its own separate key
- Avoid conflicts by using unique prefixes

### Matrix Login Optimization
The app now loads in the background while the Matrix login animation plays, significantly improving perceived performance.

### Vercel Configuration
The `vercel.json` now includes `rootDirectory: "frontend"` to handle the new structure.

## Troubleshooting

### Common Issues

1. **Chart library not initialized**: Ensure synchronous initialization at module level
2. **localStorage conflicts**: Check for unique storage keys
3. **Vercel deployment fails**: Verify `rootDirectory` in vercel.json
4. **Dev server issues**: Run from `frontend/` directory

### Cache Miss Messages
Normal behavior when data isn't in the multi-layer cache (Backend → Frontend Store → Library). The system will fetch and cache automatically.

## Project Status

### Completed
- ✅ Directory restructuring for better organization
- ✅ Chart library integration with preloading
- ✅ Matrix login with background loading
- ✅ localStorage conflict resolution

### In Progress
- 🔄 Backtesting engine enhancements
- 🔄 Strategy development tools

### Planned
- 📋 Live trading integration
- 📋 Advanced analytics dashboard
- 📋 Multi-broker support