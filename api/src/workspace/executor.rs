use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::path::PathBuf;
use tracing::{info, error};

#[derive(Debug, Deserialize)]
pub struct RunComponentRequest {
    pub file_path: String,
    pub dataset: Option<String>,
    pub env_vars: HashMap<String, String>,
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
    workspace_path: &str,
    request: RunComponentRequest,
) -> Result<RunComponentResponse, String> {
    let start_time = std::time::Instant::now();

    info!("Executing component: {}", request.file_path);

    // Build full path to Python file
    let file_path = PathBuf::from(workspace_path).join(&request.file_path);

    // Validate file exists and is a Python file
    if !file_path.exists() {
        return Err(format!("File not found: {}", request.file_path));
    }

    if !request.file_path.ends_with(".py") {
        return Err("Only Python files (.py) can be executed".to_string());
    }

    // Prepare Python command
    let mut cmd = Command::new("python3");
    cmd.arg(file_path.to_str().unwrap())
        .current_dir(workspace_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Add environment variables
    for (key, value) in &request.env_vars {
        cmd.env(key, value);
    }

    // Add dataset environment variable if provided
    if let Some(dataset) = &request.dataset {
        cmd.env("TEST_DATASET", dataset);
        cmd.env("DATA_SOURCE", "parquet");
    }

    info!("Running command: python3 {} with {} env vars",
          request.file_path, request.env_vars.len());

    // Execute the command
    let output = cmd.output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;

    // Convert output to strings
    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    let stdout_lines: Vec<String> = stdout_str
        .lines()
        .map(|s| s.to_string())
        .collect();

    let stderr_lines: Vec<String> = stderr_str
        .lines()
        .map(|s| s.to_string())
        .collect();

    let success = output.status.success();
    let output_lines = stdout_lines.len();
    let error_lines = stderr_lines.len();

    if success {
        info!("Component executed successfully in {:.2}ms", execution_time);
    } else {
        error!("Component execution failed with exit code: {:?}", output.status.code());
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
