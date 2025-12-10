// Authentication module for SPtraderB
// Handles GitHub OAuth and JWT session management

pub mod github;
pub mod handlers;
pub mod jwt;
pub mod middleware;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use aes_gcm::{aead::Aead, Aes256Gcm, Key, Nonce, KeyInit};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use uuid::Uuid;
use tracing::{error, warn};

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

/// Load encryption key for GitHub tokens (32 bytes, hex-encoded)
fn load_token_key() -> Result<Key<Aes256Gcm>, String> {
    let key_hex = std::env::var("GITHUB_TOKEN_ENC_KEY")
        .map_err(|_| "GITHUB_TOKEN_ENC_KEY not set".to_string())?;
    let bytes = hex::decode(key_hex.as_bytes())
        .map_err(|e| format!("Invalid GITHUB_TOKEN_ENC_KEY (hex decode): {}", e))?;
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "GITHUB_TOKEN_ENC_KEY must be 32 bytes (64 hex chars)".to_string())?;
    Ok(Key::<Aes256Gcm>::from_slice(&key).to_owned())
}

pub fn encrypt_github_token(token: &str) -> Result<String, String> {
    let key = load_token_key()?;
    let cipher = Aes256Gcm::new(&key);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, token.as_bytes())
        .map_err(|e| format!("Failed to encrypt token: {}", e))?;

    // Store as base64(nonce || ciphertext)
    let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(general_purpose::STANDARD_NO_PAD.encode(combined))
}

pub fn decrypt_github_token(encoded: &str) -> Result<String, String> {
    let key = load_token_key()?;
    let data = general_purpose::STANDARD_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("Failed to base64-decode token: {}", e))?;
    if data.len() < 13 {
        return Err("Encrypted token data too short".to_string());
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(&key);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Failed to decrypt token: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8 token: {}", e))
}

/// Best-effort decrypt: returns plaintext on success, otherwise returns the original string
pub fn decrypt_github_token_lossy(encoded: &str) -> String {
    match decrypt_github_token(encoded) {
        Ok(t) => t,
        Err(e) => {
            warn!("Failed to decrypt GitHub token, returning as-is: {}", e);
            encoded.to_string()
        }
    }
}
