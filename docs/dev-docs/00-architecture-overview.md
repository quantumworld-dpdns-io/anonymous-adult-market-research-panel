# 00 — Architecture Overview

## Purpose

This document defines the system architecture, service boundaries, canonical data flows, and threat model for the Anonymous Adult Market Research Panel. Every subsequent implementation plan (`01-*` through `10-*`) inherits from the decisions made here.

---

## 1. Design Principles

| Principle | Implication |
|---|---|
| **Privacy by default** | No PII enters the system. Age is proven via ZK; study responses are encrypted before storage. |
| **Unlinkability** | Participants cannot be linked across studies, sessions, or survey responses. |
| **Verifiability** | Every claim the system makes (age verified, response submitted once) is cryptographically provable. |
| **Crypto-agility** | All cipher suites, KEM selections, and signature algorithms are configuration-driven, not hard-coded. |
| **Defense in depth** | ZK proofs, PQC transport, RLS policies, runtime enforcement (Tetragon), and federated analytics are all independent layers. |
| **Quantum readiness** | Key establishment uses hybrid X25519 + ML-KEM-768 today; pure PQC switchable when ecosystem matures. |

---

## 2. Service Topology

```
                          ┌───────────────────────────────┐
                          │         External Clients       │
                          │  Participants  │  Researchers  │
                          └───────┬────────────────┬───────┘
                                  │ HTTPS           │ HTTPS
                         ML-KEM hybrid TLS   ML-KEM hybrid TLS
                                  ▼                ▼
                    ┌─────────────────────────────────────┐
                    │         Go API Gateway              │
                    │  svc: api-gateway  port: 8080/443   │
                    │  ┌─────────────────────────────┐    │
                    │  │  Auth Middleware             │    │
                    │  │  · Researcher: Supabase JWT  │    │
                    │  │  · Participant: ZK token     │    │
                    │  └─────────────────────────────┘    │
                    │  ┌─────────────────────────────┐    │
                    │  │  Rate Limiter (Redis)        │    │
                    │  └─────────────────────────────┘    │
                    │  ┌─────────────────────────────┐    │
                    │  │  gRPC-gateway routing        │    │
                    │  └─────────────────────────────┘    │
                    └──────┬────────┬──────────┬──────────┘
                           │        │          │
              gRPC/mTLS   │        │          │   HTTP/JSON
          ┌────────────────┘        │          └──────────────┐
          ▼                         ▼                         ▼
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Rust ZK        │      │  Python Analytics│      │  Python Quantum  │
│  Proving Svc    │      │  + Flower Server │      │  Sampling Svc    │
│  port: 50051    │      │  port: 8001      │      │  port: 8002      │
└────────┬────────┘      └────────┬─────────┘      └────────┬─────────┘
         │                        │                          │
         │                        │                          │
         └──────────────┬─────────┘──────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────────┐
         │         Supabase                  │
         │  PostgreSQL + RLS                 │
         │  Auth · Storage · Realtime        │
         │  Edge Functions (Deno)            │
         └──────┬───────────────────────────┘
                │
        ┌───────┼───────────┐
        ▼       ▼           ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │ Qdrant │ │ DuckDB │ │ Redis  │
   │ Vector │ │ Analyt.│ │ Cache  │
   └────────┘ └────────┘ └────────┘
```

---

## 3. Service Responsibilities

### 3.1 Go API Gateway (`services/api-gateway`)

- Single ingress point for all external traffic.
- Terminates hybrid TLS (X25519 + ML-KEM-768 via Cloudflare CIRCL).
- Verifies researcher JWTs issued by Supabase Auth.
- Verifies participant ZK session tokens issued by the ZK Proving Service.
- Rate-limits per participant nullifier hash (prevents study spam without tracking identity).
- Routes to downstream services via gRPC (internal) or HTTP (Supabase Edge Functions).
- Emits OpenTelemetry spans for all requests.

### 3.2 Rust ZK Proving Service (`services/zk-proving`)

- Hosts RISC Zero image IDs and verifies receipts for age proofs and credential issuance.
- Issues one-time anonymous session tokens (ZK tokens) to verified participants.
- Maintains the nullifier registry (set of seen nullifiers) in Redis + Supabase.
- Exposes Axum HTTP endpoints and gRPC service definitions.
- Runs Noir ACIR artifacts using Barretenberg's Rust bindings for server-side verification.

### 3.3 Python Analytics Service (`services/analytics`)

- Acts as Flower `SuperLink` (federation server) for federated survey analytics.
- Coordinates `ClientApp` computations on encrypted response shards.
- Implements FedAvg + Differential Privacy (Gaussian mechanism, ε-budget tracking).
- Exposes REST API for researchers to query aggregated (differentially private) results.
- Uses DuckDB + Apache Arrow for efficient columnar aggregation before federated rounds.

### 3.4 Python Quantum Sampling Service (`services/quantum`)

- Constructs QASM circuits using Qiskit for cryptographically random panel selection.
- Executes circuits on local Qiskit Aer simulator (dev) or IBM Quantum backend (prod).
- Optionally uses NVIDIA CUDA-Q for GPU-accelerated large-sample simulations.
- Returns uniform random permutations and stratified cohort assignments to the API Gateway.

### 3.5 Fermyon Spin Edge Handlers (`infra/spin`)

- Lightweight WASM handlers for high-frequency stateless operations:
  - Proof submission ping endpoints
  - CORS preflight handlers
  - Health checks
- Compiled to WASM, deployed via SpinKube onto Kubernetes edge nodes.
- Use WASI 0.3 async model for non-blocking I/O.

### 3.6 Next.js Frontend (`apps/web`)

- Researcher portal: study creation, cohort configuration, real-time result visualization.
- Participant portal: anonymous sign-in, ZK age proof generation (in-browser via NoirJS), study participation.
- NoirJS runs Barretenberg prover in WASM inside the browser — private age input never leaves the device.
- Server Components fetch non-sensitive data; Client Components handle ZK proof flow.

---

## 4. Data Flows

### 4.1 Participant Age Verification Flow

```
1. Participant opens participation portal.
2. Browser (NoirJS) prompts for date-of-birth (kept client-side only).
3. NoirJS runs Noir age circuit: proves age >= 18, outputs (proof, nullifier, public_inputs).
4. Browser POST /api/verify-age with { proof, nullifier, public_inputs }.
5. Go Gateway forwards to ZK Proving Service (gRPC).
6. ZK Service verifies Barretenberg proof against Noir verifier key.
7. ZK Service checks nullifier not seen before (Redis bloom filter + Supabase nullifiers table).
8. ZK Service issues a time-scoped anonymous ZK session token (HMAC-signed, no identity).
9. Token returned to browser. Browser stores in memory only (no localStorage, no cookies).
10. Participant proceeds to study selection using ZK token as bearer.
```

### 4.2 Study Response Submission Flow

```
1. Participant submits study response with ZK session token.
2. Go Gateway validates ZK token (signature, expiry, study_id binding).
3. Gateway encrypts response payload with ML-KEM-768 study key.
4. Gateway writes { study_id, nullifier_hash, encrypted_response } to Supabase.
5. RLS policy confirms: no two rows share the same nullifier_hash + study_id.
6. Analytics Service is notified (Supabase Realtime / webhook).
7. Analytics Service adds encrypted shard to federated learning round.
```

### 4.3 Researcher Analytics Query Flow

```
1. Researcher authenticates via Supabase Auth (OAuth).
2. Researcher requests result summary for study_id.
3. Analytics Service runs Flower federated aggregation round (FedAvg + DP noise).
4. Differentially private aggregate is cached in DuckDB.
5. Results returned to researcher dashboard (no raw responses, no participant traces).
```

### 4.4 Quantum Panel Sampling Flow

```
1. Study configuration specifies: population_size, sample_size, strata.
2. API Gateway calls Quantum Service with sampling parameters.
3. Quantum Service constructs QASM circuit: n-qubit uniform superposition + measurement.
4. Circuit executed on Qiskit Aer (dev) or IBM Quantum (prod).
5. Measurement outcomes used as random seed for stratified sampling.
6. Cohort assignment (encoded without PII attributes) returned to researcher dashboard.
```

---

## 5. Threat Model

### 5.1 Assets

| Asset | Sensitivity | Protection |
|---|---|---|
| Participant identity | Critical — must never exist in system | ZK proofs; no PII ever stored |
| Study responses (raw) | High | ML-KEM encrypted; federated aggregation; never stored in plaintext |
| Nullifier set | Medium | Redis + Supabase; reveals participation pattern only (not identity) |
| Researcher credentials | High | Supabase Auth + MFA; JWT with short TTL |
| ZK circuit image IDs | High | Pinned in deployment; tampering detected by RISC Zero verification |
| Proving keys | High | Stored in Supabase Storage + secrets manager; Tetragon monitors access |

### 5.2 Threat Actors

| Actor | Capability | Mitigations |
|---|---|---|
| Passive network observer | Intercepts TLS | Hybrid PQC TLS (X25519 + ML-KEM-768); prevents harvest-now-decrypt-later |
| Malicious researcher | Attempts to de-anonymize respondents | Differential privacy on all results; minimum cohort size enforced; no raw access |
| Compromised service | Exfiltrates data | RLS policies; Tetragon runtime enforcement; encrypted responses at rest |
| Replay attacker | Reuses ZK proof | Nullifier registry prevents double-spend; ZK token is time-scoped |
| Sybil attacker | Generates fake age proofs | Barretenberg verifier with pinned Noir image; trusted third-party verification key |
| Quantum adversary (future) | Breaks X25519 key exchange | ML-KEM-768 in hybrid mode today; crypto-agile config for pure PQC migration |

### 5.3 Out of Scope

- Device-level attacks (keyloggers reading the date-of-birth input)
- Collusion between a participant's age-issuing authority and the platform
- Side-channel attacks on the Barretenberg WASM prover

---

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Age proof generation (browser) | < 3 seconds on mid-range laptop |
| Age proof verification (server) | < 500 ms |
| API gateway p99 latency | < 150 ms (excluding proof steps) |
| Study response write | < 200 ms end-to-end |
| Federated analytics round | < 60 seconds for n=1000 responses |
| Quantum sampling (local sim) | < 5 seconds for 10,000-participant cohort |
| Supabase RLS enforcement | All tables; no bypass paths |
| Nullifier uniqueness | Guaranteed; enforced at DB + Redis layer |
| Zero PII in logs | Enforced by Tetragon file/log access policies |

---

## 7. Technology Decision Rationale

| Decision | Alternatives Considered | Reason Chosen |
|---|---|---|
| **Noir for age circuit** | Circom, ZoKrates | Rust-like syntax; backend-agnostic ACIR; NoirJS for browser proving |
| **RISC Zero for credential issuance** | Custom Noir circuit | Credential logic is complex business logic; RISC Zero avoids circuit DSL for general Rust code |
| **Go for API gateway** | Node.js, Rust | CIRCL PQC library in Go; strong concurrency; gRPC ecosystem |
| **Rust for ZK service** | Go, Python | RISC Zero SDK is Rust-native; zero-cost abstractions for proof performance |
| **Supabase** | PlanetScale, Neon | RLS for per-row access control; Auth built-in; Realtime for dashboard; no-PII compliant |
| **Flower federated learning** | PySyft, OpenFL | Framework-agnostic; strong aggregation strategy library; simulation-to-deployment path |
| **Qiskit for sampling** | Random.org, OS entropy | Demonstrates quantum capability; QASM circuits are auditable; IBM Quantum backend available |
| **Qdrant** | Pinecone, Weaviate | Rust-native; optimal for Rust ZK service co-location; memory efficient |
| **Cilium Tetragon** | Falco, Sysdig | eBPF-native; Kubernetes-aware identity; low overhead; kernel enforcement |
| **liboqs + CIRCL** | BoringSSL PQC branch | NIST-standardized (ML-KEM-768, ML-DSA-65); Go CIRCL fits gateway; C liboqs for Rust FFI |

---

## 8. Deployment Environments

| Environment | Description |
|---|---|
| `local` | Docker Compose: Supabase local, Redis, Qdrant, Go/Rust/Python services, Next.js dev server |
| `staging` | Kubernetes (k3s): Helm charts, SpinKube, Tetragon DaemonSet, Supabase cloud |
| `production` | Kubernetes (EKS or GKE): Full Helm stack, Tetragon, IBM Quantum API, Supabase Pro |

---

## 9. Inter-Service Communication

| Caller | Callee | Protocol | Auth |
|---|---|---|---|
| Browser | Go Gateway | HTTPS REST | ZK token / Supabase JWT |
| Go Gateway | ZK Proving Service | gRPC + mTLS | Mutual TLS cert |
| Go Gateway | Analytics Service | HTTP/JSON | Internal HMAC |
| Go Gateway | Quantum Service | HTTP/JSON | Internal HMAC |
| Go Gateway | Supabase | HTTPS | Service role key |
| ZK Proving Service | Redis | Resp3 | Password auth |
| Analytics Service | Supabase | HTTPS | Service role key |
| Analytics Service | Flower Clients | gRPC (Flower) | Federation key |

---

## 10. Next Steps

Read the remaining implementation plans in order:

1. [`01-zk-age-verification.md`](01-zk-age-verification.md) — Noir circuit and in-browser proof
2. [`02-anonymous-credentials.md`](02-anonymous-credentials.md) — RISC Zero credential issuance
3. [`03-frontend-nextjs.md`](03-frontend-nextjs.md) — Next.js portal and dashboard
4. [`04-go-api-gateway.md`](04-go-api-gateway.md) — Go gateway implementation
5. [`05-rust-zk-proving-service.md`](05-rust-zk-proving-service.md) — Rust proving service
6. [`06-python-analytics-service.md`](06-python-analytics-service.md) — Federated analytics
7. [`07-quantum-sampling-service.md`](07-quantum-sampling-service.md) — Qiskit sampling
8. [`08-supabase-database-design.md`](08-supabase-database-design.md) — DB schema and RLS
9. [`09-security-pqc-runtime.md`](09-security-pqc-runtime.md) — PQC + Tetragon
10. [`10-federated-learning-design.md`](10-federated-learning-design.md) — Flower federation
