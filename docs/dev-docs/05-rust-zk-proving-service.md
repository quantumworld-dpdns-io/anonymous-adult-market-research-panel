# 05 — Rust ZK Proving Service

## Purpose

Define the implementation of the Rust ZK Proving Service, which hosts the RISC Zero zkVM, verifies Noir/Barretenberg age proofs, issues anonymous credentials, manages the nullifier registry, and signs ZK session tokens.

---

## 1. Technology Stack

| Component | Crate | Version |
|---|---|---|
| HTTP server | `axum` | 0.7 |
| gRPC server | `tonic` | 0.12 |
| RISC Zero zkVM | `risc0-zkvm` | 1.x |
| Barretenberg bindings | `barretenberg-sys` | (FFI to C++ lib) |
| Redis client | `redis` | 0.25 |
| Async runtime | `tokio` | 1 |
| Serialization | `serde` + `serde_json` | 1 |
| Cryptography | `hmac` + `sha2` + `rand` | latest |
| Telemetry | `opentelemetry` + `tracing` | latest |
| Config | `config` crate | 0.14 |
| Error handling | `anyhow` + `thiserror` | latest |

---

## 2. Service Structure

```
services/zk-proving/
├── Cargo.toml
├── Cargo.lock
├── build.rs                      # RISC Zero image build
├── src/
│   ├── main.rs                   # Startup: Axum + Tonic servers
│   ├── config.rs
│   ├── state.rs                  # AppState: shared clients and verifiers
│   ├── error.rs                  # AppError enum
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── verify_age.rs         # POST /zk/verify-age
│   │   ├── issue_credential.rs   # POST /zk/issue-credential
│   │   └── date_attestation.rs   # GET /zk/date-attestation
│   ├── grpc/
│   │   └── service.rs            # Tonic gRPC service impl
│   ├── zk/
│   │   ├── age_verifier.rs       # Barretenberg proof verification
│   │   ├── credential_issuer.rs  # RISC Zero credential issuance
│   │   └── date_signer.rs        # ML-DSA date attestation signing
│   ├── nullifier/
│   │   └── registry.rs           # Redis bloom filter + Supabase writes
│   └── token/
│       └── issuer.rs             # ZK session token HMAC issuance
├── guest/                        # RISC Zero guest crate (separate build target)
│   ├── Cargo.toml
│   └── src/
│       └── main.rs               # Guest: credential issuance logic
└── circuits/
    ├── age_proof.acir            # Compiled Noir ACIR
    └── age_proof.vk              # Barretenberg verification key
```

---

## 3. Application State

```rust
// src/state.rs
use std::sync::Arc;
use redis::aio::MultiplexedConnection;

#[derive(Clone)]
pub struct AppState {
    pub age_verifier: Arc<AgeVerifier>,
    pub credential_issuer: Arc<CredentialIssuer>,
    pub date_signer: Arc<DateSigner>,
    pub nullifier_registry: Arc<NullifierRegistry>,
    pub token_issuer: Arc<TokenIssuer>,
    pub config: Arc<Config>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let redis_conn = redis::Client::open(config.redis_url.as_str())?
            .get_multiplexed_tokio_connection().await?;

        Ok(Self {
            age_verifier: Arc::new(AgeVerifier::new()?),
            credential_issuer: Arc::new(CredentialIssuer::new(&config)?),
            date_signer: Arc::new(DateSigner::new(&config.ml_dsa_signing_key)?),
            nullifier_registry: Arc::new(NullifierRegistry::new(
                redis_conn,
                config.supabase_url.clone(),
                config.supabase_service_key.clone(),
            )),
            token_issuer: Arc::new(TokenIssuer::new(config.zk_token_secret.as_bytes())),
            config: Arc::new(config),
        })
    }
}
```

---

## 4. Barretenberg Age Proof Verifier

```rust
// src/zk/age_verifier.rs
use std::ffi::{c_char, CString};

// FFI bindings to barretenberg C++ library
// In practice, use the `barretenberg-sys` crate or equivalent
extern "C" {
    fn bb_verify_proof(
        vk: *const u8, vk_len: usize,
        proof: *const u8, proof_len: usize,
        public_inputs: *const c_char,
    ) -> bool;
}

pub struct AgeVerifier {
    vk_bytes: &'static [u8],
}

impl AgeVerifier {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            // Embedded at compile time — prevents runtime substitution
            vk_bytes: include_bytes!("../../circuits/age_proof.vk"),
        })
    }

    pub fn verify(
        &self,
        proof_bytes: &[u8],
        public_inputs: &[String],
    ) -> anyhow::Result<bool> {
        // Serialize public inputs as JSON for FFI boundary
        let inputs_json = CString::new(serde_json::to_string(public_inputs)?)?;

        let result = unsafe {
            bb_verify_proof(
                self.vk_bytes.as_ptr(),
                self.vk_bytes.len(),
                proof_bytes.as_ptr(),
                proof_bytes.len(),
                inputs_json.as_ptr(),
            )
        };

        Ok(result)
    }
}
```

---

## 5. Date Attestation Signer (ML-DSA-65)

```rust
// src/zk/date_signer.rs
// ML-DSA-65 signing via liboqs Rust bindings (oqs crate)
use oqs::sig::{Algorithm, Sig};
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct DateAttestation {
    pub current_date: CurrentDate,
    pub signed_at: i64,
    pub study_id: String,
    pub signature: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CurrentDate {
    pub year: u32,
    pub month: u32,
    pub day: u32,
}

pub struct DateSigner {
    sig: Sig,
    secret_key: oqs::sig::SecretKey,
    pub public_key: oqs::sig::PublicKey,
}

impl DateSigner {
    pub fn new(secret_key_bytes: &[u8]) -> anyhow::Result<Self> {
        let sig = Sig::new(Algorithm::MlDsa65)?;
        let secret_key = sig.secret_key_from_bytes(secret_key_bytes)
            .ok_or_else(|| anyhow::anyhow!("invalid ML-DSA key"))?;
        let public_key = sig.public_key_from_bytes(
            &secret_key_bytes[..sig.length_public_key()]
        ).ok_or_else(|| anyhow::anyhow!("failed to derive public key"))?;

        Ok(Self { sig, secret_key, public_key })
    }

    pub fn sign_attestation(&self, study_id: &str) -> anyhow::Result<DateAttestation> {
        let now = Utc::now();
        let date = CurrentDate {
            year: now.year() as u32,
            month: now.month(),
            day: now.day(),
        };

        // Sign: ML-DSA over (year || month || day || study_id || signed_at)
        let message = format!(
            "{:04}{:02}{:02}{}{}",
            date.year, date.month, date.day,
            study_id,
            now.timestamp(),
        );

        let signature = self.sig
            .sign(message.as_bytes(), &self.secret_key)?
            .to_vec();

        Ok(DateAttestation {
            current_date: date,
            signed_at: now.timestamp(),
            study_id: study_id.to_string(),
            signature,
        })
    }
}
```

---

## 6. RISC Zero Credential Issuer

```rust
// src/zk/credential_issuer.rs
use risc0_zkvm::{default_prover, ExecutorEnv, Receipt};
use crate::config::Config;

// Built by build.rs using risc0-build
include!(concat!(env!("OUT_DIR"), "/methods.rs"));

pub struct CredentialIssuer;

impl CredentialIssuer {
    pub fn new(_config: &Config) -> anyhow::Result<Self> {
        Ok(Self)
    }

    pub async fn issue(
        &self,
        request: CredentialRequest,
    ) -> anyhow::Result<(CredentialJournal, Receipt)> {
        // Spawn blocking because zkVM proving is CPU-intensive
        tokio::task::spawn_blocking(move || {
            let env = ExecutorEnv::builder()
                .write(&request)?
                .build()?;

            let prover = default_prover();
            let receipt = prover.prove(env, CREDENTIAL_GUEST_ELF)?;

            // Verify against pinned Image ID (catches dev mode / substitution)
            receipt.verify(CREDENTIAL_GUEST_ID)?;

            let journal: CredentialJournal = receipt.journal.decode()?;
            Ok::<_, anyhow::Error>((journal, receipt))
        })
        .await?
    }
}
```

---

## 7. Nullifier Registry

```rust
// src/nullifier/registry.rs
use redis::AsyncCommands;
use sha2::{Sha256, Digest};

pub struct NullifierRegistry {
    redis: redis::aio::MultiplexedConnection,
    supabase: SupabaseClient,
}

impl NullifierRegistry {
    /// Returns true if nullifier has been seen before (bloom filter fast path).
    pub async fn is_seen(&self, nullifier: &str) -> anyhow::Result<bool> {
        let mut conn = self.redis.clone();
        let exists: bool = redis::cmd("BF.EXISTS")
            .arg("nullifiers:bloom")
            .arg(nullifier)
            .query_async(&mut conn)
            .await?;
        Ok(exists)
    }

    /// Registers a nullifier permanently. Idempotent on retry.
    pub async fn register(
        &self,
        nullifier: &str,
        study_id: &str,
    ) -> anyhow::Result<()> {
        let nullifier_hash = hex::encode(Sha256::digest(nullifier.as_bytes()));

        // 1. Redis bloom filter (fast path for future checks)
        let mut conn = self.redis.clone();
        redis::cmd("BF.ADD")
            .arg("nullifiers:bloom")
            .arg(nullifier)
            .query_async::<_, bool>(&mut conn)
            .await?;

        // 2. Supabase canonical record (UNIQUE constraint enforces correctness)
        self.supabase
            .from("nullifiers")
            .insert(serde_json::json!({
                "nullifier_hash": nullifier_hash,
                "study_id": study_id,
                "registered_at": chrono::Utc::now().to_rfc3339(),
            }))
            .execute()
            .await
            .map_err(|e| anyhow::anyhow!("Supabase insert failed: {}", e))?;

        Ok(())
    }
}
```

---

## 8. ZK Session Token Issuer

```rust
// src/token/issuer.rs
use hmac::{Hmac, Mac};
use sha2::Sha256;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Serialize, Deserialize)]
struct TokenPayload {
    sub: String,             // nullifier_hash (no real identity)
    study_id: String,
    commitment: Option<String>,
    iat: i64,
    exp: i64,
    jti: String,
    v: u8,
}

pub struct TokenIssuer {
    secret: Vec<u8>,
}

impl TokenIssuer {
    pub fn new(secret: &[u8]) -> Self {
        Self { secret: secret.to_vec() }
    }

    pub fn issue(
        &self,
        nullifier: &str,
        study_id: &str,
    ) -> anyhow::Result<String> {
        self.issue_with_commitment(nullifier, study_id, None)
    }

    pub fn issue_with_commitment(
        &self,
        nullifier: &str,
        study_id: &str,
        commitment: Option<&str>,
    ) -> anyhow::Result<String> {
        let now = chrono::Utc::now().timestamp();
        let payload = TokenPayload {
            sub: hex::encode(sha2::Sha256::digest(nullifier.as_bytes())),
            study_id: study_id.to_string(),
            commitment: commitment.map(str::to_string),
            iat: now,
            exp: now + 3600, // 1 hour
            jti: Uuid::new_v4().to_string(),
            v: 1,
        };

        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"ZKT"}"#);
        let body = URL_SAFE_NO_PAD.encode(serde_json::to_string(&payload)?);
        let signing_input = format!("{}.{}", header, body);

        let mut mac = HmacSha256::new_from_slice(&self.secret)?;
        mac.update(signing_input.as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

        Ok(format!("{}.{}.{}", header, body, sig))
    }
}
```

---

## 9. Axum Router Setup

```rust
// src/main.rs (abbreviated)
use axum::{routing::{get, post}, Router};

async fn build_router(state: AppState) -> Router {
    Router::new()
        // ZK routes
        .route("/zk/verify-age",        post(handlers::verify_age::handler))
        .route("/zk/issue-credential",  post(handlers::issue_credential::handler))
        .route("/zk/date-attestation",  get(handlers::date_attestation::handler))
        // Health
        .route("/health",               get(|| async { "ok" }))
        // Attach shared state and middleware
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(tower_http::timeout::TimeoutLayer::new(
            std::time::Duration::from_secs(30)
        ))
}
```

---

## 10. `build.rs` for RISC Zero Guest

```rust
// build.rs
fn main() {
    // Compile the guest ELF and embed Image ID
    risc0_build::embed_methods_with_options(
        [risc0_build::GuestOptions::default()
            .with_features(["credential-guest"])],
        risc0_build::DockerOptions::default(),
    );
}
```

---

## 11. Testing Plan

| Test | Type | Target |
|---|---|---|
| Barretenberg verify valid proof | Integration | Returns true for valid age proof |
| Barretenberg reject invalid proof | Integration | Returns false; no panic |
| RISC Zero credential issuance | Integration | Receipt verified; journal decoded |
| Nullifier bloom filter | Unit | BF.ADD / BF.EXISTS round-trip |
| Nullifier Supabase write | Integration | UNIQUE constraint prevents duplicate |
| Token issue + verify | Unit | Signature valid; expiry respected |
| Date attestation sign | Unit | ML-DSA signature verifiable |
| Proof verification latency | Benchmark | < 500 ms p99 |
| zkVM proving latency | Benchmark | < 5 s local; < 30 s remote |

---

## 12. Security Checklist

- [ ] `include_bytes!` for VK and ACIR — no runtime file loading
- [ ] RISC Zero dev mode disabled via `RISC0_DEV_MODE=0` environment check on startup
- [ ] Barretenberg FFI: proof bytes validated for length before FFI call (prevent buffer issues)
- [ ] Token secret never logged; rotated via secrets manager
- [ ] Nullifier is SHA-256 hashed before Supabase storage (raw nullifier not persisted)
- [ ] All Tokio tasks have explicit timeouts; long-running zkVM tasks limited to 60s
- [ ] ML-DSA key material stored in secrets manager (not in config files)
- [ ] gRPC TLS uses mTLS; client cert rotated monthly
- [ ] Axum error handler returns generic 500 messages; internal error details in structured logs only
