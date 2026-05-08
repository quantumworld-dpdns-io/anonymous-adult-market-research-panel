use std::ffi::{c_char, CString};
use crate::error::AppError;

/// Maximum proof size accepted (1 MB — prevents oversized FFI input)
const MAX_PROOF_BYTES: usize = 1024 * 1024;

// FFI declarations for the Barretenberg C++ library.
// Link against libbarretenberg.so / barretenberg.dylib at build time.
// In CI, use the barretenberg-sys crate which handles the C++ compilation.
extern "C" {
    fn bb_verify_proof(
        vk: *const u8,
        vk_len: usize,
        proof: *const u8,
        proof_len: usize,
        public_inputs_json: *const c_char,
    ) -> bool;
}

pub struct AgeVerifier {
    /// Verification key embedded at compile time via include_bytes!.
    /// Any change to the Noir circuit requires rebuilding and redeploying this binary.
    vk_bytes: &'static [u8],
}

impl AgeVerifier {
    pub fn new() -> anyhow::Result<Self> {
        // The .vk file is compiled from circuits/age-proof/ and committed.
        // Embedding prevents runtime substitution attacks.
        Ok(Self {
            vk_bytes: include_bytes!("../../circuits/age_proof.vk"),
        })
    }

    /// Verify a Barretenberg SNARK proof against the pinned age circuit VK.
    /// Returns Ok(true) on valid proof, Ok(false) on invalid, Err on malformed input.
    pub fn verify(
        &self,
        proof_bytes: &[u8],
        public_inputs: &[String],
    ) -> Result<bool, AppError> {
        if proof_bytes.is_empty() || proof_bytes.len() > MAX_PROOF_BYTES {
            return Err(AppError::MalformedProof);
        }

        let inputs_json = serde_json::to_string(public_inputs)
            .map_err(|_| AppError::MalformedProof)?;
        let c_inputs = CString::new(inputs_json).map_err(|_| AppError::MalformedProof)?;

        // Safety: vk_bytes and proof_bytes are valid slices; c_inputs is a valid CString.
        let result = unsafe {
            bb_verify_proof(
                self.vk_bytes.as_ptr(),
                self.vk_bytes.len(),
                proof_bytes.as_ptr(),
                proof_bytes.len(),
                c_inputs.as_ptr(),
            )
        };

        Ok(result)
    }
}
