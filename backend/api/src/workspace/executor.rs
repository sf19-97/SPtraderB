use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tracing::{error, info};

#[derive(Debug, Deserialize)]
pub struct RunComponentRequest {
    pub file_path: String,
    pub dataset: Option<String>,
    pub env_vars: HashMap<String, String>,
    pub candle_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RunComponentResponse {
    pub success: bool,
    pub execution_time_ms: f64,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub output_lines: usize,
    pub error_lines: usize,
}

/// Execute a Python component file and return the output
pub async fn execute_component(
    workspace_path: &Path,
    request: RunComponentRequest,
) -> Result<RunComponentResponse, String> {
    let start_time = std::time::Instant::now();

    info!("Executing component: {}", request.file_path);

    // Resolve and validate workspace root
    let workspace_root = workspace_path
        .canonicalize()
        .unwrap_or_else(|_| workspace_path.to_path_buf());

    // Quick reject for traversal attempts
    if request.file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }

    // Build full path to Python file
    let candidate_path = workspace_root.join(&request.file_path);

    // Validate file exists and is a Python file
    if !candidate_path.exists() {
        return Err(format!("File not found: {}", request.file_path));
    }

    if !request.file_path.ends_with(".py") {
        return Err("Only Python files (.py) can be executed".to_string());
    }

    // Canonicalize to be sure the file stays within the workspace
    let file_path = candidate_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve file path: {}", e))?;

    if !file_path.starts_with(&workspace_root) {
        return Err("Access denied: path outside workspace".to_string());
    }

    // Prepare Python command
    let mut cmd = Command::new("python3");
    cmd.arg(file_path.to_str().unwrap())
        .current_dir(&workspace_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Add workspace to PYTHONPATH so Python can import modules
    cmd.env("PYTHONPATH", &workspace_root);

    // Add environment variables
    for (key, value) in &request.env_vars {
        cmd.env(key, value);
    }

    // Save candle data to temporary file if provided
    let temp_candle_file = if let Some(candle_data) = &request.candle_data {
        let temp_path =
            PathBuf::from("/tmp").join(format!("candles_{}.json", uuid::Uuid::new_v4()));

        info!("Writing candle data to: {:?}", temp_path);

        let json_string = serde_json::to_string(candle_data)
            .map_err(|e| format!("Failed to serialize candle data: {}", e))?;

        fs::write(&temp_path, json_string)
            .map_err(|e| format!("Failed to write candle data file: {}", e))?;

        cmd.env("CANDLE_DATA_FILE", temp_path.to_str().unwrap());

        Some(temp_path)
    } else {
        None
    };

    // Add dataset environment variable if provided
    if let Some(dataset) = &request.dataset {
        cmd.env("TEST_DATASET", dataset);
        cmd.env("DATA_SOURCE", "parquet");
    }

    info!(
        "Running command: python3 {} with {} env vars",
        request.file_path,
        request.env_vars.len()
    );

    // Execute the command
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;

    // Convert output to strings
    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    let stdout_lines: Vec<String> = stdout_str.lines().map(|s| s.to_string()).collect();

    let stderr_lines: Vec<String> = stderr_str.lines().map(|s| s.to_string()).collect();

    let success = output.status.success();
    let output_lines = stdout_lines.len();
    let error_lines = stderr_lines.len();

    if success {
        info!("Component executed successfully in {:.2}ms", execution_time);
    } else {
        error!(
            "Component execution failed with exit code: {:?}",
            output.status.code()
        );
    }

    // Clean up temporary candle data file
    if let Some(temp_file) = temp_candle_file {
        if let Err(e) = fs::remove_file(&temp_file) {
            error!("Failed to delete temp candle file {:?}: {}", temp_file, e);
        }
    }

    Ok(RunComponentResponse {
        success,
        execution_time_ms: execution_time,
        stdout: stdout_lines,
        stderr: stderr_lines,
        output_lines,
        error_lines,
    })
}
