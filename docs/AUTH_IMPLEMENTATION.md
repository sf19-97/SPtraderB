# GitHub OAuth Authentication Implementation

**Date**: 2025-12-08
**Status**: MVP Complete - Security hardening pending

## Overview

SPtraderB now supports user authentication via GitHub OAuth 2.0. Users can log in with their GitHub account, and their profile data is persisted in the database.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend    │────▶│   GitHub    │
│   (Vercel)  │◀────│   (Fly.io)   │◀────│   OAuth     │
└─────────────┘     └──────────────┘     └─────────────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       └───────────▶│ TimescaleDB │
         (JWT)      │  (Users)    │
                    └─────────────┘
```

## Security Features

- **PKCE (Proof Key for Code Exchange)**: S256 code challenge prevents authorization code interception
- **State Parameter**: Random UUID prevents CSRF attacks
- **JWT Tokens**: Stateless session management with 7-day expiry
- **Token Filtering**: GitHub access tokens never sent to frontend (`#[serde(skip_serializing)]`)

## Known Security Limitations

> **These should be addressed before production use with sensitive data.**

### 1. GitHub Token Storage (High Priority)
GitHub access tokens are stored in **plaintext** in the database. For production:
- Consider encrypting at rest with KMS (AWS KMS, GCP KMS, or Fly.io secrets)
- Or use short-lived tokens and refresh on demand

### 2. Client-Side Token Storage (Medium Priority)
JWT and user profile are stored in **localStorage**, which is vulnerable to XSS attacks.
- Consider HttpOnly cookies for JWT storage
- Or implement token revalidation on page load
- Current mitigation: React's built-in XSS protection

### 3. CORS Configuration (Medium Priority)
Backend currently allows **Any origin** (`tower_http::cors::Any`).
- Should be restricted to `https://sptraderb.vercel.app` in production
- File: `backend/api/src/main.rs`

### 4. Session Handling (Low Priority)
- JWT has 7-day expiry with **no refresh mechanism**
- No automatic logout on token expiry
- No session revalidation on app load
- Users must manually re-login after 7 days

### 5. OAuth Scopes (Informational)
Using `repo` scope grants **write access** to repositories. This is intentional for future features:
- Reading strategy files from user repos
- Saving backtest results to repos

Consider using a GitHub App with fine-grained permissions for production.

## Files Created

### Backend (Rust/Axum)

| File | Purpose |
|------|---------|
| `backend/api/src/auth/mod.rs` | User types, UserProfile, AuthConfig |
| `backend/api/src/auth/jwt.rs` | JWT creation and verification |
| `backend/api/src/auth/github.rs` | GitHub OAuth API calls |
| `backend/api/src/auth/handlers.rs` | HTTP route handlers |
| `backend/api/src/auth/middleware.rs` | JWT auth extractor for protected routes |
| `backend/api/migrations/001_create_users.sql` | Users table schema |

### Frontend (React/TypeScript)

| File | Purpose |
|------|---------|
| `frontend/src/stores/useAuthStore.ts` | Auth state, PKCE generation, API calls |
| `frontend/src/pages/LoginPage.tsx` | Login UI with GitHub button |
| `frontend/src/pages/AuthCallbackPage.tsx` | OAuth callback handler |
| `frontend/src/components/ProtectedRoute.tsx` | Route guard component |
| `frontend/src/components/UserMenu.tsx` | User dropdown menu (full/compact variants) |

## Files Modified

| File | Changes |
|------|---------|
| `backend/api/Cargo.toml` | Added `jsonwebtoken`, `argon2` dependencies |
| `backend/api/src/main.rs` | Added auth module and routes |
| `frontend/src/App.tsx` | Replaced Matrix login with real auth flow |
| `frontend/src/layouts/AppLayout.tsx` | Added UserMenu to sidebar and header |
| `.env.example` | Added auth environment variables |
| `backend/api/.env.example` | Added backend auth variables |

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/github` | Redirect to GitHub OAuth |
| POST | `/api/auth/callback` | Exchange code for JWT |

### Protected Endpoints (require JWT)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Get current user profile |
| PUT | `/api/auth/preferences` | Update user preferences |
| PUT | `/api/auth/memory` | Update user memory |
| GET | `/api/auth/repos` | List user's GitHub repos |

## Database Schema

Full migration from `backend/api/migrations/001_create_users.sql`:

```sql
-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- GitHub OAuth fields
    github_id BIGINT UNIQUE NOT NULL,
    github_username VARCHAR(255) NOT NULL,
    github_email VARCHAR(255),
    github_avatar_url TEXT,
    github_access_token TEXT NOT NULL,  -- ⚠️ Plaintext - encrypt for production

    -- Profile fields
    display_name VARCHAR(255),

    -- User preferences and memory (JSONB for flexibility)
    preferences JSONB DEFAULT '{}',
    memory JSONB DEFAULT '{}',

    -- Connected repos (list of repos user has granted access to)
    connected_repos JSONB DEFAULT '[]',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster GitHub lookups
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_github_username ON users(github_username);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

## Environment Variables

### Frontend (Vercel)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_GITHUB_CLIENT_ID` | **Yes** | - | GitHub OAuth App client ID |
| `VITE_FRONTEND_URL` | **Yes** | - | Must match OAuth callback URL exactly |
| `VITE_API_URL` | No | `https://sptraderb-api.fly.dev` | Backend API URL |

> **Important**: `VITE_FRONTEND_URL` must be set to `https://sptraderb.vercel.app` (not a preview URL) to match the GitHub OAuth App callback configuration. Preview deployments will fail OAuth.

### Backend (Fly.io)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_CLIENT_ID` | **Yes** | - | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | **Yes** | - | GitHub OAuth App client secret |
| `JWT_SECRET` | **Yes** | - | Secret for signing JWTs (min 32 chars) |
| `FRONTEND_URL` | No | `https://sptraderb.vercel.app` | Frontend URL for CORS |
| `DATABASE_URL` | **Yes** | - | PostgreSQL connection string |

## OAuth Flow

```
1. User clicks "Sign in with GitHub" on /login
                    │
                    ▼
2. Frontend generates:
   - state (random UUID)
   - code_verifier (32 random bytes, base64url)
   - code_challenge (SHA256 of verifier, base64url)
                    │
                    ▼
3. Frontend stores state + code_verifier in sessionStorage
                    │
                    ▼
4. Redirect to GitHub with code_challenge (S256 method)
                    │
                    ▼
5. User authorizes "Kumquant" app on GitHub
                    │
                    ▼
6. GitHub redirects to /auth/callback with code + state
                    │
                    ▼
7. Frontend validates state matches sessionStorage
                    │
                    ▼
8. Frontend POSTs {code, code_verifier, state} to backend
                    │
                    ▼
9. Backend exchanges code + code_verifier for GitHub token
                    │
                    ▼
10. Backend fetches user profile from GitHub API
                    │
                    ▼
11. Backend upserts user in database (stores GitHub token)
                    │
                    ▼
12. Backend generates JWT (7-day expiry) with user_id
                    │
                    ▼
13. Backend returns {token, user} to frontend
                    │
                    ▼
14. Frontend stores in localStorage ('sptraderb-auth-storage')
                    │
                    ▼
15. Redirect to /trading
```

## GitHub OAuth App Configuration

- **App Name**: Kumquant
- **Homepage URL**: https://sptraderb.vercel.app
- **Authorization callback URL**: https://sptraderb.vercel.app/auth/callback
- **Scopes requested**: `user:email`, `repo` (write access)

## Testing

1. Navigate to https://sptraderb.vercel.app/login
2. Click "Sign in with GitHub"
3. Authorize the Kumquant app
4. Should redirect to `/trading` with user menu visible
5. Click user avatar to see dropdown menu
6. Test logout functionality
7. Verify localStorage has `sptraderb-auth-storage` key

## Security Hardening Checklist

- [ ] Encrypt GitHub tokens at rest (KMS or application-level)
- [ ] Restrict CORS to production frontend URL only
- [ ] Move JWT to HttpOnly cookie (prevents XSS token theft)
- [ ] Add token refresh mechanism
- [ ] Add session revalidation on app load
- [ ] Consider GitHub App instead of OAuth App for fine-grained permissions
- [ ] Add rate limiting to auth endpoints
- [ ] Add audit logging for auth events

## Future Enhancements

- [ ] Token refresh mechanism
- [ ] Remember me / session persistence options
- [ ] Additional OAuth providers (Google, GitLab)
- [ ] Email/password fallback
- [ ] Two-factor authentication
- [ ] Session management (view/revoke active sessions)
- [ ] GitHub App migration for better permission control
