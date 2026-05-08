use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;
use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
struct TokenPayload {
    /// SHA-256(nullifier) hex — no real identity
    sub: String,
    study_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commitment: Option<String>,
    iat: i64,
    exp: i64,
    /// Random per-token ID; prevents sharing (verified via Redis one-time set if needed)
    jti: String,
    v: u8,
}

pub struct TokenIssuer {
    secret: Vec<u8>,
}

impl TokenIssuer {
    pub fn new(secret: &[u8]) -> Self {
        Self {
            secret: secret.to_vec(),
        }
    }

    /// Issue a 1-hour ZK session token bound to a study.
    pub fn issue(&self, nullifier: &str, study_id: &str) -> Result<String, AppError> {
        self.issue_inner(nullifier, study_id, None)
    }

    /// Issue a token also binding a credential commitment (for credential issuance flow).
    pub fn issue_with_commitment(
        &self,
        nullifier: &str,
        study_id: &str,
        commitment: &str,
    ) -> Result<String, AppError> {
        self.issue_inner(nullifier, study_id, Some(commitment))
    }

    fn issue_inner(
        &self,
        nullifier: &str,
        study_id: &str,
        commitment: Option<&str>,
    ) -> Result<String, AppError> {
        let now = chrono::Utc::now().timestamp();
        let sub = hex::encode(sha2::Sha256::digest(nullifier.as_bytes()));

        let payload = TokenPayload {
            sub,
            study_id: study_id.to_string(),
            commitment: commitment.map(str::to_string),
            iat: now,
            exp: now + 3600,
            jti: Uuid::new_v4().to_string(),
            v: 1,
        };

        let header_json = r#"{"alg":"HS256","typ":"ZKT"}"#;
        let header = URL_SAFE_NO_PAD.encode(header_json);
        let body = URL_SAFE_NO_PAD.encode(
            serde_json::to_string(&payload)
                .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
        );
        let signing_input = format!("{}.{}", header, body);

        let mut mac = HmacSha256::new_from_slice(&self.secret)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("HMAC init: {}", e)))?;
        mac.update(signing_input.as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

        Ok(format!("{}.{}.{}", header, body, sig))
    }
}
