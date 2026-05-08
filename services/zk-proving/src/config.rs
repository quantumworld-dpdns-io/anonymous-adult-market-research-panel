use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Address for the Axum HTTP server, e.g. "0.0.0.0:8080"
    pub listen_addr: String,

    /// Address for the Tonic gRPC server, e.g. "0.0.0.0:50051"
    pub grpc_addr: String,

    /// Redis connection URL, e.g. "redis://:password@redis:6379"
    pub redis_url: String,

    /// Supabase project URL
    pub supabase_url: String,

    /// Supabase service-role key (never exposed to clients)
    pub supabase_service_key: String,

    /// HMAC-SHA256 secret for ZK session tokens (hex-encoded 32 bytes)
    pub zk_token_secret: String,

    /// ML-DSA-65 signing key bytes (hex-encoded)
    pub ml_dsa_signing_key: Vec<u8>,

    /// OpenTelemetry OTLP endpoint, e.g. "http://otel-collector:4317"
    pub otel_endpoint: Option<String>,

    /// Disable RISC Zero dev mode in production. Must be "0" at runtime.
    #[serde(default = "default_risc0_dev_mode")]
    pub risc0_dev_mode: String,

    /// gRPC TLS cert file path
    pub grpc_tls_cert: Option<String>,

    /// gRPC TLS key file path
    pub grpc_tls_key: Option<String>,
}

fn default_risc0_dev_mode() -> String {
    "0".to_string()
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let cfg = config::Config::builder()
            .add_source(config::Environment::default().separator("__"))
            .set_default("listen_addr", "0.0.0.0:8080")?
            .set_default("grpc_addr", "0.0.0.0:50051")?
            .set_default("redis_url", "redis://localhost:6379")?
            .build()?;

        let parsed: Config = cfg.try_deserialize()?;

        // Enforce RISC0_DEV_MODE=0 in production
        if std::env::var("RISC0_DEV_MODE").unwrap_or_default() == "1" {
            if std::env::var("APP_ENV").unwrap_or_default() == "production" {
                anyhow::bail!("RISC0_DEV_MODE must not be enabled in production");
            }
        }

        Ok(parsed)
    }
}
