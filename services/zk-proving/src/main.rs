mod config;
mod error;
mod grpc;
mod handlers;
mod nullifier;
mod state;
mod token;
mod zk;

use axum::{routing::{get, post}, Router};
use std::net::SocketAddr;
use tower_http::{
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Telemetry
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let cfg = config::Config::from_env()?;

    tracing::info!(listen = %cfg.listen_addr, grpc = %cfg.grpc_addr, "ZK Proving Service starting");

    let state = AppState::new(cfg.clone()).await?;

    // Build Axum HTTP router
    let http_router = build_http_router(state.clone());

    // Axum server
    let http_addr: SocketAddr = cfg.listen_addr.parse()?;
    let http_server = axum::serve(
        tokio::net::TcpListener::bind(http_addr).await?,
        http_router,
    );

    // Run HTTP server (gRPC server setup elided for brevity; wire via tonic::transport::Server)
    tracing::info!("HTTP server listening on {}", http_addr);
    http_server.await?;

    Ok(())
}

fn build_http_router(state: AppState) -> Router {
    Router::new()
        .route("/zk/verify-age",       post(handlers::verify_age::handler))
        .route("/zk/issue-credential", post(handlers::issue_credential::handler))
        .route("/zk/date-attestation", get(handlers::date_attestation::handler))
        .route("/health",              get(health))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::new(std::time::Duration::from_secs(30)))
}

async fn health() -> &'static str {
    "ok"
}
