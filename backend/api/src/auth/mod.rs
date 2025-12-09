// Authentication module for SPtraderB
// Handles GitHub OAuth and JWT session management

pub mod github;
pub mod handlers;
pub mod jwt;
pub mod middleware;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User model from database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub github_id: i64,
    pub github_username: String,
    pub github_email: Option<String>,
    pub github_avatar_url: Option<String>,
    #[serde(skip_serializing)] // Never send token to frontend
    pub github_access_token: String,
    pub display_name: Option<String>,
    pub preferences: serde_json::Value,
    pub memory: serde_json::Value,
    pub connected_repos: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub last_login_at: chrono::DateTime<chrono::Utc>,
}

/// Public user profile (safe to send to frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub github_username: String,
    pub github_email: Option<String>,
    pub github_avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub preferences: serde_json::Value,
    pub connected_repos: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for UserProfile {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            github_username: user.github_username,
            github_email: user.github_email,
            github_avatar_url: user.github_avatar_url,
            display_name: user.display_name,
            preferences: user.preferences,
            connected_repos: user.connected_repos,
            created_at: user.created_at,
        }
    }
}

/// Auth configuration loaded from environment
#[derive(Clone)]
pub struct AuthConfig {
    pub github_client_id: String,
    pub github_client_secret: String,
    pub jwt_secret: String,
    pub frontend_url: String,
}

impl AuthConfig {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            github_client_id: std::env::var("GITHUB_CLIENT_ID")
                .map_err(|_| "GITHUB_CLIENT_ID not set")?,
            github_client_secret: std::env::var("GITHUB_CLIENT_SECRET")
                .map_err(|_| "GITHUB_CLIENT_SECRET not set")?,
            jwt_secret: std::env::var("JWT_SECRET").map_err(|_| "JWT_SECRET not set")?,
            frontend_url: std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://sptraderb.vercel.app".to_string()),
        })
    }
}
