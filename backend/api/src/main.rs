use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::{HeaderValue, Method},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// Core business logic modules
// Note: Market data (live AND historical) is handled by ws-market-data-server
mod auth; // Authentication (GitHub OAuth, JWT)
mod database; // Database utilities (optional - can use filesystem)
mod orchestrator; // Backtesting engine (fetches data from ws-market-data-server)
mod workspace; // Workspace management
mod github; // GitHub content operations (Build Center)

// Optional - only if needed for backtesting simulation
mod execution; // Order execution simulation
mod orders; // Order management

// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    db: Option<sqlx::PgPool>,
    redis: Option<redis::Client>,
    backtests: orchestrator::BacktestRegistry,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

// Health check endpoint
async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing/logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sptraderb_api=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting SPtraderB API server...");

    // Optional database connection
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost/sptraderb".to_string());

    info!(
        "Attempting database connection: {}",
        database_url.split('@').last().unwrap_or("localhost")
    );

    let pool = match PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
    {
        Ok(pool) => {
            info!("Database connected successfully");
            Some(pool)
        }
        Err(e) => {
            error!(
                "Failed to connect to database: {}. Continuing without database...",
                e
            );
            None
        }
    };

    // Optional Redis connection
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());

    let redis_client = match redis::Client::open(redis_url) {
        Ok(client) => {
            info!("Redis client initialized");
            Some(client)
        }
        Err(e) => {
            error!(
                "Failed to initialize Redis: {}. Continuing without Redis...",
                e
            );
            None
        }
    };

    let backtests: orchestrator::BacktestRegistry =
        Arc::new(tokio::sync::RwLock::new(HashMap::new()));

    // Create application state
    let state = AppState {
        db: pool,
        redis: redis_client,
        backtests,
    };

    // Configure CORS (lock to configured origins)
    let allowed_origins = std::env::var("ALLOWED_ORIGINS")
        .ok()
        .unwrap_or_else(|| {
            std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://sptraderb.vercel.app".to_string())
        });

    let origin_values: Vec<HeaderValue> = allowed_origins
        .split(',')
        .filter_map(|origin| {
            let trimmed = origin.trim();
            if trimmed.is_empty() {
                None
            } else {
                HeaderValue::from_str(trimmed).ok()
            }
        })
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origin_values)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers(Any);

    // Build router
    // Note: Real-time market data and broker connections are handled by
    // the separate WebSocket Market Data Server (ws-market-data-server.fly.dev)
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        // Backtest routes (core feature)
        .route(
            "/api/backtest/run",
            post(orchestrator::handlers::run_backtest),
        )
        .route(
            "/api/backtest/:id/status",
            get(orchestrator::handlers::get_backtest_status),
        )
        .route(
            "/api/backtest/:id/results",
            get(orchestrator::handlers::get_backtest_results),
        )
        .route(
            "/api/backtest/:id/cancel",
            post(orchestrator::handlers::cancel_backtest),
        )
        // WebSocket for backtest progress updates
        .route(
            "/ws/backtest/:id",
            get(orchestrator::handlers::backtest_websocket),
        )
        // Workspace management (save/load projects)
        .route("/api/workspace", get(workspace::handlers::list_workspaces))
        .route("/api/workspace", post(workspace::handlers::save_workspace))
        .route(
            "/api/workspace/:id",
            get(workspace::handlers::get_workspace),
        )
        .route(
            "/api/workspace/:id",
            delete(workspace::handlers::delete_workspace),
        )
        // Workspace file management (NEW)
        .route(
            "/api/workspace/tree",
            get(workspace::handlers::get_workspace_tree),
        )
        .route(
            "/api/workspace/files",
            post(workspace::handlers::create_file),
        )
        .route(
            "/api/workspace/files/*path",
            get(workspace::handlers::read_file),
        )
        .route(
            "/api/workspace/files/*path",
            put(workspace::handlers::save_file),
        )
        .route(
            "/api/workspace/files/*path",
            delete(workspace::handlers::delete_file),
        )
        .route(
            "/api/workspace/rename",
            post(workspace::handlers::rename_file),
        )
        .route(
            "/api/workspace/components",
            get(workspace::handlers::get_components),
        )
        .route(
            "/api/workspace/categories/:type",
            get(workspace::handlers::get_categories),
        )
        .route(
            "/api/workspace/run-component",
            post(workspace::handlers::run_component),
        )
        // Note: Candle queries are handled by ws-market-data-server
        // Backtesting fetches historical data via HTTP from ws-market-data-server
        // Strategy management (load/save YAML strategies)
        .route(
            "/api/strategies",
            get(orchestrator::handlers::list_strategies),
        )
        .route(
            "/api/strategies/:name",
            get(orchestrator::handlers::get_strategy),
        )
        .route(
            "/api/strategies/:name",
            post(orchestrator::handlers::save_strategy),
        )
        // Authentication routes
        .route("/api/auth/github", get(auth::handlers::github_login))
        .route("/api/auth/callback", post(auth::handlers::github_callback))
        .route("/api/auth/me", get(auth::handlers::get_current_user))
        .route(
            "/api/auth/preferences",
            put(auth::handlers::update_preferences),
        )
        .route("/api/auth/memory", put(auth::handlers::update_memory))
        .route("/api/auth/repos", get(auth::handlers::list_github_repos))
        // GitHub content routes
        .route("/api/github/app-repos", get(github::list_app_repos))
        .route("/api/github/app-repos/create", post(github::create_app_repo))
        .route("/api/github/file", get(github::get_github_file))
        .route("/api/github/file", put(github::save_github_file))
        .route("/api/github/tree", get(github::get_github_tree))
        .route("/api/github/bootstrap", post(github::bootstrap_structure))
        // Apply middleware
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let addr = format!("0.0.0.0:{}", port);
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
