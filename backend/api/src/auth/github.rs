// GitHub OAuth utilities for SPtraderB

use serde::{Deserialize, Serialize};

/// GitHub OAuth token response
#[derive(Debug, Deserialize)]
pub struct GitHubTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
}

/// GitHub user info from API
#[derive(Debug, Deserialize, Serialize)]
pub struct GitHubUser {
    pub id: i64,
    pub login: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub name: Option<String>,
}

/// Exchange authorization code for access token
pub async fn exchange_code_for_token(
    client_id: &str,
    client_secret: &str,
    code: &str,
    code_verifier: Option<&str>,
) -> Result<GitHubTokenResponse, String> {
    let client = reqwest::Client::new();

    // Use PKCE if a code_verifier was provided
    let mut form = vec![
        ("client_id", client_id.to_string()),
        ("client_secret", client_secret.to_string()),
        ("code", code.to_string()),
    ];

    if let Some(verifier) = code_verifier {
        form.push(("code_verifier", verifier.to_string()));
    }

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Failed to exchange code: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub token exchange failed: {}", error_text));
    }

    response
        .json::<GitHubTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

/// Fetch user info from GitHub API
pub async fn fetch_github_user(access_token: &str) -> Result<GitHubUser, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "SPtraderB")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub API error: {}", error_text));
    }

    response
        .json::<GitHubUser>()
        .await
        .map_err(|e| format!("Failed to parse user response: {}", e))
}

/// Fetch user's repositories from GitHub
pub async fn fetch_user_repos(access_token: &str) -> Result<Vec<GitHubRepo>, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/user/repos")
        .query(&[("per_page", "100"), ("sort", "updated")])
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "SPtraderB")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repos: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub API error: {}", error_text));
    }

    response
        .json::<Vec<GitHubRepo>>()
        .await
        .map_err(|e| format!("Failed to parse repos response: {}", e))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GitHubRepo {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub description: Option<String>,
    pub default_branch: String,
}
