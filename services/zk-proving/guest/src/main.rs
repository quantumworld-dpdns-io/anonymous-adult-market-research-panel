// RISC Zero guest program — runs inside the zkVM on RISC-V.
// This is the credential issuance logic that gets proven.
// No std I/O; all communication via risc0_zkvm::guest::env.

#![no_main]

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

risc0_zkvm::guest::entry!(main);

#[derive(Debug, Deserialize)]
struct StudyAttrs {
    age_range: String,
    country_bucket: String,
    interests: Vec<String>,
}

impl StudyAttrs {
    fn is_eligible(&self) -> bool {
        !self.age_range.is_empty() && !self.country_bucket.is_empty()
    }
}

#[derive(Debug, Deserialize)]
struct CredentialRequest {
    nullifier: String,
    study_id: String,
    /// Must be true — enforced here inside the zkVM proof.
    age_proof_valid: bool,
    study_attributes: StudyAttrs,
    blinding_factor: [u8; 32],
    /// Timestamp supplied by host (Unix seconds). Committed to journal.
    issued_at: i64,
}

#[derive(Debug, Serialize)]
struct CredentialJournal {
    credential_commitment: [u8; 32],
    nullifier_hash: [u8; 32],
    study_id: String,
    issued_at: i64,
    attributes_hash: [u8; 32],
}

pub fn main() {
    // 1. Read private inputs from host
    let req: CredentialRequest = env::read();

    // 2. Enforce preconditions (panicking inside guest invalidates the receipt)
    assert!(req.age_proof_valid, "age_proof_valid must be true");
    assert!(!req.nullifier.is_empty(), "nullifier must not be empty");
    assert!(!req.study_id.is_empty(), "study_id must not be empty");
    assert!(req.study_attributes.is_eligible(), "attributes do not meet study criteria");

    // 3. Compute credential commitment:
    //    SHA-256(nullifier || study_id || blinding_factor || "credential_v1")
    let commitment = {
        let mut h = Sha256::new();
        h.update(req.nullifier.as_bytes());
        h.update(req.study_id.as_bytes());
        h.update(&req.blinding_factor);
        h.update(b"credential_v1");
        let result = h.finalize();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&result);
        arr
    };

    // 4. Compute nullifier hash (public output — used for registry)
    let nullifier_hash = {
        let result = Sha256::digest(req.nullifier.as_bytes());
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&result);
        arr
    };

    // 5. Compute attributes hash (commits to eligibility without revealing values)
    let attributes_hash = {
        let serialized = bincode::serialize(&(
            &req.study_attributes.age_range,
            &req.study_attributes.country_bucket,
            &req.study_attributes.interests,
        ))
        .expect("serialize attrs");
        let result = Sha256::digest(&serialized);
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&result);
        arr
    };

    // 6. issued_at: passed directly from host into CredentialRequest.
    let issued_at: i64 = req.issued_at;

    // 7. Commit public journal (visible to verifier)
    env::commit(&CredentialJournal {
        credential_commitment: commitment,
        nullifier_hash,
        study_id: req.study_id,
        issued_at,
        attributes_hash,
    });
}
