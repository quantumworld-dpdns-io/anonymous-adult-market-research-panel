use spin_sdk::http::{IntoResponse, Request, Response};
use spin_sdk::http_component;

/// Minimal health check handler.
/// Returns 200 OK with JSON body for load balancer probes.
/// No external I/O, no state — intentionally stateless.
#[http_component]
fn handle_health(_req: Request) -> anyhow::Result<impl IntoResponse> {
    Ok(Response::builder()
        .status(200)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-store")
        .body(r#"{"status":"ok","service":"panel-edge"}"#)
        .build())
}
