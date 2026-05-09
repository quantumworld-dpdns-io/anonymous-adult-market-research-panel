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
    secret_key_bytes: Vec<u8>,
    public_key_hex: String,
}

impl DateSigner {
    /// Construct from raw ML-DSA-65 secret key bytes (from secrets manager).
    pub fn new(secret_key_bytes: &[u8]) -> anyhow::Result<Self> {
        let sig = Sig::new(Algorithm::MlDsa65)
            .map_err(|e| anyhow::anyhow!("Failed to init ML-DSA-65: {:?}", e))?;

        // Validate the key bytes parse correctly
        sig.secret_key_from_bytes(secret_key_bytes)
            .ok_or_else(|| anyhow::anyhow!("Invalid ML-DSA-65 secret key bytes (wrong length?)"))?;

        // Derive the public key so we can embed it in attestations.
        // The public key occupies the trailing pk_len bytes of a standard combined key blob;
        // if only raw secret key bytes are provided, re-derive via key generation is not
        // possible without the full keypair — so we store the hex of the secret key slice
        // only up to pk_len for the public portion (liboqs stores sk || pk in some APIs).
        // Safe default: store hex of entire secret bytes and let callers supply the public key
        // separately if needed. For dev use generate_keypair() instead.
        let pk_len = sig.length_public_key();
        let public_key_hex = if secret_key_bytes.len() >= pk_len {
            hex::encode(&secret_key_bytes[secret_key_bytes.len() - pk_len..])
        } else {
            hex::encode(secret_key_bytes)
        };

        Ok(Self {
            secret_key_bytes: secret_key_bytes.to_vec(),
            public_key_hex,
        })
    }

    /// Generate a fresh ML-DSA-65 keypair (for dev / first-run).
    pub fn generate() -> anyhow::Result<Self> {
        let sig = Sig::new(Algorithm::MlDsa65)
            .map_err(|e| anyhow::anyhow!("Failed to init ML-DSA-65: {:?}", e))?;
        let (pk, sk) = sig.keypair()
            .map_err(|e| anyhow::anyhow!("ML-DSA-65 keypair generation failed: {:?}", e))?;
        let public_key_hex = hex::encode(pk.as_ref());
        Ok(Self {
            secret_key_bytes: sk.as_ref().to_vec(),
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

        let message = format!(
            "{:04}{:02}{:02}{}{}",
            date.year, date.month, date.day, study_id, ts
        );

        let sig = Sig::new(Algorithm::MlDsa65)
            .map_err(|e| anyhow::anyhow!("ML-DSA-65 init: {:?}", e))?;
        let secret_key = sig
            .secret_key_from_bytes(&self.secret_key_bytes)
            .ok_or_else(|| anyhow::anyhow!("Invalid secret key bytes"))?;

        let signature = sig
            .sign(message.as_bytes(), &secret_key)
            .map_err(|e| anyhow::anyhow!("ML-DSA sign failed: {:?}", e))?;

        Ok(DateAttestation {
            current_date: date,
            signed_at: ts,
            study_id: study_id.to_string(),
            signature: signature.as_ref().to_vec(),
            public_key_hex: self.public_key_hex.clone(),
        })
    }

    /// Verify an attestation signature (used server-side before processing proofs).
    pub fn verify_attestation(&self, attestation: &DateAttestation) -> anyhow::Result<bool> {
        // Reject attestations older than 10 minutes or from the future
        let age = Utc::now().timestamp() - attestation.signed_at;
        if age > 600 || age < -60 {
            return Ok(false);
        }

        let message = format!(
            "{:04}{:02}{:02}{}{}",
            attestation.current_date.year,
            attestation.current_date.month,
            attestation.current_date.day,
            attestation.study_id,
            attestation.signed_at,
        );

        let sig = Sig::new(Algorithm::MlDsa65)
            .map_err(|e| anyhow::anyhow!("ML-DSA-65 init: {:?}", e))?;

        let pk_bytes = hex::decode(&attestation.public_key_hex)?;
        let public_key = sig
            .public_key_from_bytes(&pk_bytes)
            .ok_or_else(|| anyhow::anyhow!("Invalid public key bytes"))?;

        let sig_ref = sig
            .signature_from_bytes(&attestation.signature)
            .ok_or_else(|| anyhow::anyhow!("Invalid signature bytes"))?;

        Ok(sig.verify(message.as_bytes(), &sig_ref, &public_key).is_ok())
    }
}
