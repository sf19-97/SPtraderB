// HTTP handlers for authentication routes

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{error, info};

use super::{github, jwt, AuthConfig, User, UserProfile, encrypt_github_token};
use crate::AppState;

/// Query params for GitHub OAuth callback
#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: Option<String>,
    pub code_verifier: Option<String>,
}

/// Response after successful login
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: UserProfile,
}

/// Response for errors
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// GET /api/auth/github - Redirect to GitHub OAuth
pub async fn github_login(State(state): State<crate::AppState>) -> Response {
    let config = match AuthConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            error!("Auth not configured: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Auth not configured".to_string(),
                }),
            )
                .into_response();
        }
    };

    let github_auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}/auth/callback&scope=user:email,repo",
        config.github_client_id,
        config.frontend_url
    );

    Redirect::temporary(&github_auth_url).into_response()
}

/// POST /api/auth/callback - Exchange code for token and create/update user
pub async fn github_callback(
    State(state): State<crate::AppState>,
    Json(body): Json<CallbackQuery>,
) -> Response {
    let config = match AuthConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            error!("Auth not configured: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Auth not configured".to_string(),
                }),
            )
                .into_response();
        }
    };

    // Exchange code for GitHub access token
    let token_response = match github::exchange_code_for_token(
        &config.github_client_id,
        &config.github_client_secret,
        &body.code,
        body.code_verifier.as_deref(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to exchange code: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Failed to authenticate with GitHub".to_string(),
                }),
            )
                .into_response();
        }
    };

    // Fetch user info from GitHub
    let github_user = match github::fetch_github_user(&token_response.access_token).await {
        Ok(u) => u,
        Err(e) => {
            error!("Failed to fetch GitHub user: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Failed to fetch user info from GitHub".to_string(),
                }),
            )
                .into_response();
        }
    };

    info!(
        "GitHub user authenticated: {} ({})",
        github_user.login, github_user.id
    );

    // Get database pool
    let pool = match &state.db {
        Some(p) => p,
        None => {
            error!("Database not available");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database not available".to_string(),
                }),
            )
                .into_response();
        }
    };

    // Create or update user in database
    let encrypted_token = match encrypt_github_token(&token_response.access_token) {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to encrypt GitHub token: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to secure token".to_string(),
                }),
            )
                .into_response();
        }
    };

    let user = match sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (github_id, github_username, github_email, github_avatar_url, github_access_token, display_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (github_id) DO UPDATE SET
            github_username = EXCLUDED.github_username,
            github_email = EXCLUDED.github_email,
            github_avatar_url = EXCLUDED.github_avatar_url,
            github_access_token = EXCLUDED.github_access_token,
            last_login_at = NOW()
        RETURNING *
        "#,
    )
    .bind(github_user.id)
    .bind(&github_user.login)
    .bind(&github_user.email)
    .bind(&github_user.avatar_url)
    .bind(&encrypted_token)
    .bind(&github_user.name)
    .fetch_one(pool)
    .await
    {
        Ok(u) => u,
        Err(e) => {
            error!("Failed to upsert user: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to save user".to_string(),
                }),
            )
                .into_response();
        }
    };

    // Create JWT token
    let jwt_token = match jwt::create_token(user.id, &user.github_username, &config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to create JWT: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to create session".to_string(),
                }),
            )
                .into_response();
        }
    };

    info!("User logged in successfully: {}", user.github_username);

    (
        StatusCode::OK,
        Json(LoginResponse {
            token: jwt_token,
            user: user.into(),
        }),
    )
        .into_response()
}

/// GET /api/auth/me - Get current user profile
pub async fn get_current_user(
    State(state): State<crate::AppState>,
    user: User, // Extracted by middleware
) -> Response {
    (StatusCode::OK, Json(UserProfile::from(user))).into_response()
}

/// PUT /api/auth/preferences - Update user preferences
#[derive(Debug, Deserialize)]
pub struct UpdatePreferencesRequest {
    pub preferences: serde_json::Value,
}

pub async fn update_preferences(
    State(state): State<crate::AppState>,
    user: User,
    Json(body): Json<UpdatePreferencesRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database not available".to_string(),
                }),
            )
                .into_response();
        }
    };

    match sqlx::query("UPDATE users SET preferences = $1 WHERE id = $2")
        .bind(&body.preferences)
        .bind(user.id)
        .execute(pool)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to update preferences: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to update preferences".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// PUT /api/auth/memory - Update user memory (AI context, etc.)
#[derive(Debug, Deserialize)]
pub struct UpdateMemoryRequest {
    pub memory: serde_json::Value,
}

pub async fn update_memory(
    State(state): State<crate::AppState>,
    user: User,
    Json(body): Json<UpdateMemoryRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database not available".to_string(),
                }),
            )
                .into_response();
        }
    };

    match sqlx::query("UPDATE users SET memory = $1 WHERE id = $2")
        .bind(&body.memory)
        .bind(user.id)
        .execute(pool)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => {
            error!("Failed to update memory: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to update memory".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// GET /api/auth/repos - List user's GitHub repositories
pub async fn list_github_repos(State(state): State<crate::AppState>, mut user: User) -> Response {
    // Decrypt token for GitHub API calls
    let token = super::decrypt_github_token_lossy(&user.github_access_token);

    match github::fetch_user_repos(&token).await {
        Ok(repos) => (StatusCode::OK, Json(repos)).into_response(),
        Err(e) => {
            error!("Failed to fetch repos: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch repositories".to_string(),
                }),
            )
                .into_response()
        }
    }
}
