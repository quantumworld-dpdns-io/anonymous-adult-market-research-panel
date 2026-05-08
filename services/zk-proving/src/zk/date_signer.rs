use chrono::{Datelike, Utc};
use oqs::sig::{Algorithm, Sig};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentDate {
    pub year: u32,
    pub month: u32,
    pub day: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateAttestation {
    pub current_date: CurrentDate,
    pub signed_at: i64,
    pub study_id: String,
    /// ML-DSA-65 signature over "YYYYMMDD{study_id}{timestamp}"
    pub signature: Vec<u8>,
    /// Hex-encoded ML-DSA-65 public key for client verification
    pub public_key_hex: String,
}

pub struct DateSigner {
    sig: Sig,
    secret_key: oqs::sig::SecretKey,
    public_key_hex: String,
}

impl DateSigner {
    /// Construct from raw ML-DSA-65 key bytes (from secrets manager).
    pub fn new(secret_key_bytes: &[u8]) -> anyhow::Result<Self> {
        let sig = Sig::new(Algorithm::MlDsa65)
            .map_err(|e| anyhow::anyhow!("Failed to init ML-DSA-65: {:?}", e))?;

        let secret_key = sig
            .secret_key_from_bytes(secret_key_bytes)
            .ok_or_else(|| anyhow::anyhow!("Invalid ML-DSA-65 secret key bytes"))?;

        // Derive public key for embedding in attestations
        let pk_len = sig.length_public_key();
        let public_key_hex = hex::encode(&secret_key_bytes[..pk_len.min(secret_key_bytes.len())]);

        Ok(Self {
            sig,
            secret_key,
            public_key_hex,
        })
    }

    /// Sign today's date + study_id using ML-DSA-65.
    pub fn sign_attestation(&self, study_id: &str) -> anyhow::Result<DateAttestation> {
        let now = Utc::now();
        let date = CurrentDate {
            year: now.year() as u32,
            month: now.month(),
            day: now.day(),
        };
        let ts = now.timestamp();

        // Message: deterministic, includes all public inputs
        let message = format!(
            "{:04}{:02}{:02}{}{}",
            date.year, date.month, date.day, study_id, ts
        );

        let signature = self
            .sig
            .sign(message.as_bytes(), &self.secret_key)
            .map_err(|e| anyhow::anyhow!("ML-DSA sign failed: {:?}", e))?
            .to_vec();

        Ok(DateAttestation {
            current_date: date,
            signed_at: ts,
            study_id: study_id.to_string(),
            signature,
            public_key_hex: self.public_key_hex.clone(),
        })
    }

    /// Verify an attestation signature (used server-side before processing proofs).
    pub fn verify_attestation(&self, attestation: &DateAttestation) -> anyhow::Result<bool> {
        let message = format!(
            "{:04}{:02}{:02}{}{}",
            attestation.current_date.year,
            attestation.current_date.month,
            attestation.current_date.day,
            attestation.study_id,
            attestation.signed_at,
        );

        // Reject attestations older than 10 minutes
        let age = Utc::now().timestamp() - attestation.signed_at;
        if age > 600 || age < -60 {
            return Ok(false);
        }

        let pk_hex = hex::decode(&self.public_key_hex)?;
        let public_key = self
            .sig
            .public_key_from_bytes(&pk_hex)
            .ok_or_else(|| anyhow::anyhow!("Invalid public key bytes"))?;

        let sig_ref = self
            .sig
            .signature_from_bytes(&attestation.signature)
            .ok_or_else(|| anyhow::anyhow!("Invalid signature bytes"))?;

        Ok(self.sig.verify(message.as_bytes(), &sig_ref, &public_key).is_ok())
    }
}
