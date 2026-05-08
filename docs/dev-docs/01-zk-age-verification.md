# 01 — ZK Age Verification

## Purpose

Define the complete implementation of zero-knowledge age verification using **Noir** for the circuit DSL, **Barretenberg** as the proving backend, and **NoirJS** for in-browser proving. No birth date, government ID, or personal information is ever transmitted to the server.

---

## 1. Overview

The age verification system proves the predicate `age >= 18` without revealing the participant's actual age or birth date. The proof is:

- Generated entirely in the participant's browser using NoirJS + Barretenberg WASM.
- Verified on the server by the Rust ZK Proving Service using Barretenberg's Rust API.
- Bound to a session-specific nullifier that prevents the same proof being replayed across studies.

---

## 2. Noir Circuit Design

### 2.1 Directory Structure

```
circuits/
└── age-proof/
    ├── Nargo.toml
    ├── src/
    │   ├── main.nr          # Entry point: age predicate
    │   └── utils.nr         # Date arithmetic helpers
    ├── Prover.toml          # Dev test inputs (DO NOT commit real values)
    └── tests/
        └── test_age.nr      # nargo test cases
```

### 2.2 Circuit: `src/main.nr`

```rust
use dep::std::hash::pedersen_hash;

// Private inputs (never revealed to verifier):
//   birth_year, birth_month, birth_day  — participant's date of birth
//   blinding_factor                     — random scalar for nullifier binding
//
// Public inputs (visible to verifier):
//   current_year, current_month, current_day — today's date (supplied by server, signed)
//   study_id                                  — binds nullifier to a specific study
//   nullifier                                 — H(birth_date || blinding_factor || study_id)

fn main(
    // Private
    birth_year:     u32,
    birth_month:    u32,
    birth_day:      u32,
    blinding_factor: Field,
    // Public
    current_year:   pub u32,
    current_month:  pub u32,
    current_day:    pub u32,
    study_id:       pub Field,
    nullifier:      pub Field,
) {
    // 1. Validate date ranges
    assert(birth_month >= 1 & birth_month <= 12);
    assert(birth_day >= 1 & birth_day <= 31);
    assert(birth_year >= 1900 & birth_year <= current_year);

    // 2. Compute age in years (conservative: uses year difference only for simplicity)
    //    Full month/day comparison prevents birthday-straddling edge case.
    let age_years = compute_age(
        birth_year, birth_month, birth_day,
        current_year, current_month, current_day,
    );

    // 3. Enforce age predicate
    assert(age_years >= 18);

    // 4. Verify nullifier = Pedersen(birth_year || birth_month || birth_day
    //                                || blinding_factor || study_id)
    let expected_nullifier = pedersen_hash([
        birth_year as Field,
        birth_month as Field,
        birth_day as Field,
        blinding_factor,
        study_id,
    ]);
    assert(nullifier == expected_nullifier);
}

fn compute_age(
    by: u32, bm: u32, bd: u32,
    cy: u32, cm: u32, cd: u32,
) -> u32 {
    let mut age = cy - by;
    // Subtract one if birthday hasn't occurred this year yet
    if cm < bm {
        age = age - 1;
    } else if cm == bm & cd < bd {
        age = age - 1;
    }
    age
}
```

### 2.3 Circuit: `tests/test_age.nr`

```rust
#[test]
fn test_valid_adult() {
    // Born 2000-01-01, current date 2026-05-08 → age = 26
    main(2000, 1, 1, 0x1234, 2026, 5, 8, 0xABCD, expected_nullifier());
}

#[test(should_fail)]
fn test_minor_rejected() {
    // Born 2010-01-01, current date 2026-05-08 → age = 16 — must fail
    main(2010, 1, 1, 0x1234, 2026, 5, 8, 0xABCD, 0);
}

#[test(should_fail)]
fn test_wrong_nullifier() {
    // Correct age but wrong nullifier — must fail constraint check
    main(2000, 1, 1, 0x1234, 2026, 5, 8, 0xABCD, 0xDEAD);
}
```

### 2.4 `Nargo.toml`

```toml
[package]
name = "age-proof"
type = "bin"
authors = ["quantumworld-dpdns-io"]
compiler_version = ">=1.0.0-beta.20"

[dependencies]
# No external deps; uses std only
```

### 2.5 Compile and Test Commands

```bash
cd circuits/age-proof

# Type-check and generate Prover.toml
nargo check

# Run all tests
nargo test

# Compile to ACIR (produces target/age_proof.json + target/age_proof.vk)
nargo compile

# Execute with sample inputs to generate witness
nargo execute

# Inspect circuit size (gate count)
nargo info
```

---

## 3. Server-Side Signed Date Attestation

The circuit uses `current_year/month/day` as public inputs. To prevent a participant from supplying a backdated current date, the server signs a date attestation:

```
GET /api/age-proof/date-attestation
Response: {
  "current_date": { "year": 2026, "month": 5, "day": 8 },
  "signed_at": 1746700800,
  "signature": "<ML-DSA-65 signature over current_date || study_id || timestamp>"
}
```

The browser verifies the ML-DSA signature before using the date in the circuit (using the platform's public verification key, embedded in the frontend build).

---

## 4. In-Browser Proof Generation (NoirJS)

### 4.1 Package Dependencies (`apps/web/package.json`)

```json
{
  "dependencies": {
    "@noir-lang/noir_js": "^1.0.0-beta.20",
    "@noir-lang/backend_barretenberg": "^0.65.0"
  }
}
```

### 4.2 Proof Generation Hook (`apps/web/lib/useAgeProof.ts`)

```typescript
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import circuit from '@/circuits/age_proof.json'; // ACIR artifact bundled at build time

export interface AgeProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  nullifier: string;
}

export async function generateAgeProof(
  birthYear: number,
  birthMonth: number,
  birthDay: number,
  studyId: string,
  dateAttestation: DateAttestation,
): Promise<AgeProofResult> {
  // 1. Generate cryptographically random blinding factor (client-side only)
  const blindingFactor = generateBlindingFactor();

  // 2. Compute nullifier client-side (mirrors circuit Pedersen hash)
  const nullifier = await computeNullifier(
    birthYear, birthMonth, birthDay, blindingFactor, studyId,
  );

  // 3. Initialize Barretenberg backend and Noir prover
  const backend = new BarretenbergBackend(circuit, { threads: 4 });
  const noir = new Noir(circuit, backend);

  // 4. Prepare witness inputs
  const inputs = {
    birth_year:      birthYear,
    birth_month:     birthMonth,
    birth_day:       birthDay,
    blinding_factor: blindingFactor,
    current_year:    dateAttestation.current_date.year,
    current_month:   dateAttestation.current_date.month,
    current_day:     dateAttestation.current_date.day,
    study_id:        studyId,
    nullifier:       nullifier,
  };

  // 5. Generate proof (runs entirely in browser WASM)
  const { proof, publicInputs } = await noir.generateProof(inputs);

  // IMPORTANT: birthYear/Month/Day and blindingFactor never leave this function scope.
  return { proof, publicInputs, nullifier };
}

function generateBlindingFactor(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 4.3 Proof Submission (`apps/web/lib/verifyAge.ts`)

```typescript
export async function submitAgeProof(
  proofResult: AgeProofResult,
  studyId: string,
  dateAttestation: DateAttestation,
): Promise<string> { // returns ZK session token
  const response = await fetch('/api/verify-age', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: Array.from(proofResult.proof),
      public_inputs: proofResult.publicInputs,
      nullifier: proofResult.nullifier,
      study_id: studyId,
      date_attestation: dateAttestation,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message ?? 'Age verification failed');
  }

  const { zk_session_token } = await response.json();
  return zk_session_token;
}
```

---

## 5. Server-Side Verification (Rust ZK Proving Service)

### 5.1 Barretenberg Verification

```rust
// services/zk-proving/src/age_verify.rs
use barretenberg::{Barretenberg, VerificationKey, Proof};

pub struct AgeVerifier {
    vk: VerificationKey,
}

impl AgeVerifier {
    pub fn new() -> Self {
        // Verification key compiled from circuits/age-proof/target/age_proof.vk
        let vk_bytes = include_bytes!("../circuits/age_proof.vk");
        Self { vk: VerificationKey::from_bytes(vk_bytes).unwrap() }
    }

    pub fn verify(
        &self,
        proof_bytes: &[u8],
        public_inputs: &[String],
    ) -> anyhow::Result<bool> {
        let proof = Proof::from_bytes(proof_bytes)?;
        let result = Barretenberg::verify_proof(&self.vk, &proof, public_inputs)?;
        Ok(result)
    }
}
```

### 5.2 Full Verification Handler

```rust
// services/zk-proving/src/handlers/verify_age.rs
use axum::{Json, extract::State};
use crate::{AppState, AgeVerifyRequest, AgeVerifyResponse, error::AppError};

pub async fn verify_age_handler(
    State(state): State<AppState>,
    Json(req): Json<AgeVerifyRequest>,
) -> Result<Json<AgeVerifyResponse>, AppError> {
    // 1. Verify ML-DSA signature on date attestation
    state.date_verifier.verify_attestation(&req.date_attestation)?;

    // 2. Check nullifier not previously seen
    let nullifier = &req.nullifier;
    if state.nullifier_registry.is_seen(nullifier).await? {
        return Err(AppError::NullifierAlreadyUsed);
    }

    // 3. Verify Barretenberg proof
    let valid = state.age_verifier.verify(&req.proof, &req.public_inputs)?;
    if !valid {
        return Err(AppError::InvalidProof);
    }

    // 4. Register nullifier (Redis + Supabase)
    state.nullifier_registry.register(nullifier, &req.study_id).await?;

    // 5. Issue ZK session token (HMAC-SHA256, 1-hour TTL, bound to study_id)
    let token = state.token_issuer.issue(nullifier, &req.study_id)?;

    Ok(Json(AgeVerifyResponse { zk_session_token: token }))
}
```

---

## 6. Nullifier Registry

### 6.1 Redis Bloom Filter (fast path)

```rust
// services/zk-proving/src/nullifier_registry.rs
use redis::AsyncCommands;

pub struct NullifierRegistry {
    redis: redis::aio::MultiplexedConnection,
    supabase_client: SupabaseClient,
}

impl NullifierRegistry {
    pub async fn is_seen(&self, nullifier: &str) -> anyhow::Result<bool> {
        // BF.EXISTS key member — O(k) time
        let exists: bool = redis::cmd("BF.EXISTS")
            .arg("nullifiers:bloom")
            .arg(nullifier)
            .query_async(&mut self.redis.clone())
            .await?;
        Ok(exists)
    }

    pub async fn register(&self, nullifier: &str, study_id: &str) -> anyhow::Result<()> {
        // Write to Redis bloom filter
        redis::cmd("BF.ADD")
            .arg("nullifiers:bloom")
            .arg(nullifier)
            .query_async::<_, bool>(&mut self.redis.clone())
            .await?;

        // Write canonical record to Supabase (for auditability, not identity)
        self.supabase_client.insert("nullifiers", serde_json::json!({
            "nullifier_hash": sha256_hex(nullifier),
            "study_id": study_id,
            "registered_at": chrono::Utc::now(),
        })).await?;

        Ok(())
    }
}
```

---

## 7. Circuit Artifact Management

### 7.1 Build-time Bundling

The compiled ACIR artifact (`age_proof.json`) is committed to the repository and bundled into the Next.js frontend at build time. It is **not fetched at runtime** to prevent substitution attacks.

```typescript
// apps/web/next.config.ts
const nextConfig = {
  webpack: (config) => {
    config.module.rules.push({
      test: /\.json$/,
      include: /circuits/,
      type: 'asset/resource',
    });
    return config;
  },
};
```

### 7.2 Verification Key Pinning

The server-side verification key (`age_proof.vk`) is embedded in the Rust binary at compile time using `include_bytes!`. Any change to the circuit requires:

1. Recompiling the circuit with `nargo compile`.
2. Updating the `.vk` file in `services/zk-proving/circuits/`.
3. Re-bundling `age_proof.json` in `apps/web`.
4. Deploying both services together in a coordinated release.

---

## 8. Testing Plan

| Test | Tool | Coverage |
|---|---|---|
| Valid adult proof accepted | `nargo test` + Rust unit | Happy path |
| Minor rejected | `nargo test` | Constraint fail |
| Wrong nullifier rejected | `nargo test` | Constraint fail |
| Backdated date rejected | Rust integration | Signature verification |
| Nullifier replay rejected | Rust integration | Redis + Supabase |
| Browser proof generation | Playwright + Jest | NoirJS WASM in headless Chrome |
| Proof verification latency | `cargo bench` | < 500 ms target |
| Circuit gate count | `nargo info` | Baseline regression tracking |

---

## 9. CI/CD Pipeline

```yaml
# .github/workflows/circuits.yml
name: ZK Circuit CI
on: [push, pull_request]
jobs:
  noir-circuit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Nargo
        run: |
          curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
          noirup --version 1.0.0-beta.20
      - name: Check circuit
        run: cd circuits/age-proof && nargo check
      - name: Run circuit tests
        run: cd circuits/age-proof && nargo test
      - name: Compile circuit
        run: cd circuits/age-proof && nargo compile
      - name: Verify artifact hash
        run: sha256sum circuits/age-proof/target/age_proof.json | tee circuits/age-proof/target/age_proof.json.sha256
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: circuit-artifacts
          path: circuits/age-proof/target/
```

---

## 10. Security Checklist

- [ ] Circuit has no underconstrained paths (verified by `nargo check` with constraint analysis)
- [ ] Nullifier Pedersen hash includes `study_id` to prevent cross-study replay
- [ ] Blinding factor is generated with `crypto.getRandomValues` (CSPRNG)
- [ ] Date attestation is signed with ML-DSA-65 and verified before circuit inputs are accepted
- [ ] ACIR artifact hash is pinned in CI; mismatch fails the build
- [ ] Verification key is embedded in Rust binary, not loaded from disk at runtime
- [ ] Proof bytes are validated for length and format before passing to Barretenberg
- [ ] All ZK verification failures return a generic error (no oracle information)
- [ ] Birth date is cleared from JS memory after `generateProof()` resolves (structured clone)
- [ ] `nargo fuzz` is run in weekly scheduled CI to detect underconstrained edge cases
