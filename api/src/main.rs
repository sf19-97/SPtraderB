use axum::{
    extract::{State, Path, Query, WebSocketUpgrade},
    http::{StatusCode, Method},
    response::{IntoResponse, Response},
    routing::{get, post, delete, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// Core business logic modules
// Note: Market data (live AND historical) is handled by ws-market-data-server
mod database;     // Database utilities (optional - can use filesystem)
mod orchestrator; // Backtesting engine (fetches data from ws-market-data-server)
mod workspace;    // Workspace management

// Optional - only if needed for backtesting simulation
mod execution;    // Order execution simulation
mod orders;       // Order management

// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    db: sqlx::PgPool,
    redis: redis::Client,
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

    // Database connection
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost/sptraderb".to_string());

    info!("Connecting to database: {}", database_url.split('@').last().unwrap_or("localhost"));

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    info!("Database connected successfully");

    // Redis connection
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://localhost:6379".to_string());

    let redis_client = redis::Client::open(redis_url)?;

    info!("Redis client initialized");

    // Create application state
    let state = AppState {
        db: pool,
        redis: redis_client,
    };

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::PATCH])
        .allow_headers(Any);

    // Build router
    // Note: Real-time market data and broker connections are handled by
    // the separate WebSocket Market Data Server (ws-market-data-server.fly.dev)
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))

        // Backtest routes (core feature)
        .route("/api/backtest/run", post(orchestrator::handlers::run_backtest))
        .route("/api/backtest/:id/status", get(orchestrator::handlers::get_backtest_status))
        .route("/api/backtest/:id/results", get(orchestrator::handlers::get_backtest_results))
        .route("/api/backtest/:id/cancel", post(orchestrator::handlers::cancel_backtest))

        // WebSocket for backtest progress updates
        .route("/ws/backtest/:id", get(orchestrator::handlers::backtest_websocket))

        // Workspace management (save/load projects)
        .route("/api/workspace", get(workspace::handlers::list_workspaces))
        .route("/api/workspace", post(workspace::handlers::save_workspace))
        .route("/api/workspace/:id", get(workspace::handlers::get_workspace))
        .route("/api/workspace/:id", delete(workspace::handlers::delete_workspace))

        // Workspace file management (NEW)
        .route("/api/workspace/tree", get(workspace::handlers::get_workspace_tree))
        .route("/api/workspace/files", post(workspace::handlers::create_file))
        .route("/api/workspace/files/*path", get(workspace::handlers::read_file))
        .route("/api/workspace/files/*path", put(workspace::handlers::save_file))
        .route("/api/workspace/files/*path", delete(workspace::handlers::delete_file))
        .route("/api/workspace/rename", post(workspace::handlers::rename_file))
        .route("/api/workspace/components", get(workspace::handlers::get_components))
        .route("/api/workspace/categories/:type", get(workspace::handlers::get_categories))
        .route("/api/workspace/run-component", post(workspace::handlers::run_component))

        // Note: Candle queries are handled by ws-market-data-server
        // Backtesting fetches historical data via HTTP from ws-market-data-server

        // Strategy management (load/save YAML strategies)
        .route("/api/strategies", get(orchestrator::handlers::list_strategies))
        .route("/api/strategies/:name", get(orchestrator::handlers::get_strategy))
        .route("/api/strategies/:name", post(orchestrator::handlers::save_strategy))

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
