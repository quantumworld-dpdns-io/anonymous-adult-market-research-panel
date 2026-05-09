# 02 — Anonymous Credentials

## Purpose

Define the design and implementation of the anonymous credential system that allows a verified participant to join and respond to market research studies without being tracked or linked across sessions.

The system uses **RISC Zero zkVM** to prove that credential issuance logic ran correctly, and issues **unlinkable one-time tokens** bound to specific studies.

---

## 1. Credential Model

### 1.1 Definitions

| Term | Meaning |
|---|---|
| **Credential** | A signed capability proving a participant is age-verified and authorized to join a specific study |
| **Anonymous credential** | A credential that cannot be linked to the participant's real identity or to credentials from other studies |
| **Nullifier** | A unique value derived from the participant's blinding factor + study ID; prevents double submission |
| **ZK session token** | Short-lived bearer token issued after credential verification; authorizes one study response |
| **Presentation** | The act of using a credential to authorize an action (submitting a response) |

### 1.2 Security Properties

| Property | Mechanism |
|---|---|
| **Unforgeability** | Credentials carry a RISC Zero receipt proving issuance ran on verified inputs |
| **Unlinkability** | Each credential uses a fresh nullifier; no common identifier across studies |
| **One-time use** | Nullifier registry enforces single use per (nullifier, study_id) pair |
| **Non-transferability** | Credentials are bound to the blinding factor only the participant knows |
| **Expiry** | ZK session tokens have a 1-hour TTL; expired tokens are rejected |

---

## 2. RISC Zero Credential Issuance

### 2.1 Why RISC Zero for Credential Issuance

The credential issuance logic involves:
- Validating that a Barretenberg age proof is authentic.
- Checking study eligibility criteria (e.g., country code from no-PII attributes).
- Computing a credential commitment.
- Logging the issuance event to the nullifier registry.

This logic is too complex to encode as a Noir circuit. RISC Zero lets us write it as ordinary Rust, compile to RISC-V, and produce a cryptographic receipt proving it ran correctly without revealing private inputs.

### 2.2 RISC Zero Project Structure

```
services/zk-proving/
├── src/
│   ├── main.rs                  # Axum HTTP server
│   ├── handlers/
│   │   ├── issue_credential.rs  # Credential issuance handler
│   │   └── verify_age.rs        # Age proof handler (see 01-*)
│   └── guest/                   # Compiled into zkVM (RISC-V ELF)
│       └── src/main.rs          # Guest: credential issuance logic
├── Cargo.toml
└── circuits/
    └── age_proof.vk             # Noir verification key (embedded)
```

### 2.3 Guest Program (RISC-V ELF)

```rust
// services/zk-proving/guest/src/main.rs
// This runs inside the RISC Zero zkVM.

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CredentialRequest {
    nullifier: String,
    study_id: String,
    age_proof_valid: bool,        // Pre-verified by host before entering zkVM
    study_attributes: StudyAttrs, // Non-PII: age_range, country_bucket, interests
    blinding_factor: [u8; 32],
}

#[derive(Serialize)]
struct CredentialJournal {
    credential_commitment: [u8; 32],
    nullifier_hash: [u8; 32],
    study_id: String,
    issued_at: u64,
    attributes_hash: [u8; 32],   // Commitment to study attributes (no raw values)
}

fn main() {
    // 1. Read private inputs from host
    let req: CredentialRequest = env::read();

    // 2. Enforce preconditions
    assert!(req.age_proof_valid, "Age proof must be valid before credential issuance");
    assert!(!req.nullifier.is_empty(), "Nullifier must be provided");
    assert!(!req.study_id.is_empty(), "Study ID must be provided");

    // 3. Validate study attributes eligibility
    assert!(
        req.study_attributes.matches_criteria(),
        "Participant attributes do not match study criteria"
    );

    // 4. Compute credential commitment:
    //    commitment = SHA-256(nullifier || study_id || blinding_factor || "credential_v1")
    let commitment = sha256_commitment(
        req.nullifier.as_bytes(),
        req.study_id.as_bytes(),
        &req.blinding_factor,
        b"credential_v1",
    );

    // 5. Compute nullifier hash (public — used for registry)
    let nullifier_hash = sha256(req.nullifier.as_bytes());

    // 6. Compute attributes hash (commits to eligibility without revealing values)
    let attributes_hash = sha256(
        &bincode::serialize(&req.study_attributes).unwrap()
    );

    // 7. Journal the public outputs
    env::commit(&CredentialJournal {
        credential_commitment: commitment,
        nullifier_hash,
        study_id: req.study_id,
        issued_at: current_timestamp(),
        attributes_hash,
    });
}
```

### 2.4 Host Program (Credential Issuance Handler)

> **Dev vs Production:** The `risc0-zkvm` `prove` feature requires the RISC Zero toolchain
> (`rzup`) and, on macOS, the Metal GPU compiler from full Xcode. For local development set
> `RISC0_DEV_MODE=1` — the service then issues a SHA-256 commitment as the `receipt_seal`
> instead of a real ZK receipt. The production flow below requires `rzup` + Xcode to be
> installed and `RISC0_DEV_MODE` unset or `0`.

```rust
// services/zk-proving/src/handlers/issue_credential.rs  (production flow)
// In dev mode (RISC0_DEV_MODE=1) CredentialIssuer::issue() returns a SHA-256 stub.

pub async fn handler(
    State(state): State<AppState>,
    Json(req): Json<IssueCredentialRequest>,
) -> Result<Json<IssueCredentialResponse>, AppError> {
    // 1. Verify ML-DSA-65 date attestation
    state.date_signer.verify_attestation(&req.date_attestation)?;

    // 2. Verify Barretenberg age proof
    state.age_verifier.verify(&req.age_proof, &req.age_public_inputs)?;

    // 3. Decode blinding factor (base64url)
    let blinding_factor: [u8; 32] = decode_blinding_factor(&req.blinding_factor_b64)?;

    // 4. Build credential request (issued_at injected by host)
    let credential_req = CredentialRequest {
        nullifier: req.nullifier.clone(),
        study_id: req.study_id.clone(),
        age_proof_valid: true,
        study_attributes: req.study_attributes,
        blinding_factor,
        issued_at: chrono::Utc::now().timestamp(),
    };

    // 5. Issue credential (zkVM in prod; SHA-256 stub in dev mode)
    let cred = state.credential_issuer.issue(credential_req).await?;

    // 6. Register nullifier permanently
    state.nullifier_registry.register(&req.nullifier, &req.study_id).await?;

    // 7. Persist commitment to Supabase (background, non-blocking)
    spawn_supabase_write(&state, &cred.journal, &req.study_id);

    // 8. Issue ZK session token (HMAC-SHA256, 1hr TTL, bound to commitment)
    let commitment_hex = hex::encode(cred.journal.credential_commitment);
    let token = state.token_issuer
        .issue_with_commitment(&req.nullifier, &req.study_id, &commitment_hex)?;

    Ok(Json(IssueCredentialResponse {
        zk_session_token: token,
        credential_commitment: commitment_hex,
        receipt_seal: cred.seal_hex,  // real groth16 seal in prod; SHA-256 stub in dev
    }))
}
```

---

## 3. ZK Session Token Design

### 3.1 Token Structure

```
Header.Payload.Signature

Payload (JSON, base64url-encoded):
{
  "sub": "<nullifier_hash_hex>",       // no real identity
  "study_id": "<uuid>",
  "commitment": "<credential_commitment_hex>",
  "iat": 1746700800,
  "exp": 1746704400,                    // +1 hour
  "jti": "<random UUID>",              // prevents token sharing
  "v": 1
}

Signature: HMAC-SHA256 with server-side secret (rotated weekly)
```

### 3.2 Token Verification (Go API Gateway)

```go
// services/api-gateway/internal/auth/zk_token.go
package auth

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "encoding/json"
    "errors"
    "time"
)

type ZKTokenPayload struct {
    Sub        string `json:"sub"`
    StudyID    string `json:"study_id"`
    Commitment string `json:"commitment"`
    IssuedAt   int64  `json:"iat"`
    ExpiresAt  int64  `json:"exp"`
    JTI        string `json:"jti"`
    Version    int    `json:"v"`
}

func VerifyZKToken(tokenStr string, secret []byte, studyID string) (*ZKTokenPayload, error) {
    parts := splitToken(tokenStr)
    if len(parts) != 3 {
        return nil, errors.New("invalid token format")
    }

    // Verify signature
    mac := hmac.New(sha256.New, secret)
    mac.Write([]byte(parts[0] + "." + parts[1]))
    expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
    if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
        return nil, errors.New("invalid token signature")
    }

    // Decode payload
    payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
    if err != nil {
        return nil, err
    }
    var payload ZKTokenPayload
    if err := json.Unmarshal(payloadBytes, &payload); err != nil {
        return nil, err
    }

    // Check expiry
    if time.Now().Unix() > payload.ExpiresAt {
        return nil, errors.New("token expired")
    }

    // Check study_id binding
    if payload.StudyID != studyID {
        return nil, errors.New("token bound to different study")
    }

    return &payload, nil
}
```

---

## 4. Study Attribute System (No-PII)

Participants self-report coarse demographic attributes. These are **not verified** by the platform and are used only for study targeting. They are never linked to identity.

### 4.1 Attribute Schema

```json
{
  "age_range": "25-34",         // Coarse bucket, consistent with ZK age proof
  "country_bucket": "TIER_1",  // Coarse: TIER_1 (US/CA/UK/AU), TIER_2, TIER_3
  "interests": ["tech", "finance", "health"],  // Self-reported interest tags
  "device_type": "desktop"     // From User-Agent header (not stored)
}
```

### 4.2 Attribute Commitment

The RISC Zero guest commits to the attribute hash in the journal. This allows researchers to verify that the study's targeting criteria were applied, without seeing raw attribute values.

---

## 5. Supabase Schema

```sql
-- credentials table: no PII, only cryptographic commitments
CREATE TABLE credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment       text NOT NULL UNIQUE,    -- hex of credential commitment
  nullifier_hash   text NOT NULL,           -- hex of SHA-256(nullifier)
  study_id         uuid NOT NULL REFERENCES studies(id),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  attributes_hash  text NOT NULL,           -- hex of SHA-256(attributes)
  receipt_seal     text,                    -- RISC Zero seal for auditability
  CONSTRAINT unique_nullifier_per_study UNIQUE (nullifier_hash, study_id)
);

-- Row-Level Security: only service role can read/write
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON credentials
  USING (auth.role() = 'service_role');
```

---

## 6. Credential Lifecycle

```
                   Browser                    ZK Proving Service            Supabase
                      │                              │                          │
 [Age verified] ──────┤                              │                          │
                      │ POST /api/issue-credential   │                          │
                      │ { age_proof, nullifier,      │                          │
                      │   study_id, blinding_factor, │                          │
                      │   attributes }               │                          │
                      ├─────────────────────────────►│                          │
                      │                              │ Verify age proof          │
                      │                              │ Fetch study criteria      │
                      │                              │ Run RISC Zero guest      │
                      │                              │ (credential issuance)    │
                      │                              │ Verify receipt           │
                      │                              ├─────────────────────────►│
                      │                              │ INSERT credentials row   │
                      │                              │◄─────────────────────────┤
                      │                              │ Issue ZK session token   │
                      │◄─────────────────────────────┤                          │
                      │ { zk_session_token,          │                          │
                      │   credential_commitment }    │                          │
                      │                              │                          │
 [Use token for       │                              │                          │
  study response] ────┤                              │                          │
```

---

## 7. Testing Plan

| Test | Type | Target |
|---|---|---|
| Valid credential issuance | RISC Zero integration | Receipt verified, journal decoded |
| Invalid age proof rejected | RISC Zero integration | Error returned before guest runs |
| Study criteria mismatch | Guest unit test | `assert!` in guest panics |
| Duplicate nullifier rejected | Rust integration | Supabase UNIQUE constraint |
| ZK token expiry | Go unit test | 401 after TTL |
| Study binding check | Go unit test | Token for study A rejected for study B |
| Receipt seal stored correctly | Supabase integration | Seal round-trip |

---

## 8. Security Checklist

- [ ] RISC Zero Image ID is pinned in deployment manifest; mismatch fails verification
- [ ] Guest program uses only deterministic operations (no system clock, no randomness inside guest)
- [ ] `issued_at` timestamp comes from the host, committed in journal, visible to auditors
- [ ] Credential commitment includes a domain separator (`"credential_v1"`) to prevent cross-protocol attacks
- [ ] Nullifier hash uses SHA-256 (collision-resistant); raw nullifier never stored server-side
- [ ] ZK session token JTI is single-use (verified against Redis set before acceptance)
- [ ] Token signing secret is rotated weekly via secrets manager; old tokens verified with previous key for TTL window
- [ ] RISC Zero development mode is disabled in all non-local environments
- [ ] Receipt seal is stored for post-hoc auditing but is not used in runtime verification paths
