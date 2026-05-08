use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use crate::{error::AppError, state::AppState, zk::DateAttestation};

#[derive(Debug, Deserialize)]
pub struct DateAttestationParams {
    pub study_id: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(params): Query<DateAttestationParams>,
) -> Result<Json<DateAttestation>, AppError> {
    let study_id = params.study_id.as_deref().unwrap_or("global");

    let attestation = state
        .date_signer
        .sign_attestation(study_id)
        .map_err(AppError::Internal)?;

    Ok(Json(attestation))
}
