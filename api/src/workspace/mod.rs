pub mod handlers;
pub mod operations;

use serde::{Deserialize, Serialize};

// ============================================================================
// Core Types (shared between handlers and operations)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,  // "file" | "folder"
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ComponentInfo {
    pub name: String,
    pub component_type: String,  // "indicator" | "signal" | "strategy"
    pub category: String,
    pub path: String,
    pub has_metadata: bool,
    pub status: String,  // "prototype" | "ready" | "production"
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateFileRequest {
    pub path: String,
    pub component_type: String,  // "indicator" | "signal" | "strategy"
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
// Constants
// ============================================================================

// Workspace path - use local path for development, /app/workspace for production
#[cfg(debug_assertions)]
pub const WORKSPACE_PATH: &str = "/Users/sebastian/Projects/SPtraderB/workspace";  // Local dev

#[cfg(not(debug_assertions))]
pub const WORKSPACE_PATH: &str = "/app/workspace";  // Fly.io production

// Default categories for components
pub const DEFAULT_INDICATOR_CATEGORIES: &[&str] =
    &["momentum", "trend", "volatility", "volume", "microstructure"];
pub const DEFAULT_SIGNAL_CATEGORIES: &[&str] = &[];
