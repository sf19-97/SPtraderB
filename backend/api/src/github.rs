use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use reqwest::StatusCode as ReqwestStatus;
use serde::{Deserialize, Serialize};
use tracing::{error, info};

use crate::{auth::User, workspace::FileNode, AppState};

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(ErrorResponse { error: message.into() })).into_response()
}

fn validate_repo(repo: &str) -> Result<(), Response> {
    if repo.split('/').count() != 2 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Invalid repo format, expected owner/name",
        ));
    }
    Ok(())
}

fn sanitize_path(path: &str) -> Result<String, Response> {
    if path.contains("..") {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Invalid path: must not include '..'",
        ));
    }
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Path is required",
        ));
    }
    Ok(trimmed.to_string())
}

fn github_client(token: &str) -> Result<reqwest::Client, Response> {
    reqwest::Client::builder()
        .user_agent("SPtraderB-BuildCenter")
        .build()
        .map(|client| client)
        .map_err(|e| {
            error!("Failed to build GitHub client: {}", e);
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to initialize GitHub client",
            )
        })
}

async fn get_default_branch(repo: &str, token: &str) -> Result<String, Response> {
    let client = github_client(token)?;
    let url = format!("https://api.github.com/repos/{}", repo);

    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            error!("GitHub repo fetch failed: {}", e);
            error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to fetch repository details",
            )
        })?;

    if resp.status() == ReqwestStatus::NOT_FOUND {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "Repository not found on GitHub",
        ));
    }

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub repo fetch error ({}): {}",
            resp.status().as_u16(),
            body
        );
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to fetch repository metadata",
        ));
    }

    #[derive(Deserialize)]
    struct RepoInfo {
        default_branch: String,
    }

    resp.json::<RepoInfo>()
        .await
        .map(|r| r.default_branch)
        .map_err(|e| {
            error!("Failed to parse repo response: {}", e);
            error_response(
                StatusCode::BAD_GATEWAY,
                "Unexpected GitHub response when reading repo metadata",
            )
        })
}

#[derive(Deserialize)]
struct GitHubContent {
    sha: String,
    content: Option<String>,
    encoding: Option<String>,
    path: String,
}

async fn fetch_file_metadata(
    repo: &str,
    path: &str,
    branch: &str,
    token: &str,
) -> Result<Option<String>, Response> {
    let client = github_client(token)?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let resp = client
        .get(url)
        .query(&[("ref", branch)])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            error!("GitHub metadata fetch failed: {}", e);
            error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to query GitHub for file metadata",
            )
        })?;

    if resp.status() == ReqwestStatus::NOT_FOUND {
        return Ok(None);
    }

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub metadata fetch error ({}): {}",
            resp.status().as_u16(),
            body
        );
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to query GitHub file metadata",
        ));
    }

    let info = resp.json::<GitHubContent>().await.map_err(|e| {
        error!("Failed to parse GitHub metadata: {}", e);
        error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to parse GitHub metadata response",
        )
    })?;

    Ok(Some(info.sha))
}

async fn fetch_file(
    repo: &str,
    path: &str,
    branch: &str,
    token: &str,
) -> Result<(String, String), Response> {
    let client = github_client(token)?;
    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let resp = client
        .get(url)
        .query(&[("ref", branch)])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            error!("GitHub file fetch failed: {}", e);
            error_response(StatusCode::BAD_GATEWAY, "Failed to fetch file from GitHub")
        })?;

    if resp.status() == ReqwestStatus::NOT_FOUND {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "File not found on GitHub",
        ));
    }

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub fetch error ({}): {}",
            resp.status().as_u16(),
            body
        );
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Unexpected GitHub response when fetching file",
        ));
    }

    let payload = resp.json::<GitHubContent>().await.map_err(|e| {
        error!("Failed to parse GitHub file response: {}", e);
        error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to parse GitHub file response",
        )
    })?;

    let encoding = payload.encoding.unwrap_or_else(|| "base64".to_string());
    if encoding.to_lowercase() != "base64" {
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            format!("Unsupported encoding from GitHub: {}", encoding),
        ));
    }

    let raw_content = payload
        .content
        .unwrap_or_default()
        .replace('\n', "");

    let decoded = BASE64_STANDARD
        .decode(raw_content.as_bytes())
        .map_err(|e| {
            error!("Failed to decode GitHub content: {}", e);
            error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to decode GitHub file content",
            )
        })?;

    let content = String::from_utf8(decoded).map_err(|e| {
        error!("Invalid UTF-8 in GitHub content: {}", e);
        error_response(StatusCode::BAD_GATEWAY, "Invalid UTF-8 in GitHub content")
    })?;

    Ok((content, payload.sha))
}

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    pub repo: String,
    pub path: String,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileResponse {
    pub path: String,
    pub branch: String,
    pub sha: String,
    pub content: String,
}

pub async fn get_github_file(
    State(_state): State<AppState>,
    user: User,
    Query(query): Query<FileQuery>,
) -> Response {
    if let Err(resp) = validate_repo(&query.repo) {
        return resp;
    }

    let path = match sanitize_path(&query.path) {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    let branch = match query.branch {
        Some(b) if !b.trim().is_empty() => b,
        _ => match get_default_branch(&query.repo, &user.github_access_token).await {
            Ok(b) => b,
            Err(resp) => return resp,
        },
    };

    match fetch_file(&query.repo, &path, &branch, &user.github_access_token).await {
        Ok((content, sha)) => {
            info!(
                "Fetched file from GitHub: {}/{}@{}",
                query.repo, path, branch
            );
            (
                StatusCode::OK,
                Json(FileResponse {
                    path,
                    branch,
                    sha,
                    content,
                }),
            )
                .into_response()
        }
        Err(resp) => resp,
    }
}

#[derive(Debug, Deserialize)]
pub struct SaveFileRequest {
    pub repo: String,
    pub path: String,
    pub branch: String,
    pub content: String,
    pub sha: Option<String>,
    pub message: Option<String>,
    pub create_pr: Option<bool>,
    pub base_branch: Option<String>,
    pub pr_title: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveFileResponse {
    pub path: String,
    pub branch: String,
    pub sha: String,
    pub commit_sha: String,
    pub html_url: Option<String>,
    pub pr_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubCommitInfo {
    sha: String,
    html_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubContentInfo {
    sha: String,
    path: String,
    html_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubSaveResponse {
    content: GitHubContentInfo,
    commit: GitHubCommitInfo,
}

async fn create_pull_request(
    repo: &str,
    head_branch: &str,
    base_branch: &str,
    token: &str,
    title: Option<String>,
) -> Result<String, Response> {
    let client = github_client(token)?;
    let url = format!("https://api.github.com/repos/{}/pulls", repo);

    #[derive(Serialize)]
    struct PrRequest<'a> {
        title: &'a str,
        head: &'a str,
        base: &'a str,
    }

    let pr_title = title.unwrap_or_else(|| format!("Update {} via Build Center", head_branch));
    let body = PrRequest {
        title: &pr_title,
        head: head_branch,
        base: base_branch,
    };

    let resp = client
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("PR creation failed: {}", e);
            error_response(StatusCode::BAD_GATEWAY, "Failed to create pull request")
        })?;

    if resp.status() == ReqwestStatus::UNPROCESSABLE_ENTITY {
        let body = resp.text().await.unwrap_or_default();
        error!("PR already exists or invalid: {}", body);
        return Err(error_response(
            StatusCode::CONFLICT,
            "A pull request already exists for this branch",
        ));
    }

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "PR creation failed ({}): {}",
            resp.status().as_u16(),
            body
        );
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to create pull request",
        ));
    }

    #[derive(Deserialize)]
    struct PrResponse {
        html_url: String,
    }

    resp.json::<PrResponse>().await.map(|r| r.html_url).map_err(|e| {
        error!("Failed to parse PR response: {}", e);
        error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to parse pull request response",
        )
    })
}

pub async fn save_github_file(
    State(_state): State<AppState>,
    user: User,
    Json(payload): Json<SaveFileRequest>,
) -> Response {
    if let Err(resp) = validate_repo(&payload.repo) {
        return resp;
    }

    let path = match sanitize_path(&payload.path) {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    let branch = payload.branch.trim();
    if branch.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Branch is required to save files",
        );
    }
    let branch = branch.to_string();

    if payload.sha.is_none() {
        match fetch_file_metadata(&payload.repo, &path, &branch, &user.github_access_token).await {
            Ok(Some(_)) => {
                return error_response(
                    StatusCode::CONFLICT,
                    "File exists on GitHub; provide the latest sha to update",
                )
            }
            Ok(None) => {}
            Err(resp) => return resp,
        }
    }

    let encoded = BASE64_STANDARD.encode(payload.content.as_bytes());
    let commit_message = payload
        .message
        .clone()
        .unwrap_or_else(|| format!("Update {} via Build Center", path));

    let mut body = serde_json::json!({
        "message": commit_message,
        "content": encoded,
        "branch": branch,
    });

    if let Some(sha) = &payload.sha {
        body["sha"] = serde_json::Value::String(sha.clone());
    }

    let client = match github_client(&user.github_access_token) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    let url = format!("https://api.github.com/repos/{}/contents/{}", payload.repo, path);
    let resp = match client
        .put(url)
        .bearer_auth(&user.github_access_token)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("GitHub save failed: {}", e);
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to save file to GitHub",
            );
        }
    };

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        );
    }

    if resp.status() == ReqwestStatus::CONFLICT {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub reported conflict: {}", body);
        return error_response(
            StatusCode::CONFLICT,
            "GitHub reported a conflict; reload the latest content",
        );
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub save error ({}): {}", resp.status().as_u16(), body);
        return error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to save file to GitHub",
        );
    }

    let save_response = match resp.json::<GitHubSaveResponse>().await {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to parse GitHub save response: {}", e);
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to parse GitHub save response",
            );
        }
    };

    let mut pr_url: Option<String> = None;
    if payload.create_pr.unwrap_or(false) {
        let base_branch = if let Some(base) = payload.base_branch.clone() {
            base
        } else {
            match get_default_branch(&payload.repo, &user.github_access_token).await {
                Ok(b) => b,
                Err(resp) => return resp,
            }
        };

        if base_branch == branch {
            return error_response(
                StatusCode::BAD_REQUEST,
                "Base branch must differ from feature branch to create a PR",
            );
        }

        match create_pull_request(
            &payload.repo,
            &branch,
            &base_branch,
            &user.github_access_token,
            payload.pr_title.clone(),
        )
        .await
        {
            Ok(url) => {
                info!(
                    "Created PR for {}/{} -> {}",
                    payload.repo, branch, base_branch
                );
                pr_url = Some(url);
            }
            Err(resp) => return resp,
        }
    }

    (
        StatusCode::OK,
        Json(SaveFileResponse {
            path: save_response.content.path,
            branch,
            sha: save_response.content.sha,
            commit_sha: save_response.commit.sha,
            html_url: save_response.content.html_url,
            pr_url,
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct TreeQuery {
    pub repo: String,
    pub branch: Option<String>,
    pub path: Option<String>,
}

#[derive(Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Deserialize)]
struct GitTreeResponse {
    tree: Vec<GitTreeEntry>,
    truncated: bool,
}

fn insert_into_tree(root: &mut Vec<FileNode>, full_path: &str, entry_type: &str) {
    let parts: Vec<&str> = full_path.split('/').collect();
    let mut current_level = root;
    let mut accumulated = String::new();

    for (idx, part) in parts.iter().enumerate() {
        if !accumulated.is_empty() {
            accumulated.push('/');
        }
        accumulated.push_str(part);

        let is_last = idx == parts.len() - 1;
        let target_type = if is_last && entry_type == "blob" {
            "file"
        } else {
            "folder"
        };

        if let Some(existing) = current_level
            .iter_mut()
            .find(|node| node.name == *part && node.node_type == target_type)
        {
            if let Some(children) = existing.children.as_mut() {
                current_level = children;
            }
            continue;
        }

        let new_node = FileNode {
            name: part.to_string(),
            path: accumulated.clone(),
            node_type: target_type.to_string(),
            children: if target_type == "folder" {
                Some(Vec::new())
            } else {
                None
            },
        };

        current_level.push(new_node);
        if let Some(last) = current_level.last_mut() {
            if let Some(children) = last.children.as_mut() {
                current_level = children;
            }
        }
    }
}

pub async fn get_github_tree(
    State(_state): State<AppState>,
    user: User,
    Query(query): Query<TreeQuery>,
) -> Response {
    if let Err(resp) = validate_repo(&query.repo) {
        return resp;
    }

    let branch = match &query.branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => match get_default_branch(&query.repo, &user.github_access_token).await {
            Ok(b) => b,
            Err(resp) => return resp,
        },
    };

    let client = match github_client(&user.github_access_token) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    let tree_ref = if let Some(path) = &query.path {
        format!("{}:{}", branch, path.trim_matches('/'))
    } else {
        branch.clone()
    };

    let url = format!(
        "https://api.github.com/repos/{}/git/trees/{}",
        query.repo, tree_ref
    );

    let resp = match client
        .get(url)
        .query(&[("recursive", "1")])
        .bearer_auth(&user.github_access_token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("GitHub tree fetch failed: {}", e);
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to fetch GitHub tree",
            );
        }
    };

    if resp.status() == ReqwestStatus::NOT_FOUND {
        return error_response(StatusCode::NOT_FOUND, "Branch or path not found on GitHub");
    }

    if resp.status() == ReqwestStatus::UNAUTHORIZED || resp.status() == ReqwestStatus::FORBIDDEN {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        );
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub tree error ({}): {}", resp.status().as_u16(), body);
        return error_response(
            StatusCode::BAD_GATEWAY,
            "Failed to fetch GitHub tree",
        );
    }

    let tree_response = match resp.json::<GitTreeResponse>().await {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to parse GitHub tree response: {}", e);
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to parse GitHub tree response",
            );
        }
    };

    if tree_response.truncated {
        return error_response(
            StatusCode::BAD_REQUEST,
            "GitHub tree is too large; please narrow the path",
        );
    }

    let mut roots: Vec<FileNode> = Vec::new();
    let base_prefix = query.path.unwrap_or_default();
    let base_prefix = base_prefix.trim_matches('/').to_string();

    for entry in tree_response.tree {
        let entry_path = if base_prefix.is_empty() {
            entry.path
        } else if let Some(stripped) = entry.path.strip_prefix(&(base_prefix.clone() + "/")) {
            stripped.to_string()
        } else if entry.path == base_prefix {
            // Skip the base directory itself
            continue;
        } else {
            continue;
        };

        if entry_path.is_empty() {
            continue;
        }

        insert_into_tree(&mut roots, &entry_path, &entry.entry_type);
    }

    info!(
        "Fetched GitHub tree for {}/{} ({})",
        query.repo,
        branch,
        base_prefix
    );

    (StatusCode::OK, Json(roots)).into_response()
}
