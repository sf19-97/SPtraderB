pub mod executor;
pub mod handlers;
pub mod operations;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ============================================================================
// Core Types (shared between handlers and operations)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String, // "file" | "folder"
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ComponentInfo {
    pub name: String,
    pub component_type: String, // "indicator" | "signal" | "strategy"
    pub category: String,
    pub path: String,
    pub has_metadata: bool,
    pub status: String, // "prototype" | "ready" | "production"
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateFileRequest {
    pub path: String,
    pub component_type: String, // "indicator" | "signal" | "strategy"
}

#[derive(Debug, Deserialize)]
pub struct SaveFileRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameRequest {
    pub old_path: String,
    pub new_name: String,
}

// ============================================================================
// Workspace location helper
// ============================================================================

/// Resolve the workspace root with the following precedence:
/// 1) WORKSPACE_PATH env var
/// 2) /app/workspace (production default)
/// 3) ./workspace relative to current dir (local default)
pub fn workspace_root() -> PathBuf {
    if let Ok(env_path) = std::env::var("WORKSPACE_PATH") {
        return PathBuf::from(env_path);
    }

    let prod_path = PathBuf::from("/app/workspace");
    if prod_path.exists() {
        return prod_path;
    }

    std::env::current_dir()
        .map(|cwd| cwd.join("workspace"))
        .unwrap_or_else(|_| PathBuf::from("workspace"))
}

// Default categories for components
pub const DEFAULT_INDICATOR_CATEGORIES: &[&str] = &[
    "momentum",
    "trend",
    "volatility",
    "volume",
    "microstructure",
];
pub const DEFAULT_SIGNAL_CATEGORIES: &[&str] = &[];
