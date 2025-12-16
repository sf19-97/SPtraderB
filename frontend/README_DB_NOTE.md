# Frontend API Targeting & Backend DB Requirements

This frontend must talk to the production API at `https://sptraderb-api.fly.dev` (or your local API). Set:

```env
VITE_API_URL=https://sptraderb-api.fly.dev
VITE_MARKET_DATA_API_URL=https://ws-market-data-server.fly.dev
```

Backend expectation: the API requires a real Postgres with migrations `001_create_users.sql` and `002_app_repos.sql` applied. In production we use Fly Postgres `sptraderb-api-db` (region `iad`); `DATABASE_URL` on the API app points there. If the API is deployed without that DB/migrations, auth and Kumquant app-repo routes will 404/401/500.
