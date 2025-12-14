# SPtraderB - AI-Powered Trading Platform

## Overview
SPtraderB is a modern algorithmic trading platform that combines AI-powered strategies with real-time market data visualization. Built with a React/TypeScript frontend and Rust backend, it provides comprehensive trading tools including backtesting, strategy development, and live trading capabilities.

**Version**: 0.1.0
**Last Updated**: 2025-12-11

## Recent Updates (2025-12-11)

### Authentication / OAuth
- PKCE state/verifier is now written to sessionStorage, localStorage, and a short-lived cookie to survive redirect quirks. The callback reads from all three so “Invalid OAuth state” is far less likely.
- OAuth redirect prefers `VITE_FRONTEND_URL` (the whitelisted prod domain); login is disabled on preview hosts to prevent state/whitelist mismatches. If host mismatch happens, the UI tells you to use the allowed origin.
- Auth store persists to sessionStorage (closes -> logged out). Session revalidation only logs out on explicit 401/403 from `/api/auth/me`; transient failures keep the session.

### Kumquant App-Managed GitHub Repos
- Backend now tracks app-managed repos in `app_repos` (migration `002_app_repos.sql`). Repos are Kumquant-prefixed and stored per user.
- New endpoints: `GET /api/github/app-repos` and `POST /api/github/app-repos/create` (creates a private repo via GitHub API, records it, defaults root to `build_center`).
- All GitHub file/tree/bootstrap routes enforce the app-repo allowlist and auto-apply stored branch/root to prefs to lock scope.
- Frontend Build page no longer lists all GitHub repos. It only shows app-managed repos and includes a “Create Kumquant repo” action. If the backend is not updated/migrated and returns 404, the UI shows a clear message (“Deploy latest API and run migration 002_app_repos”).

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
