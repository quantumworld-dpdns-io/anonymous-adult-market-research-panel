use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use crate::error::AppError;

const BLOOM_KEY: &str = "nullifiers:bloom";

/// Supabase REST client (thin wrapper around reqwest).
#[derive(Clone)]
pub struct SupabaseClient {
    http: reqwest::Client,
    base_url: String,
    service_key: String,
}

impl SupabaseClient {
    pub fn new(url: String, key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: url,
            service_key: key,
        }
    }

    pub async fn insert_nullifier(
        &self,
        nullifier_hash: &str,
        study_id: &str,
    ) -> anyhow::Result<()> {
        let url = format!("{}/rest/v1/nullifiers", self.base_url);
        let body = serde_json::json!({
            "nullifier_hash": nullifier_hash,
            "study_id": study_id,
            "registered_at": chrono::Utc::now().to_rfc3339(),
        });

        let resp = self
            .http
            .post(&url)
            .header("apikey", &self.service_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            // 409 Conflict = UNIQUE violation = duplicate nullifier
            if status.as_u16() == 409 {
                return Err(anyhow::anyhow!("DUPLICATE_NULLIFIER"));
            }
            anyhow::bail!("Supabase insert failed {}: {}", status, text);
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct NullifierRegistry {
    redis: redis::aio::MultiplexedConnection,
    supabase: SupabaseClient,
}

impl NullifierRegistry {
    pub fn new(
        redis: redis::aio::MultiplexedConnection,
        supabase_url: String,
        supabase_key: String,
    ) -> Self {
        Self {
            redis,
            supabase: SupabaseClient::new(supabase_url, supabase_key),
        }
    }

    /// Fast-path bloom filter check. Returns true if nullifier was definitely seen.
    /// False means "probably not seen" (bloom filter can have false positives).
    pub async fn is_seen(&self, nullifier: &str) -> Result<bool, AppError> {
        let mut conn = self.redis.clone();
        let exists: bool = redis::cmd("BF.EXISTS")
            .arg(BLOOM_KEY)
            .arg(nullifier)
            .query_async(&mut conn)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Redis BF.EXISTS: {}", e)))?;
        Ok(exists)
    }

    /// Register nullifier in Redis bloom filter AND Supabase (canonical source of truth).
    /// The Supabase UNIQUE constraint is the authoritative double-spend check.
    pub async fn register(&self, nullifier: &str, study_id: &str) -> Result<(), AppError> {
        let nullifier_hash = hex::encode(Sha256::digest(nullifier.as_bytes()));

        // 1. Redis bloom filter (advisory; eventual consistency acceptable here)
        let mut conn = self.redis.clone();
        redis::cmd("BF.ADD")
            .arg(BLOOM_KEY)
            .arg(nullifier)
            .query_async::<_, bool>(&mut conn)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Redis BF.ADD: {}", e)))?;

        // 2. Supabase canonical write — UNIQUE(nullifier_hash, study_id) enforced by DB
        self.supabase
            .insert_nullifier(&nullifier_hash, study_id)
            .await
            .map_err(|e| {
                if e.to_string().contains("DUPLICATE_NULLIFIER") {
                    AppError::NullifierAlreadyUsed
                } else {
                    AppError::Internal(e)
                }
            })?;

        Ok(())
    }
}
