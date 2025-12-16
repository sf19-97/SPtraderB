# SPtraderB

## Structure (pointers)
```
SPtraderB/
├── frontend/              # React/TypeScript app (Vercel)
├── backend/               # Rust API (Fly)
│   └── api/workspace/     # Canonical workspace for core/strategies (mounted to /app/workspace in Fly)
├── docs/                  # Documentation
└── ...
```

## Workspace note
- All workspace content for Build Center/backtests lives under `backend/api/workspace/` and is mounted at `/app/workspace` in Fly. Root-level scaffolding was removed.

## Deploy reminders
- API uses Fly Postgres `sptraderb-api-db` (iad); migrations required: `backend/api/migrations/001_create_users.sql`, `002_app_repos.sql`.
- Market data uses the separate Timescale/Cloud DB in the market-data server (`ws-market-data-server.fly.dev`).
