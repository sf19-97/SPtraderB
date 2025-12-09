// Authentication middleware for protecting routes

use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use tracing::error;

use super::{jwt, AuthConfig, User};
use crate::AppState;

#[derive(Debug, Serialize)]
struct AuthError {
    error: String,
}

/// Extractor that validates JWT and fetches the user
#[async_trait]
impl<S> FromRequestParts<S> for User
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        // Get auth config
        let config = AuthConfig::from_env().map_err(|e| {
            error!("Auth not configured: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthError {
                    error: "Auth not configured".to_string(),
                }),
            )
                .into_response()
        })?;

        // Extract Authorization header
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(AuthError {
                        error: "Missing authorization header".to_string(),
                    }),
                )
                    .into_response()
            })?;

        // Check Bearer prefix
        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(AuthError {
                    error: "Invalid authorization format".to_string(),
                }),
            )
                .into_response()
        })?;

        // Verify JWT
        let claims = jwt::verify_token(token, &config.jwt_secret).map_err(|e| {
            error!("Invalid token: {}", e);
            (
                StatusCode::UNAUTHORIZED,
                Json(AuthError {
                    error: "Invalid or expired token".to_string(),
                }),
            )
                .into_response()
        })?;

        // Get database pool
        let pool = app_state.db.as_ref().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthError {
                    error: "Database not available".to_string(),
                }),
            )
                .into_response()
        })?;

        // Fetch user from database
        let user_id: uuid::Uuid = claims.sub.parse().map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(AuthError {
                    error: "Invalid user ID in token".to_string(),
                }),
            )
                .into_response()
        })?;

        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                error!("Database error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(AuthError {
                        error: "Database error".to_string(),
                    }),
                )
                    .into_response()
            })?
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(AuthError {
                        error: "User not found".to_string(),
                    }),
                )
                    .into_response()
            })?;

        Ok(user)
    }
}
