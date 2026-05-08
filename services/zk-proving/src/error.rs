use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid or tampered ZK proof")]
    InvalidProof,

    #[error("nullifier has already been used for this study")]
    NullifierAlreadyUsed,

    #[error("date attestation signature is invalid or expired")]
    InvalidDateAttestation,

    #[error("study not found or not active")]
    StudyNotFound,

    #[error("participant attributes do not match study criteria")]
    EligibilityFailed,

    #[error("ZK session token issuance failed")]
    TokenIssuanceFailed,

    #[error("RISC Zero proving failed")]
    ProvingFailed,

    #[error("proof bytes are malformed or too large")]
    MalformedProof,

    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::InvalidProof => (
                StatusCode::BAD_REQUEST,
                "INVALID_PROOF",
                "Proof verification failed.",
            ),
            AppError::NullifierAlreadyUsed => (
                StatusCode::CONFLICT,
                "NULLIFIER_USED",
                "This proof has already been used.",
            ),
            AppError::InvalidDateAttestation => (
                StatusCode::BAD_REQUEST,
                "INVALID_ATTESTATION",
                "Date attestation is invalid or expired.",
            ),
            AppError::StudyNotFound => (
                StatusCode::NOT_FOUND,
                "STUDY_NOT_FOUND",
                "Study not found or not currently active.",
            ),
            AppError::EligibilityFailed => (
                StatusCode::FORBIDDEN,
                "ELIGIBILITY_FAILED",
                "You do not meet the criteria for this study.",
            ),
            AppError::TokenIssuanceFailed => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "TOKEN_ERROR",
                "An internal error occurred.",
            ),
            AppError::ProvingFailed => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "PROVING_ERROR",
                "An internal error occurred.",
            ),
            AppError::MalformedProof => (
                StatusCode::BAD_REQUEST,
                "MALFORMED_PROOF",
                "Proof data is malformed.",
            ),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "An internal error occurred.",
            ),
        };

        // Never expose internal error details to clients
        tracing::error!(error = %self, code = code, "Request failed");

        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}
