use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub data: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveWorkspaceRequest {
    pub name: String,
    pub data: serde_json::Value,
}

pub async fn list_workspaces(
    State(state): State<AppState>,
) -> Result<Json<Vec<Workspace>>, StatusCode> {
    tracing::info!("Listing workspaces");

    // TODO: Query workspaces from database or filesystem
    // For now, return empty list
    Ok(Json(vec![]))
}

pub async fn save_workspace(
    State(state): State<AppState>,
    Json(payload): Json<SaveWorkspaceRequest>,
) -> Result<Json<Workspace>, StatusCode> {
    tracing::info!("Saving workspace: {}", payload.name);

    // TODO: Save workspace to database or filesystem
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    Ok(Json(Workspace {
        id,
        name: payload.name,
        data: payload.data,
        created_at: now.clone(),
        updated_at: now,
    }))
}

pub async fn get_workspace(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Workspace>, StatusCode> {
    tracing::info!("Getting workspace: {}", id);

    // TODO: Query workspace from database
    Err(StatusCode::NOT_FOUND)
}

pub async fn delete_workspace(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    tracing::info!("Deleting workspace: {}", id);

    // TODO: Delete workspace from database
    Ok(StatusCode::OK)
}

// ============================================================================
// File Management Handlers (NEW - workspace file operations)
// ============================================================================

use super::{
    operations, executor, ComponentInfo, CreateFileRequest, FileNode, RenameRequest, SaveFileRequest,
    WORKSPACE_PATH,
};
use std::path::PathBuf;

// ============================================================================
// Helper: Path Security Validation
// ============================================================================

fn validate_path(relative_path: &str) -> Result<PathBuf, (StatusCode, String)> {
    // Prevent directory traversal
    if relative_path.contains("..") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid path: contains '..'".to_string(),
        ));
    }

    // Build full path
    let full_path = PathBuf::from(WORKSPACE_PATH).join(relative_path);

    // Ensure path is within workspace
    if !full_path.starts_with(WORKSPACE_PATH) {
        return Err((
            StatusCode::FORBIDDEN,
            "Access denied: path outside workspace".to_string(),
        ));
    }

    Ok(full_path)
}

// ============================================================================
// GET /api/workspace/tree
// Returns full file hierarchy
// ============================================================================

pub async fn get_workspace_tree() -> Result<Json<Vec<FileNode>>, (StatusCode, String)> {
    tracing::info!("Getting workspace tree");

    let workspace = PathBuf::from(WORKSPACE_PATH);

    if !workspace.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            "Workspace directory not found".to_string(),
        ));
    }

    // Delegate complex tree building to operations.rs
    let tree = operations::build_file_tree(&workspace, &workspace)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to build tree: {}", e)))?;

    Ok(Json(tree))
}

// ============================================================================
// GET /api/workspace/files/*path
// Reads file content
// ============================================================================

pub async fn read_file(Path(relative_path): Path<String>) -> Result<String, (StatusCode, String)> {
    tracing::info!("Reading file: {}", relative_path);

    let full_path = validate_path(&relative_path)?;

    // Inline file read - no need to extract
    std::fs::read_to_string(&full_path)
        .map_err(|e| (StatusCode::NOT_FOUND, format!("Failed to read file: {}", e)))
}

// ============================================================================
// PUT /api/workspace/files/*path
// Saves file content
// ============================================================================

pub async fn save_file(
    Path(relative_path): Path<String>,
    Json(payload): Json<SaveFileRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("Saving file: {}", relative_path);

    let full_path = validate_path(&relative_path)?;

    // Create parent directories if needed (inline - simple logic)
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create directories: {}", e),
            )
        })?;
    }

    // Inline file write
    std::fs::write(&full_path, payload.content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save file: {}", e),
        )
    })?;

    Ok(StatusCode::OK)
}

// ============================================================================
// POST /api/workspace/files
// Creates new file with template
// ============================================================================

pub async fn create_file(
    Json(payload): Json<CreateFileRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!(
        "Creating file: {} ({})",
        payload.path,
        payload.component_type
    );

    let full_path = validate_path(&payload.path)?;

    // Check if file already exists
    if full_path.exists() {
        return Err((StatusCode::CONFLICT, "File already exists".to_string()));
    }

    // Delegate template generation to operations.rs (complex logic)
    let template = operations::get_component_template(&payload.component_type)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid component type: {}", e)))?;

    // Create parent directories
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create directories: {}", e),
            )
        })?;
    }

    // Write template
    std::fs::write(&full_path, template).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create file: {}", e),
        )
    })?;

    Ok(StatusCode::CREATED)
}

// ============================================================================
// DELETE /api/workspace/files/*path
// Deletes file
// ============================================================================

pub async fn delete_file(
    Path(relative_path): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("Deleting file: {}", relative_path);

    let full_path = validate_path(&relative_path)?;

    // Check if file exists
    if !full_path.exists() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    // Inline file deletion
    std::fs::remove_file(&full_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete file: {}", e),
        )
    })?;

    Ok(StatusCode::OK)
}

// ============================================================================
// POST /api/workspace/rename
// Renames or moves file
// ============================================================================

pub async fn rename_file(
    Json(payload): Json<RenameRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    tracing::info!("Renaming file: {} -> {}", payload.old_path, payload.new_name);

    let old_full_path = validate_path(&payload.old_path)?;

    // Check if source exists
    if !old_full_path.exists() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    // Determine if this is a rename or move
    let new_full_path = if payload.new_name.contains('/') {
        // It's a move - validate full new path
        validate_path(&payload.new_name)?
    } else {
        // Simple rename in same directory
        let parent = old_full_path.parent().ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to get parent directory".to_string(),
        ))?;
        parent.join(&payload.new_name)
    };

    // Check if destination exists
    if new_full_path.exists() {
        return Err((StatusCode::CONFLICT, "Destination already exists".to_string()));
    }

    // Perform rename
    std::fs::rename(&old_full_path, &new_full_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to rename file: {}", e),
        )
    })?;

    // Return new relative path
    let new_relative = new_full_path
        .strip_prefix(WORKSPACE_PATH)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to compute relative path".to_string(),
            )
        })?
        .to_str()
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid path encoding".to_string(),
        ))?
        .replace('\\', "/");

    Ok(Json(new_relative))
}

// ============================================================================
// GET /api/workspace/components
// Lists all components with metadata
// ============================================================================

pub async fn get_components() -> Result<Json<Vec<ComponentInfo>>, (StatusCode, String)> {
    tracing::info!("Getting workspace components");

    let workspace = PathBuf::from(WORKSPACE_PATH);

    // Delegate complex scanning to operations.rs
    let components = operations::scan_workspace_components(&workspace)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to scan components: {}", e)))?;

    Ok(Json(components))
}

// ============================================================================
// GET /api/workspace/categories/:type
// Lists categories for a component type
// ============================================================================

pub async fn get_categories(
    Path(component_type): Path<String>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    tracing::info!("Getting categories for: {}", component_type);

    let workspace = PathBuf::from(WORKSPACE_PATH);

    let component_path = match component_type.as_str() {
        "indicator" => workspace.join("core").join("indicators"),
        "signal" => workspace.join("core").join("signals"),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid component type: {}", component_type),
            ))
        }
    };

    if !component_path.exists() {
        // Return defaults if directory doesn't exist
        let defaults = match component_type.as_str() {
            "indicator" => super::DEFAULT_INDICATOR_CATEGORIES.to_vec(),
            "signal" => super::DEFAULT_SIGNAL_CATEGORIES.to_vec(),
            _ => vec![],
        };
        return Ok(Json(defaults.into_iter().map(String::from).collect()));
    }

    // Inline directory scan - simple logic
    let mut categories = Vec::new();

    for entry in std::fs::read_dir(&component_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read directory: {}", e),
        )
    })? {
        let entry = entry.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let path = entry.path();

        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Skip hidden directories and __pycache__
                if !name.starts_with('.') && name != "__pycache__" {
                    categories.push(name.to_string());
                }
            }
        }
    }

    categories.sort();
    Ok(Json(categories))
}

// ============================================================================
// POST /api/workspace/run-component
// Executes Python component and returns output
// ============================================================================

pub async fn run_component(
    Json(payload): Json<executor::RunComponentRequest>,
) -> Result<Json<executor::RunComponentResponse>, (StatusCode, String)> {
    tracing::info!("Running component: {}", payload.file_path);

    executor::execute_component(WORKSPACE_PATH, payload)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}
