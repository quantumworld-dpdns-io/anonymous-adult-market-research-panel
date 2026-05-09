use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use crate::config::Config;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyAttrs {
    pub age_range: String,
    pub country_bucket: String,
    pub interests: Vec<String>,
}

impl StudyAttrs {
    pub fn matches_criteria(&self) -> bool {
        !self.age_range.is_empty() && !self.country_bucket.is_empty()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialRequest {
    pub nullifier: String,
    pub study_id: String,
    pub age_proof_valid: bool,
    pub study_attributes: StudyAttrs,
    pub blinding_factor: [u8; 32],
    /// Unix-second timestamp supplied by the host and committed to the credential journal.
    pub issued_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialJournal {
    pub credential_commitment: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub study_id: String,
    pub issued_at: i64,
    pub attributes_hash: [u8; 32],
}

/// Opaque receipt handle. In production this wraps a real risc0 Receipt;
/// in dev mode it is a SHA-256 commitment over the journal fields.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialReceipt {
    pub journal: CredentialJournal,
    /// Hex-encoded receipt seal (real groth16/stark seal in production, dev hash otherwise).
    pub seal_hex: String,
}

pub struct CredentialIssuer;

impl CredentialIssuer {
    pub fn new(_config: &Config) -> anyhow::Result<Self> {
        Ok(Self)
    }

    /// Issue a verifiable credential.
    ///
    /// In production (RISC0_DEV_MODE != "1") this must be wired to the rzup prover
    /// via the "prove" feature and the compiled guest ELF. For local dev set
    /// `RISC0_DEV_MODE=1` — the receipt seal is a non-ZK SHA-256 commitment.
    pub async fn issue(
        &self,
        request: CredentialRequest,
    ) -> Result<CredentialReceipt, AppError> {
        let dev_mode = std::env::var("RISC0_DEV_MODE")
            .unwrap_or_default()
            .trim()
            .eq("1");

        if !dev_mode {
            return Err(AppError::Internal(anyhow::anyhow!(
                "RISC Zero proving requires rzup + full Xcode (Metal). \
                 Set RISC0_DEV_MODE=1 for local development."
            )));
        }

        tokio::task::spawn_blocking(move || {
            let nullifier_hash: [u8; 32] = Sha256::digest(request.nullifier.as_bytes()).into();
            let attrs_bytes = serde_json::to_vec(&request.study_attributes)
                .map_err(|e| anyhow::anyhow!("attrs serialize: {}", e))?;
            let attributes_hash: [u8; 32] = Sha256::digest(&attrs_bytes).into();

            // commitment = SHA-256(nullifier_hash || blinding_factor || study_id || issued_at)
            let mut commitment_input = Vec::with_capacity(32 + 32 + request.study_id.len() + 8);
            commitment_input.extend_from_slice(&nullifier_hash);
            commitment_input.extend_from_slice(&request.blinding_factor);
            commitment_input.extend_from_slice(request.study_id.as_bytes());
            commitment_input.extend_from_slice(&request.issued_at.to_le_bytes());
            let credential_commitment: [u8; 32] = Sha256::digest(&commitment_input).into();

            let journal = CredentialJournal {
                credential_commitment,
                nullifier_hash,
                study_id: request.study_id.clone(),
                issued_at: request.issued_at,
                attributes_hash,
            };

            // Dev-mode seal: SHA-256 over the journal fields (not a real ZK proof).
            let journal_bytes = serde_json::to_vec(&journal)
                .map_err(|e| anyhow::anyhow!("journal serialize: {}", e))?;
            let seal: [u8; 32] = Sha256::digest(&journal_bytes).into();
            let seal_hex = hex::encode(seal);

            Ok::<_, anyhow::Error>(CredentialReceipt { journal, seal_hex })
        })
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("spawn_blocking: {}", e)))?
        .map_err(|e| AppError::Internal(e))
    }
}
