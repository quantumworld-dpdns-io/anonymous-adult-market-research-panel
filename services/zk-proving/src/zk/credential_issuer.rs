use risc0_zkvm::{ExecutorEnv, Receipt};
use serde::{Deserialize, Serialize};
use crate::config::Config;
use crate::error::AppError;

// In production these constants come from risc0-build embedding the compiled guest ELF.
// In dev (RISC0_DEV_MODE=1) the mock prover does not validate the ELF, so stubs are fine.
// To do a real production build: add risc0-build to build-dependencies and run rzup.
const CREDENTIAL_GUEST_ELF: &[u8] = &[];
const CREDENTIAL_GUEST_ID: [u32; 8] = [0u32; 8];

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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialJournal {
    pub credential_commitment: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub study_id: String,
    pub issued_at: i64,
    pub attributes_hash: [u8; 32],
}

pub struct CredentialIssuer;

impl CredentialIssuer {
    pub fn new(_config: &Config) -> anyhow::Result<Self> {
        Ok(Self)
    }

    pub async fn issue(
        &self,
        request: CredentialRequest,
    ) -> Result<(CredentialJournal, Receipt), AppError> {
        // RISC0_DEV_MODE=1 enables a mock prover that skips real zkVM execution.
        // In production: set RISC0_DEV_MODE=0, install rzup, and supply the real ELF
        // via risc0-build so CREDENTIAL_GUEST_ELF/CREDENTIAL_GUEST_ID are populated.
        let dev_mode = std::env::var("RISC0_DEV_MODE").unwrap_or_default() == "1";
        if !dev_mode && CREDENTIAL_GUEST_ELF.is_empty() {
            return Err(AppError::Internal(anyhow::anyhow!(
                "RISC Zero guest ELF not embedded. Set RISC0_DEV_MODE=1 for local dev, \
                 or build with risc0-build for production."
            )));
        }

        tokio::task::spawn_blocking(move || {
            let env = ExecutorEnv::builder()
                .write(&request)
                .map_err(|e| anyhow::anyhow!("env write: {}", e))?
                .build()
                .map_err(|e| anyhow::anyhow!("env build: {}", e))?;

            let prover = risc0_zkvm::default_prover();
            let receipt = prover
                .prove(env, CREDENTIAL_GUEST_ELF)
                .map_err(|e| anyhow::anyhow!("prove: {}", e))?
                .receipt;

            if !dev_mode {
                receipt
                    .verify(CREDENTIAL_GUEST_ID)
                    .map_err(|e| anyhow::anyhow!("verify: {}", e))?;
            }

            let journal: CredentialJournal = receipt
                .journal
                .decode()
                .map_err(|e| anyhow::anyhow!("decode journal: {}", e))?;

            Ok::<_, anyhow::Error>((journal, receipt))
        })
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("spawn_blocking: {}", e)))?
        .map_err(|e| AppError::Internal(e))
    }
}
