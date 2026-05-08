// Tonic gRPC service implementation.
// Generated stub — implement by including the proto-generated code via tonic::include_proto!.

tonic::include_proto!("zkproving.v1");

use tonic::{Request, Response, Status};
use zk_proving_service_server::ZkProvingService;
use crate::state::AppState;

pub struct ZKProvingGrpcService {
    pub state: AppState,
}

#[tonic::async_trait]
impl ZkProvingService for ZKProvingGrpcService {
    async fn verify_age(
        &self,
        request: Request<VerifyAgeRequest>,
    ) -> Result<Response<VerifyAgeResponse>, Status> {
        let req = request.into_inner();

        // Delegate to the Axum handler logic (shared via AppState)
        // In production wire up via the handler functions directly.
        let attestation: crate::zk::DateAttestation = serde_json::from_slice(
            &req.date_attestation_json,
        )
        .map_err(|e| Status::invalid_argument(format!("bad attestation: {}", e)))?;

        let age_req = crate::handlers::verify_age::VerifyAgeRequest {
            proof: req.proof,
            public_inputs: req.public_inputs,
            nullifier: req.nullifier,
            study_id: req.study_id,
            date_attestation: attestation,
        };

        // Verify attestation
        let ok = self
            .state
            .date_signer
            .verify_attestation(&age_req.date_attestation)
            .map_err(|e| Status::internal(e.to_string()))?;
        if !ok {
            return Err(Status::unauthenticated("invalid date attestation"));
        }

        // Check nullifier
        if self.state.nullifier_registry.is_seen(&age_req.nullifier).await
            .map_err(|e| Status::internal(format!("{:?}", e)))?
        {
            return Err(Status::already_exists("nullifier already used"));
        }

        // Verify proof
        let valid = self
            .state
            .age_verifier
            .verify(&age_req.proof, &age_req.public_inputs)
            .map_err(|e| Status::invalid_argument(format!("{:?}", e)))?;
        if !valid {
            return Err(Status::unauthenticated("invalid proof"));
        }

        // Register + issue token
        self.state
            .nullifier_registry
            .register(&age_req.nullifier, &age_req.study_id)
            .await
            .map_err(|e| Status::internal(format!("{:?}", e)))?;

        let token = self
            .state
            .token_issuer
            .issue(&age_req.nullifier, &age_req.study_id)
            .map_err(|e| Status::internal(format!("{:?}", e)))?;

        Ok(Response::new(VerifyAgeResponse {
            zk_session_token: token,
        }))
    }

    async fn get_date_attestation(
        &self,
        request: Request<DateAttestationRequest>,
    ) -> Result<Response<DateAttestationResponse>, Status> {
        let study_id = request.into_inner().study_id;
        let att = self
            .state
            .date_signer
            .sign_attestation(&study_id)
            .map_err(|e| Status::internal(e.to_string()))?;

        let json = serde_json::to_vec(&att)
            .map_err(|e| Status::internal(e.to_string()))?;

        Ok(Response::new(DateAttestationResponse {
            attestation_json: json,
        }))
    }
}
