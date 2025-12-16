# SPtraderB API

Rust backend API for SPtraderB trading platform.

## Development

### Prerequisites
- Rust 1.75+
- PostgreSQL 15+ (TimescaleDB extension optional for this API; core auth/app-repo features need plain Postgres)
- Redis

### Setup

1. Copy environment variables:
```bash
cp .env.example .env
```

2. Edit `.env` with your database and Redis credentials

3. Run development server:
```bash
cargo run
```

The API will start on `http://localhost:3001`

### Testing

```bash
# Check health endpoint
curl http://localhost:3001/health

# Expected response:
# {"status":"healthy","version":"0.1.0"}
```

## Deployment

### Fly.io Deployment (production)

> The API relies on a **dedicated Fly Postgres** for auth + Kumquant app-repos. Production uses `sptraderb-api-db` (region `iad`). This is separate from the Timescale/market-data DB. Auth/app-repo routes will fail without this DB or the required migrations.

1. Install Fly CLI:
```bash
curl -L https://fly.io/install.sh | sh
```

2. Login:
```bash
fly auth login
```

3. Create app:
```bash
fly launch
```

4. Set secrets (production already has `DATABASE_URL` pointing at `sptraderb-api-db` and `REDIS_URL`):
```bash
fly secrets set DATABASE_URL="postgres://..."
fly secrets set REDIS_URL="redis://..."
```

5. Deploy:
```bash
fly deploy
```

6. (If provisioning a new DB) Create/attach Postgres:
```bash
fly postgres create --name <new-db-name> --org <org> --region <region>
fly postgres attach <new-db-name> -a sptraderb-api
```

7. Run migrations (required for auth and Kumquant repos):
```bash
psql "$DATABASE_URL" -f migrations/001_create_users.sql
psql "$DATABASE_URL" -f migrations/002_app_repos.sql
```

### Production DB details (current)
- Name: `sptraderb-api-db`
- Region: `iad`
- Attached to app: `sptraderb-api` via `DATABASE_URL` secret
- Schema required: `users` (001_create_users.sql), `app_repos` (002_app_repos.sql)
- Distinction: This DB is for auth/app-repos only; market-data/candles remain on the separate Timescale/Timescale Cloud DB used by the market-data server.

### Database expectations
- Production: `sptraderb-api` uses Fly Postgres `sptraderb-api-db` (region `iad`). DB is **required** for auth and Kumquant app-repo endpoints.
- Local dev: set `DATABASE_URL` to a local Postgres and run the two migrations above before testing auth/app-repo flows. Backtest-only workflows can run without DB, but auth/repo routes will fail.

### Running migrations (examples)
- Using Fly connect + psql:
```bash
fly postgres connect -a sptraderb-api-db -u <user> -d <db>   # then \i migrations/001_create_users.sql, \i migrations/002_app_repos.sql
```
- Using psql directly with DATABASE_URL:
```bash
psql "$DATABASE_URL" -f migrations/001_create_users.sql
psql "$DATABASE_URL" -f migrations/002_app_repos.sql
```
- Using sqlx (if installed locally):
```bash
DATABASE_URL=postgres://... sqlx migrate run
```

### Getting `DATABASE_URL`
- **Production**: Pull it from your secret manager; `fly secrets list` will not show values. If you just need a psql session, use `fly postgres connect -a sptraderb-api-db` (no `DATABASE_URL` needed).
- **Local dev**: Point to your local Postgres (e.g., `postgres://user:pass@localhost:5432/sptraderb_api`) and run migrations.
- **Do not hardcode** secrets in git; update `DATABASE_URL` via `fly secrets set …` when rotating.

### Migration methods: when to use which
- `psql "$DATABASE_URL" -f migrations/001_create_users.sql` — use when you have the URL locally (e.g., from secrets manager or local Postgres).
- `fly postgres connect -a sptraderb-api-db -u <user> -d <db>` then `\i migrations/001_create_users.sql` — use when you’re attached to the Fly Postgres directly; does **not** require the API app to be running.
- Both methods are equivalent; choose based on whether you have the URL handy.

### Migration order, idempotency, and verification
- **Order**: Run `001_create_users.sql` first, then `002_app_repos.sql` (app_repos FK references users).
- **Idempotent**: Both SQL files use `IF NOT EXISTS`; re-running is safe.
- **Verify applied**:
  - Quick check: `SELECT to_regclass('public.users'), to_regclass('public.app_repos');`
  - Inspect tables: `fly postgres connect -a sptraderb-api-db -u <user> -d <db>` then `\dt` or `\d users` / `\d app_repos`.

### Troubleshooting DB issues
- Missing/incorrect `DATABASE_URL`: auth/app-repo routes return 401/500; logs show connection errors.
- Migrations not applied: app-repo routes can 404/500; Build Center fails to list/create Kumquant repos.
- To inspect secrets: `fly secrets list -a sptraderb-api`
- To inspect DB: `fly postgres list`, `fly postgres connect -a sptraderb-api-db`

## Operational Checklist (production)
1) `fly deploy` (app: `sptraderb-api`).
2) Ensure `DATABASE_URL` secret points to `sptraderb-api-db` (iad).
3) Run migrations (idempotent): `001_create_users.sql`, `002_app_repos.sql`.
4) Quick health: `curl https://sptraderb-api.fly.dev/health`.
5) Build Center sanity: log in, hit `/api/github/app-repos` (should 200, not 404), create a Kumquant repo and bootstrap files.

### GitHub Actions

- `.github/workflows/api.yml` deploys the API to Fly on pushes to `main` when `backend/api/**` changes (secret `DEPLOYTOFLYNONDATASERVERAPI`).
- `.github/workflows/api-check.yml` runs fmt/clippy/tests for `backend/api/**` on push/PR.

### Fly.io Postgres Setup (API)

```bash
# Create Postgres instance (production uses: sptraderb-api-db in iad)
fly postgres create --name sptraderb-api-db --region iad

# Attach to app
fly postgres attach sptraderb-api-db -a sptraderb-api

# Connect (if you need a psql shell)
fly postgres connect -a sptraderb-api-db
```

## API Endpoints

### Health Check
```
GET /health
```

### Backtesting
```
POST   /api/backtest/run
GET    /api/backtest/:id/status
GET    /api/backtest/:id/results
POST   /api/backtest/:id/cancel
WS     /ws/backtest/:id
```

### Market Data Pipelines
```
POST   /api/pipelines/start
GET    /api/pipelines/status
DELETE /api/pipelines/:symbol
POST   /api/pipelines/restore
WS     /ws/pipelines
```

### Workspace
```
GET    /api/workspace/list
POST   /api/workspace/save
GET    /api/workspace/:id
DELETE /api/workspace/:id

# Updated file ops & execution
GET    /api/workspace/tree
GET    /api/workspace/files/*path
PUT    /api/workspace/files/*path
POST   /api/workspace/files
DELETE /api/workspace/files/*path
POST   /api/workspace/rename
GET    /api/workspace/components
GET    /api/workspace/categories/:type
POST   /api/workspace/run-component
```
Workspace root resolution order:
1) `WORKSPACE_PATH` env var
2) `/app/workspace` (Fly production volume)
3) `./workspace` relative to current dir (local)
All workspace operations reject traversal (`..`) and paths outside the workspace.

### Candles
```
GET    /api/candles?symbol=EURUSD&timeframe=1h&from=...&to=...
```

### Strategies
```
GET    /api/strategies/list
GET    /api/strategies/:name
```

### Workspace (updated)
```
GET    /api/workspace/tree
GET    /api/workspace/files/*path
PUT    /api/workspace/files/*path
POST   /api/workspace/files
DELETE /api/workspace/files/*path
POST   /api/workspace/rename
GET    /api/workspace/components
GET    /api/workspace/categories/:type
POST   /api/workspace/run-component
```
Workspace root resolution order:
1) `WORKSPACE_PATH` env var
2) `/app/workspace` (Fly production volume)
3) `./workspace` relative to current dir (local)
All workspace operations reject traversal (`..`) and paths outside the workspace.

### Brokers
```
GET    /api/brokers/profiles
POST   /api/brokers/profiles
```

## Architecture

```
api/
├── src/
│   ├── main.rs              # Axum server setup
│   ├── orchestrator/        # Backtesting engine
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── market_data/         # Pipeline management
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── workspace/           # Workspace CRUD
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── candles/             # Candle data queries
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── brokers/             # Broker profiles
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── database/            # Database utilities
│   ├── execution/           # Order execution
│   └── orders/              # Order management
├── Cargo.toml
├── Dockerfile
└── fly.toml
```

## Next Steps

1. **Copy business logic from src-tauri**: The handlers are stubs that need implementation
2. **Add authentication**: Implement JWT or session-based auth
3. **Database migrations**: Set up sqlx migrations for schema versioning
4. **Rate limiting**: Add rate limiting middleware
5. **Monitoring**: Add metrics and tracing
6. **Tests**: Add integration and unit tests
