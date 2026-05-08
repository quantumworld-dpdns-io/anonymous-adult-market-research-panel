use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{error::AppError, state::AppState, zk::DateAttestation};

#[derive(Debug, Deserialize)]
pub struct VerifyAgeRequest {
    /// Raw proof bytes as array of u8 from Barretenberg
    pub proof: Vec<u8>,
    /// Public circuit inputs (current_date fields, study_id, nullifier)
    pub public_inputs: Vec<String>,
    /// Pedersen(birth_date || blinding_factor || study_id) — one-time value
    pub nullifier: String,
    pub study_id: String,
    /// Server-signed date attestation — prevents backdated current_date inputs
    pub date_attestation: DateAttestation,
}

#[derive(Debug, Serialize)]
pub struct VerifyAgeResponse {
    pub zk_session_token: String,
}

pub async fn handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyAgeRequest>,
) -> Result<Json<VerifyAgeResponse>, AppError> {
    // 1. Verify ML-DSA-65 date attestation signature + freshness (< 10 min)
    let attestation_ok = state
        .date_signer
        .verify_attestation(&req.date_attestation)
        .map_err(|e| AppError::Internal(e))?;
    if !attestation_ok {
        return Err(AppError::InvalidDateAttestation);
    }

    // 2. Bloom filter fast-path: reject definitely-seen nullifiers early
    if state.nullifier_registry.is_seen(&req.nullifier).await? {
        return Err(AppError::NullifierAlreadyUsed);
    }

    // 3. Verify Barretenberg SNARK proof against pinned VK
    let proof_valid = state
        .age_verifier
        .verify(&req.proof, &req.public_inputs)
        .map_err(|e| e)?;
    if !proof_valid {
        return Err(AppError::InvalidProof);
    }

    // 4. Register nullifier — Supabase UNIQUE constraint is the canonical check
    state
        .nullifier_registry
        .register(&req.nullifier, &req.study_id)
        .await?;

    // 5. Issue 1-hour ZK session token
    let token = state
        .token_issuer
        .issue(&req.nullifier, &req.study_id)
        .map_err(|e| e)?;

    tracing::info!(study_id = %req.study_id, "Age proof verified; ZK token issued");

    Ok(Json(VerifyAgeResponse {
        zk_session_token: token,
    }))
}
