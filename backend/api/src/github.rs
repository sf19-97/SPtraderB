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

#[derive(Debug, Deserialize)]
struct BuildCenterGithubPref {
    repo: String,
    branch: Option<String>,
    root_path: Option<String>,
}

fn extract_build_center_pref(user: &User) -> Result<BuildCenterGithubPref, Response> {
    let prefs_value = &user.preferences;
    let Some(obj) = prefs_value.as_object() else {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "Build Center GitHub preferences not configured",
        ));
    };

    if let Some(cfg) = obj.get("build_center_github") {
        serde_json::from_value::<BuildCenterGithubPref>(cfg.clone()).map_err(|_| {
            error_response(
                StatusCode::BAD_REQUEST,
                "Invalid build_center_github preferences format",
            )
        })
    } else {
        Err(error_response(
            StatusCode::FORBIDDEN,
            "Build Center GitHub preferences not configured",
        ))
    }
}

fn normalize_root(root: &Option<String>) -> Option<String> {
    root.as_ref().map(|r| r.trim_matches('/').to_string()).filter(|s| !s.is_empty())
}

fn assert_scope(
    user: &User,
    repo: &str,
    branch: &str,
    path: &str,
) -> Result<(), Response> {
    let cfg = extract_build_center_pref(user)?;
    if cfg.repo != repo {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "Repo not allowed for Build Center GitHub access",
        ));
    }

    if let Some(cfg_branch) = cfg.branch {
        if cfg_branch != branch {
            return Err(error_response(
                StatusCode::FORBIDDEN,
                "Branch not allowed; update preferences to change branch",
            ));
        }
    }

    if let Some(root) = normalize_root(&cfg.root_path) {
        if !path.trim_start_matches('/').starts_with(&root) {
            return Err(error_response(
                StatusCode::FORBIDDEN,
                format!("Path must reside under configured root: {}", root),
            ));
        }
    }

    Ok(())
}

fn assert_type_path(file_type: &Option<String>, path: &str) -> Result<(), Response> {
    if let Some(t) = file_type {
        match t.as_str() {
            "indicator" | "signal" => {
                if !path.ends_with(".py") {
                    return Err(error_response(
                        StatusCode::BAD_REQUEST,
                        "Indicators/signals must be Python (.py) files",
                    ));
                }
            }
            "strategy" => {
                if !path.ends_with(".yaml") && !path.ends_with(".yml") {
                    return Err(error_response(
                        StatusCode::BAD_REQUEST,
                        "Strategies must be YAML (.yaml/.yml) files",
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
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

fn github_client(_token: &str) -> Result<reqwest::Client, Response> {
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

    let status = resp.status();

    if status == ReqwestStatus::NOT_FOUND {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "Repository not found on GitHub",
        ));
    }

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub repo fetch error ({}): {}",
            status.as_u16(),
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

    let status = resp.status();

    if status == ReqwestStatus::NOT_FOUND {
        return Ok(None);
    }

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub metadata fetch error ({}): {}",
            status.as_u16(),
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

    let status = resp.status();

    if status == ReqwestStatus::NOT_FOUND {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "File not found on GitHub",
        ));
    }

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "GitHub fetch error ({}): {}",
            status.as_u16(),
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
    pub file_type: Option<String>,
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

    if let Err(resp) = assert_scope(&user, &query.repo, &branch, &path) {
        return resp;
    }

    if let Err(resp) = assert_type_path(&query.file_type, &path) {
        return resp;
    }

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
    pub file_type: Option<String>,
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

    let status = resp.status();

    if status == ReqwestStatus::UNPROCESSABLE_ENTITY {
        let body = resp.text().await.unwrap_or_default();
        error!("PR already exists or invalid: {}", body);
        return Err(error_response(
            StatusCode::CONFLICT,
            "A pull request already exists for this branch",
        ));
    }

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        ));
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!(
            "PR creation failed ({}): {}",
            status.as_u16(),
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

    if let Err(resp) = assert_scope(&user, &payload.repo, &branch, &path) {
        return resp;
    }
    if let Err(resp) = assert_type_path(&payload.file_type, &path) {
        return resp;
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

    let status = resp.status();

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        );
    }

    if status == ReqwestStatus::CONFLICT {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub reported conflict: {}", body);
        return error_response(
            StatusCode::CONFLICT,
            "GitHub reported a conflict; reload the latest content",
        );
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub save error ({}): {}", status.as_u16(), body);
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

    fn helper(tree: &mut Vec<FileNode>, parts: &[&str], accumulated: &str, is_file: bool) {
        if parts.is_empty() {
            return;
        }

        let part = parts[0];
        let is_last = parts.len() == 1;
        let node_type = if is_last && is_file { "file" } else { "folder" };
        let path = if accumulated.is_empty() {
            part.to_string()
        } else {
            format!("{}/{}", accumulated, part)
        };

        let idx = tree
            .iter()
            .position(|node| node.name == part && node.node_type == node_type)
            .unwrap_or_else(|| {
                tree.push(FileNode {
                    name: part.to_string(),
                    path: path.clone(),
                    node_type: node_type.to_string(),
                    children: if node_type == "folder" {
                        Some(Vec::new())
                    } else {
                        None
                    },
                });
                tree.len() - 1
            });

        if is_last {
            return;
        }

        if let Some(children) = tree[idx].children.as_mut() {
            helper(children, &parts[1..], &path, is_file);
        }
    }

    helper(root, &parts, "", entry_type == "blob");
}

pub async fn get_github_tree(
    State(_state): State<AppState>,
    user: User,
    Query(query): Query<TreeQuery>,
) -> Response {
    if let Err(resp) = validate_repo(&query.repo) {
        return resp;
    }

    let cfg = match extract_build_center_pref(&user) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    if cfg.repo != query.repo {
        return error_response(
            StatusCode::FORBIDDEN,
            "Repo not allowed for Build Center GitHub access",
        );
    }

    let mut branch = match &query.branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => match get_default_branch(&query.repo, &user.github_access_token).await {
            Ok(b) => b,
            Err(resp) => return resp,
        },
    };

    if let Some(cfg_branch) = cfg.branch {
        if cfg_branch != branch {
            return error_response(
                StatusCode::FORBIDDEN,
                "Branch not allowed; update preferences to change branch",
            );
        }
        branch = cfg_branch;
    }

    if let Some(root) = normalize_root(&cfg.root_path) {
        if let Some(req_path) = &query.path {
            let trimmed = req_path.trim_matches('/');
            if !trimmed.starts_with(&root) {
                return error_response(
                    StatusCode::FORBIDDEN,
                    format!("Tree path must be under configured root: {}", root),
                );
            }
        }
    }

    if let Some(root) = normalize_root(&extract_build_center_pref(&user).ok().and_then(|c| c.root_path)) {
        if let Some(req_path) = &query.path {
            let trimmed = req_path.trim_matches('/');
            if !trimmed.starts_with(&root) {
                return error_response(
                    StatusCode::FORBIDDEN,
                    format!("Tree path must be under configured root: {}", root),
                );
            }
        }
    }

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

    let status = resp.status();

    if status == ReqwestStatus::NOT_FOUND {
        return error_response(StatusCode::NOT_FOUND, "Branch or path not found on GitHub");
    }

    if status == ReqwestStatus::UNAUTHORIZED || status == ReqwestStatus::FORBIDDEN {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "GitHub authorization failed",
        );
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        error!("GitHub tree error ({}): {}", status.as_u16(), body);
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
#[derive(Debug, Deserialize)]
pub struct BootstrapRequest {
    pub repo: String,
    pub branch: Option<String>,
    pub root_path: Option<String>,
    pub include_indicator: Option<bool>,
    pub include_signal: Option<bool>,
    pub include_strategy: Option<bool>,
}

fn join_paths(root: Option<&str>, tail: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(r) = root {
        let trimmed = r.trim_matches('/');
        if !trimmed.is_empty() {
            parts.push(trimmed);
        }
    }
    parts.push(tail.trim_matches('/'));
    parts.join("/")
}

pub async fn bootstrap_structure(
    State(_state): State<AppState>,
    user: User,
    Json(payload): Json<BootstrapRequest>,
) -> Response {
    if let Err(resp) = validate_repo(&payload.repo) {
        return resp;
    }

    let cfg = match extract_build_center_pref(&user) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    if cfg.repo != payload.repo {
        return error_response(
            StatusCode::FORBIDDEN,
            "Repo not allowed for bootstrap; update preferences first",
        );
    }

    let branch = payload
        .branch
        .or(cfg.branch)
        .unwrap_or_else(|| "main".to_string());

    let include_indicator = payload.include_indicator.unwrap_or(true);
    let include_signal = payload.include_signal.unwrap_or(true);
    let include_strategy = payload.include_strategy.unwrap_or(true);

    let root = normalize_root(&payload.root_path).or_else(|| normalize_root(&cfg.root_path));

    let mut tasks: Vec<(String, String, String)> = Vec::new();

    if include_indicator {
        let path = join_paths(root.as_deref(), "core/indicators/momentum/sample_indicator.py");
        let content = r#"\"\"\"
Sample indicator
\"\"\"

def run(data):
    return data["close"].rolling(window=5).mean()
"#;
        tasks.push((path, content.to_string(), "indicator".to_string()));
    }

    if include_signal {
        let path = join_paths(root.as_deref(), "core/signals/basic/sample_signal.py");
        let content = r#"\"\"\"
Sample signal
\"\"\"

def run(indicators):
    return "buy"
"#;
        tasks.push((path, content.to_string(), "signal".to_string()));
    }

    if include_strategy {
        let path = join_paths(root.as_deref(), "strategies/sample_strategy.yaml");
        let content = r#"name: sample_strategy
version: 0.1.0
type: strategy
description: Sample strategy scaffold

components:
  indicators:
    - core.indicators.momentum.sample_indicator
  signals:
    - core.signals.basic.sample_signal
"#;
        tasks.push((path, content.to_string(), "strategy".to_string()));
    }

    for (path, content, kind) in tasks {
        if let Err(resp) = assert_scope(&user, &payload.repo, &branch, &path) {
            return resp;
        }
        let res = save_github_file(
            State(_state.clone()),
            user.clone(),
            Json(SaveFileRequest {
                repo: payload.repo.clone(),
                path: path.clone(),
                branch: branch.clone(),
                content,
                sha: None,
                message: Some(format!("Bootstrap {} via Build Center", kind)),
                create_pr: None,
                base_branch: None,
                pr_title: None,
                file_type: Some(kind),
            }),
        )
        .await;

        if res.status() != StatusCode::OK {
            return res;
        }
    }

    (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response()
}
